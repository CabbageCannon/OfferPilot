import { basename } from "node:path";
import { Router } from "express";
import multer from "multer";
import {
  DocumentError,
  getDocument,
  MAX_DOCUMENT_BYTES,
  parseDocument,
  saveDocument,
  type DocumentRecord,
} from "../documents";

const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: "utf8",
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 1, parts: 2 },
}).single("file");

function publicDocument(document: DocumentRecord) {
  const { id, kind, filename, mimeType, extractedText, blocks, parseStatus, createdAt } = document;
  return {
    id, kind, filename, mimeType, extractedText, blocks, parseStatus, createdAt,
    ...(parseStatus === "needs_ocr" ? { message: "无法提取文字，可能是扫描版 PDF。请上传可复制文字的文件或粘贴内容。" } : {}),
  };
}

export function createDocumentsRouter(): Router {
  const router = Router();

  router.post("/documents", async (request, response) => {
    if (!request.is("multipart/form-data")) {
      response.status(415).json({ code: "INVALID_CONTENT_TYPE", message: "请使用 multipart/form-data 上传文件" });
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        upload(request, response, (error) => error ? reject(error) : resolve());
      });
      if (request.body.kind !== "jd" && request.body.kind !== "resume") {
        throw new DocumentError("INVALID_KIND", "kind 必须为 jd 或 resume", 400);
      }
      if (!request.file) {
        throw new DocumentError("MISSING_FILE", "请上传文件字段 file", 400);
      }
      const filename = basename(request.file.originalname.replaceAll("\\", "/"));
      if (!filename || filename.length > 255) {
        throw new DocumentError("INVALID_FILENAME", "文件名无效或过长", 400);
      }
      const parsed = await parseDocument(filename, request.file.mimetype, request.file.buffer);
      // M1 是匿名本地开发；公开版必须从认证会话取得 ownerId。
      const document = await saveDocument({
        ownerId: "local",
        kind: request.body.kind,
        filename,
        mimeType: request.file.mimetype,
        buffer: request.file.buffer,
        parsed,
      });
      response.status(201).json({ document: publicDocument(document) });
    } catch (error) {
      if (error instanceof multer.MulterError) {
        const tooLarge = error.code === "LIMIT_FILE_SIZE";
        response.status(tooLarge ? 413 : 400).json({
          code: tooLarge ? "FILE_TOO_LARGE" : "INVALID_UPLOAD",
          message: tooLarge ? "文件不能超过 8 MB" : "上传格式不正确，只能提交一个 file 和一个 kind",
        });
      } else if (error instanceof DocumentError) {
        response.status(error.status).json({ code: error.code, message: error.message });
      } else {
        response.status(500).json({ code: "INTERNAL_ERROR", message: "文档处理失败" });
      }
    }
  });

  router.get("/documents/:id", (request, response) => {
    const document = getDocument(String(request.params.id), "local");
    if (!document) {
      response.status(404).json({ code: "DOCUMENT_NOT_FOUND", message: "文档不存在" });
      return;
    }
    response.json({ document: publicDocument(document) });
  });

  return router;
}
