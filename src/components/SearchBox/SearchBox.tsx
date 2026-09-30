import { useCallback, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import type { DocumentInfo, ModelInfo, SkillInfo } from "@/type/api";
import type { Session } from "@/type/chat";
import "./SearchBox.css";

type SearchBoxProps = {
  isGenerating: boolean;
  sendMessage: (content: string) => Promise<void>;
  stopMessage: () => void;
  models: ModelInfo[];
  modelId: string;
  onModelChange: (id: string) => void;
  skills: SkillInfo[];
  session?: Session;
  documents: Partial<Record<"jd" | "resume", DocumentInfo>>;
  uploadingKind: "jd" | "resume" | null;
  attachmentError: string;
  onUpload: (kind: "jd" | "resume", file: File) => Promise<boolean>;
  onRemove: (kind: "jd" | "resume") => void;
  onOptionsChange: (options: { skillId?: string; durationMinutes?: number; difficulty?: "easy" | "medium" | "hard" }) => void;
};

const SearchBox = ({ isGenerating, sendMessage, stopMessage, models, modelId, onModelChange, skills, session, documents, uploadingKind, attachmentError, onUpload, onRemove, onOptionsChange }: SearchBoxProps) => {
  const [inputValue, setInputValue] = useState("");
  const [pasteKind, setPasteKind] = useState<"jd" | "resume">("jd");
  const [pasteText, setPasteText] = useState("");

  const handleTranscript = useCallback((transcript: string) => {
    setInputValue((currentValue) => {
      if (!currentValue.trim()) return transcript;
      return `${currentValue.trimEnd()} ${transcript}`;
    });
  }, []);

  const {
    error: voiceError,
    isSupported: isVoiceSupported,
    status: voiceStatus,
    transcript: voiceTranscript,
    toggle: toggleVoiceInput,
  } = useSpeechRecognition({ onTranscript: handleTranscript });

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const content = inputValue.trim();
    if (!content || isGenerating || !modelId || uploadingKind) return;

    void sendMessage(content);
    setInputValue("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing) return;
    if (event.shiftKey) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const voiceButtonLabel = voiceStatus === "recording"
    ? "停止语音输入"
    : "开始语音输入";

  return (
    <div className="searchBoxWrapper">
      <div className="composerToolbar">
        <label className="modelSelector">模型<select aria-label="聊天模型" value={modelId} onChange={event => onModelChange(event.target.value)} disabled={isGenerating || !models.length}><option value="">请选择模型</option>{models.map(model => <option value={model.id} key={model.id}>{model.label}</option>)}</select></label>
        {(["jd", "resume"] as const).map(kind => <label className="uploadButton" key={kind}>{uploadingKind === kind ? "解析中…" : `上传${kind === "jd" ? " JD" : "简历"}`}<input type="file" accept=".pdf,.docx,.txt,.md" aria-label={`上传${kind === "jd" ? " JD" : "简历"}`} disabled={isGenerating || Boolean(uploadingKind)} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void onUpload(kind, file); event.currentTarget.value = ""; }} /></label>)}
        <details className="pasteMaterial"><summary>粘贴材料</summary><div className="pastePanel"><label>材料类型<select value={pasteKind} onChange={event => setPasteKind(event.target.value as "jd" | "resume")}><option value="jd">岗位 JD</option><option value="resume">个人简历</option></select></label><textarea aria-label="粘贴材料原文" rows={5} value={pasteText} onChange={event => setPasteText(event.target.value)} placeholder="粘贴 JD 或简历原文" /><button type="button" disabled={!pasteText.trim() || isGenerating || Boolean(uploadingKind)} onClick={() => { void onUpload(pasteKind, new File([pasteText.trim()], pasteKind === "jd" ? "岗位 JD.txt" : "个人简历.txt", { type: "text/plain" })).then(ok => { if (ok) setPasteText(""); }); }}>附加文本</button></div></details>
        <details className="chatOptions"><summary>Skill / 面试参数</summary><div className="optionFields"><label>Skill<select value={session?.skillId || ""} onChange={event => onOptionsChange({ skillId: event.target.value || undefined })}><option value="">自动选择</option>{skills.map(skill => <option value={skill.id} key={skill.id}>{skill.name}</option>)}</select></label><label>时长<select value={session?.durationMinutes || 20} onChange={event => onOptionsChange({ durationMinutes: Number(event.target.value) })}>{[10, 20, 30, 45, 60].map(minutes => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select></label><label>难度<select value={session?.difficulty || "medium"} onChange={event => onOptionsChange({ difficulty: event.target.value as "easy" | "medium" | "hard" })}><option value="easy">基础</option><option value="medium">标准</option><option value="hard">进阶</option></select></label></div></details>
      </div>

      {(session?.jdDocumentId || session?.resumeDocumentId) && <div className="attachedDocuments" aria-label="当前会话材料">{(["jd", "resume"] as const).map(kind => {
        const id = kind === "jd" ? session.jdDocumentId : session.resumeDocumentId;
        if (!id) return null;
        const document = documents[kind];
        return <details key={kind}><summary>{kind === "jd" ? "JD" : "简历"} · {document?.filename || "正在加载预览…"}</summary><p>{document?.extractedText.slice(0, 1800) || "预览暂不可用"}</p><button type="button" onClick={() => onRemove(kind)}>移除材料</button></details>;
      })}</div>}
      {attachmentError && <p className="attachmentError" role="alert">{attachmentError}</p>}
      <form className="searchBox" onSubmit={handleSearchSubmit}>
        <textarea
          rows={1}
          aria-label="消息内容"
          placeholder="输入面试、简历匹配或公司背调需求"
          value={voiceStatus === "recording" ? voiceTranscript || inputValue : inputValue}
          readOnly={voiceStatus !== "idle"}
          onKeyDown={handleKeyDown}
          onChange={(event) => setInputValue(event.target.value)}
        />

        <div className="searchActions">
          <button
            type="button"
            className={`voiceButton ${voiceStatus}`}
            aria-label={voiceButtonLabel}
            aria-pressed={voiceStatus === "recording"}
            title={isVoiceSupported ? voiceButtonLabel : "当前浏览器不支持语音输入"}
            disabled={!isVoiceSupported || isGenerating || voiceStatus === "processing"}
            onClick={toggleVoiceInput}
          >
            <span aria-hidden="true">🎙</span>
          </button>

          {isGenerating ? (
            <button type="button" className="stopButton" onClick={() => stopMessage()}>
              停止
            </button>
          ) : (
            <button type="submit" disabled={!inputValue.trim() || !modelId || Boolean(uploadingKind)}>
              发送
            </button>
          )}
        </div>
      </form>

      <div className="voiceFeedback" aria-live="polite">
        {voiceError ? (
          <p className="voiceError" role="alert">{voiceError}</p>
        ) : voiceStatus !== "idle" ? (
          <p>{voiceStatus === "recording" ? "正在聆听，再次点击麦克风结束" : "正在整理识别结果"}</p>
        ) : null}
      </div>
    </div>
  );
};

export default SearchBox;
