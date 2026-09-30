import { extname } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_LENGTH = 1_000_000;

export type DocumentKind = "jd" | "resume";
export type DocumentBlock = { text: string; page?: number; section?: number };
export type ParsedDocument = {
  extractedText: string;
  blocks: DocumentBlock[];
  parseStatus: "ready" | "needs_ocr";
};

export class DocumentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const formats: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain", "text/x-markdown"],
};

export async function parseDocument(
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<ParsedDocument> {
  const extension = extname(filename).toLowerCase();
  const allowedMimes = formats[extension];
  if (!allowedMimes || (mimeType && mimeType !== "application/octet-stream" && !allowedMimes.includes(mimeType))) {
    throw new DocumentError("UNSUPPORTED_FILE", "仅支持 PDF、DOCX、TXT、MD 文件，且文件类型须与扩展名一致", 415);
  }
  if (!buffer.length) {
    throw new DocumentError("EMPTY_FILE", "文件为空", 422);
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentError("FILE_TOO_LARGE", "文件不能超过 8 MB", 413);
  }

  let blocks: DocumentBlock[];
  if (extension === ".pdf") {
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new DocumentError("INVALID_FILE_CONTENT", "PDF 文件内容无效", 422);
    }
    let parser: PDFParse | undefined;
    try {
      parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      blocks = result.pages.map(({ num, text }) => ({ text: text.trim(), page: num })).filter(({ text }) => text);
    } catch {
      throw new DocumentError("UNREADABLE_DOCUMENT", "PDF 无法解析，请检查文件是否损坏或加密", 422);
    } finally {
      await parser?.destroy().catch(() => undefined);
    }
  } else if (extension === ".docx") {
    if (!buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new DocumentError("INVALID_FILE_CONTENT", "DOCX 文件内容无效", 422);
    }
    try {
      const result = await mammoth.extractRawText({ buffer });
      blocks = result.value.split(/\n+/).map((text, index) => ({ text: text.trim(), section: index + 1 })).filter(({ text }) => text);
    } catch {
      throw new DocumentError("UNREADABLE_DOCUMENT", "DOCX 无法解析，请检查文件是否损坏或加密", 422);
    }
  } else {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
    } catch {
      throw new DocumentError("INVALID_ENCODING", "文本文件须为 UTF-8 编码", 422);
    }
    if (text.includes("\u0000")) {
      throw new DocumentError("INVALID_FILE_CONTENT", "文本文件包含非文本内容", 422);
    }
    blocks = text.split(/\n\s*\n/).map((part, index) => ({ text: part.trim(), section: index + 1 })).filter(({ text }) => text);
  }

  const extractedText = blocks.map(({ text }) => text).join("\n\n");
  if (extractedText.length > MAX_TEXT_LENGTH) {
    throw new DocumentError("TEXT_TOO_LARGE", "提取的文字过长，请上传更精简的材料", 422);
  }
  if (!extractedText) {
    if (extension === ".pdf") {
      return { extractedText: "", blocks: [], parseStatus: "needs_ocr" };
    }
    throw new DocumentError("EMPTY_DOCUMENT", "文件中没有可提取的文字", 422);
  }
  return { extractedText, blocks, parseStatus: "ready" };
}
