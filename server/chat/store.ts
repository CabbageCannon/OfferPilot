import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PendingTask = {
  intent: "start_interview" | "resume_match" | "company_research";
  modelId: string;
  skillId?: string;
  durationMinutes?: number;
  difficulty?: "easy" | "medium" | "hard";
  companyName?: string;
};

export type ChatSession = {
  id: string;
  ownerId: string;
  jdDocumentId?: string;
  resumeDocumentId?: string;
  linkedJdDocumentId?: string;
  linkedResumeDocumentId?: string;
  interviewId?: string;
  pending?: PendingTask;
  pendingAnswer?: string;
  summary: string;
  updatedAt: string;
};

export type ChatResponse = { inputHash: string; content: string; finishReason: "stop" | "length" };

const dataDir = resolve(process.env.CHAT_DATA_DIR ?? join(process.cwd(), "data"));
let database: DatabaseSync | undefined;

function db(): DatabaseSync {
  if (!database) {
    mkdirSync(dataDir, { recursive: true });
    database = new DatabaseSync(join(dataDir, "chat.sqlite"));
    database.exec(`CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, owner_id)
    );
    CREATE TABLE IF NOT EXISTS chat_responses (
      session_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      content TEXT NOT NULL,
      finish_reason TEXT NOT NULL,
      PRIMARY KEY (session_id, owner_id, request_id)
    );`);
  }
  return database;
}

export function closeChatStore(): void {
  database?.close();
  database = undefined;
}

export function getChatSession(id: string, ownerId = "local"): ChatSession | null {
  const row = db().prepare("SELECT payload FROM chat_sessions WHERE id = ? AND owner_id = ?")
    .get(id, ownerId) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) as ChatSession : null;
}

export function saveChatSession(session: ChatSession): void {
  session.updatedAt = new Date().toISOString();
  db().prepare(`INSERT INTO chat_sessions (id, owner_id, payload, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id, owner_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
    .run(session.id, session.ownerId, JSON.stringify(session), session.updatedAt);
}

export function getChatResponse(sessionId: string, requestId: string, ownerId = "local"): ChatResponse | null {
  const row = db().prepare("SELECT input_hash, content, finish_reason FROM chat_responses WHERE session_id = ? AND owner_id = ? AND request_id = ?")
    .get(sessionId, ownerId, requestId) as { input_hash: string; content: string; finish_reason: "stop" | "length" } | undefined;
  return row ? { inputHash: row.input_hash, content: row.content, finishReason: row.finish_reason } : null;
}

export function saveChatResponse(sessionId: string, requestId: string, response: ChatResponse, ownerId = "local"): void {
  db().prepare("INSERT OR IGNORE INTO chat_responses (session_id, owner_id, request_id, input_hash, content, finish_reason) VALUES (?, ?, ?, ?, ?, ?)")
    .run(sessionId, ownerId, requestId, response.inputHash, response.content, response.finishReason);
}
