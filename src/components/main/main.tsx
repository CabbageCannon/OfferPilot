import { useEffect, useState } from "react";
import { useChatStore } from "@/store/chatStore";
import { useSendMessage } from "@/hooks/useSendMessage";
import type { DocumentInfo, ModelInfo } from "@/type/api";
import MessageList from "../MessageList/MessageList";
import SearchBox from "../SearchBox/SearchBox";
import SuggestionCards from "../SuggestionCards/SuggestionCards";
import "./Main.css";

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || `请求失败（${response.status}）`);
  return body as T;
}

const Main = () => {
  const ensureCurrentSession = useChatStore(state => state.ensureCurrentSession);
  const currentSessionId = useChatStore(state => state.currentSession);
  const currentSession = useChatStore(state => state.sessions.find(session => session.id === state.currentSession));
  const setSessionDocument = useChatStore(state => state.setSessionDocument);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [documentsById, setDocumentsById] = useState<Record<string, DocumentInfo>>({});
  const [uploadingKind, setUploadingKind] = useState<"jd" | "resume" | null>(null);
  const [attachmentError, setAttachmentError] = useState("");

  useEffect(() => { ensureCurrentSession(); }, [ensureCurrentSession]);

  useEffect(() => {
    let alive = true;
    void fetch("/api/models")
      .then(response => responseJson<{ models: ModelInfo[] }>(response))
      .then(result => {
        if (!alive) return;
        setModels(result.models);
        setModelId(current => result.models.some(model => model.id === current) ? current : result.models[0]?.id || "");
      })
      .catch(cause => { if (alive) setAttachmentError(cause instanceof Error ? cause.message : "模型列表加载失败"); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    for (const [kind, id] of [["jd", currentSession?.jdDocumentId], ["resume", currentSession?.resumeDocumentId]] as const) {
      if (!id) continue;
      void fetch(`/api/documents/${encodeURIComponent(id)}`)
        .then(response => responseJson<{ document: DocumentInfo }>(response))
        .then(result => {
          if (!alive) return;
          setDocumentsById(current => ({ ...current, [id]: result.document }));
          if (result.document.parseStatus !== "ready" && currentSessionId) setSessionDocument(currentSessionId, kind, undefined);
        })
        .catch(cause => { if (alive) setAttachmentError(cause instanceof Error ? cause.message : "材料预览加载失败"); });
    }
    return () => { alive = false; };
  }, [currentSession?.jdDocumentId, currentSession?.resumeDocumentId, currentSessionId, setSessionDocument]);

  const upload = async (kind: "jd" | "resume", file: File): Promise<boolean> => {
    if (!currentSessionId) return false;
    const targetSessionId = currentSessionId;
    setUploadingKind(kind);
    setAttachmentError("");
    try {
      const body = new FormData();
      body.append("kind", kind);
      body.append("file", file);
      const result = await responseJson<{ document: DocumentInfo }>(await fetch("/api/documents", { method: "POST", body }));
      if (result.document.parseStatus !== "ready" || !result.document.extractedText.trim()) {
        setAttachmentError(result.document.message || `${file.name} 未提取到文字，请上传可复制文本的文件或粘贴原文。`);
        return false;
      }
      setDocumentsById(current => ({ ...current, [result.document.id]: result.document }));
      setSessionDocument(targetSessionId, kind, result.document.id);
      return true;
    } catch (cause) {
      setAttachmentError(cause instanceof Error ? cause.message : "材料上传失败");
      return false;
    } finally {
      setUploadingKind(null);
    }
  };

  const { isGenerating, regenerateMessage, sendMessage, stopMessage } = useSendMessage(modelId);

  return <div className="main">
    <div className="main-top">
      {currentSession?.messages.length ? <MessageList isGenerating={isGenerating} onRegenerate={regenerateMessage} />
        : <SuggestionCards disabled={isGenerating || !modelId} onSelect={prompt => { void sendMessage(prompt); }} />}
    </div>
    <div className="main-bottom">
      <SearchBox
        isGenerating={isGenerating}
        sendMessage={sendMessage}
        stopMessage={stopMessage}
        models={models}
        modelId={modelId}
        onModelChange={setModelId}
        session={currentSession}
        documents={{ jd: currentSession?.jdDocumentId ? documentsById[currentSession.jdDocumentId] : undefined, resume: currentSession?.resumeDocumentId ? documentsById[currentSession.resumeDocumentId] : undefined }}
        uploadingKind={uploadingKind}
        attachmentError={attachmentError}
        onUpload={upload}
        onRemove={kind => { if (currentSessionId) setSessionDocument(currentSessionId, kind, undefined); }}
      />
    </div>
  </div>;
};

export default Main;
