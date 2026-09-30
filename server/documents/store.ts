import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DocumentBlock, DocumentKind, ParsedDocument } from "./parse";

export type DocumentRecord = {
  id: string;
  ownerId: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  originalRef: string;
  extractedText: string;
  blocks: DocumentBlock[];
  parseStatus: ParsedDocument["parseStatus"];
  createdAt: string;
};

const dataDir = resolve(process.env.DOCUMENTS_DATA_DIR ?? join(process.cwd(), "data", "documents"));
let database: DatabaseSync | undefined;

export function closeDocumentsStore(): void {
  database?.close();
  database = undefined;
}

function db(): DatabaseSync {
  if (!database) {
    mkdirSync(dataDir, { recursive: true });
    database = new DatabaseSync(join(dataDir, "documents.sqlite"));
    database.exec(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      original_ref TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      blocks_json TEXT NOT NULL,
      parse_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  }
  return database;
}

export function getDocument(id: string, ownerId = "local"): DocumentRecord | null {
  const row = db().prepare("SELECT * FROM documents WHERE id = ? AND owner_id = ?").get(id, ownerId) as Record<string, string> | undefined;
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind as DocumentKind,
    filename: row.filename,
    mimeType: row.mime_type,
    originalRef: row.original_ref,
    extractedText: row.extracted_text,
    blocks: JSON.parse(row.blocks_json) as DocumentBlock[],
    parseStatus: row.parse_status as DocumentRecord["parseStatus"],
    createdAt: row.created_at,
  };
}

export async function saveDocument(input: {
  ownerId: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  parsed: ParsedDocument;
}): Promise<DocumentRecord> {
  const id = randomUUID();
  const originalRef = join("originals", `${id}${extname(input.filename).toLowerCase()}`);
  const path = join(dataDir, originalRef);
  const createdAt = new Date().toISOString();
  mkdirSync(join(dataDir, "originals"), { recursive: true });
  await writeFile(path, input.buffer, { flag: "wx" });
  try {
    db().prepare(`INSERT INTO documents (
      id, owner_id, kind, filename, mime_type, original_ref,
      extracted_text, blocks_json, parse_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.ownerId, input.kind, input.filename, input.mimeType,
      originalRef, input.parsed.extractedText, JSON.stringify(input.parsed.blocks),
      input.parsed.parseStatus, createdAt,
    );
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
  return {
    id,
    ownerId: input.ownerId,
    kind: input.kind,
    filename: input.filename,
    mimeType: input.mimeType,
    originalRef,
    ...input.parsed,
    createdAt,
  };
}
