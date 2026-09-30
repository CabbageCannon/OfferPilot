import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Skill } from "../skills/catalog";

export type Assessment = {
  score: number;
  evidence: string[];
  gaps: string[];
  followUp: boolean;
};

export type InterviewTurn = {
  id: string;
  sequence: number;
  stageId: string;
  question: string;
  questionModelId?: string;
  answer?: string;
  answerRequestId?: string;
  assessment?: Assessment;
  assessmentModelId?: string;
  createdAt: string;
};

export type InterviewRecord = {
  id: string;
  ownerId: string;
  jdDocumentId: string;
  resumeDocumentId: string;
  skillId: string;
  skillVersion: number;
  skillSnapshot: Skill;
  modelId: string;
  durationMinutes: number;
  difficulty: "easy" | "medium" | "hard";
  feedbackPreference?: "direct" | "guided";
  startedAt: string;
  status: "active" | "completed";
  stageIndex: number;
  turns: InterviewTurn[];
  report?: string;
  reportModelId?: string;
};

const dataDir = path.resolve(process.env.INTERVIEWS_DATA_DIR ?? path.join(process.cwd(), "data"));
mkdirSync(dataDir, { recursive: true });

// ponytail: one SQLite JSON row per interview is enough for M1; normalize turns when concurrent workers are introduced.
const db = new DatabaseSync(path.join(dataDir, "interviews.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS interviews_owner_updated ON interviews(owner_id, updated_at DESC);
`);

export function closeInterviewsStore(): void {
  db.close();
}

export function saveInterview(interview: InterviewRecord): void {
  db.prepare(`INSERT INTO interviews (id, owner_id, payload, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
    .run(interview.id, interview.ownerId, JSON.stringify(interview), new Date().toISOString());
}

export function getInterview(id: string, ownerId = "local"): InterviewRecord | null {
  const row = db.prepare("SELECT payload FROM interviews WHERE id = ? AND owner_id = ?")
    .get(id, ownerId) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) as InterviewRecord : null;
}

export function listInterviews(ownerId = "local"): InterviewRecord[] {
  const rows = db.prepare("SELECT payload FROM interviews WHERE owner_id = ? ORDER BY updated_at DESC")
    .all(ownerId) as { payload: string }[];
  return rows.map(row => JSON.parse(row.payload) as InterviewRecord);
}
