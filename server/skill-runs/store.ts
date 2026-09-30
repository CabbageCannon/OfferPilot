import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SkillRunKind = "resume-match" | "company-research";
export type SkillRunRecord = {
  id: string;
  ownerId: string;
  kind: SkillRunKind;
  modelId: string;
  skillId: string;
  input: unknown;
  result: unknown;
  createdAt: string;
};
export type SkillRunSummary = Pick<SkillRunRecord, "id" | "kind" | "modelId" | "skillId" | "createdAt"> & { title: string };
export type SaveSkillRunInput = Pick<SkillRunRecord, "kind" | "modelId" | "skillId" | "input" | "result"> & { ownerId?: string };

const dataDir = resolve(process.env.SKILL_RUNS_DATA_DIR ?? join(process.cwd(), "data"));
let database: DatabaseSync | undefined;

function db(): DatabaseSync {
  if (!database) {
    mkdirSync(dataDir, { recursive: true });
    database = new DatabaseSync(join(dataDir, "skill-runs.sqlite"));
    database.exec(`CREATE TABLE IF NOT EXISTS skill_runs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      model_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS skill_runs_owner_created ON skill_runs(owner_id, created_at DESC);`);
  }
  return database;
}

export function closeSkillRunsStore(): void {
  database?.close();
  database = undefined;
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Skill 运行数据必须是 JSON 值");
  return serialized;
}

export function saveSkillRun(input: SaveSkillRunInput): SkillRunRecord {
  const record: SkillRunRecord = {
    id: randomUUID(),
    ownerId: input.ownerId ?? "local",
    kind: input.kind,
    modelId: input.modelId,
    skillId: input.skillId,
    input: input.input,
    result: input.result,
    createdAt: new Date().toISOString(),
  };
  db().prepare("INSERT INTO skill_runs (id, owner_id, kind, model_id, skill_id, input_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    record.id, record.ownerId, record.kind, record.modelId, record.skillId,
    json(record.input), json(record.result), record.createdAt,
  );
  return record;
}

type RunRow = {
  id: string; owner_id: string; kind: SkillRunKind; model_id: string; skill_id: string;
  input_json: string; result_json: string; created_at: string;
};

export function getSkillRun(id: string, ownerId = "local"): SkillRunRecord | null {
  const row = db().prepare("SELECT * FROM skill_runs WHERE id = ? AND owner_id = ?").get(id, ownerId) as RunRow | undefined;
  return row ? {
    id: row.id, ownerId: row.owner_id, kind: row.kind, modelId: row.model_id, skillId: row.skill_id,
    input: JSON.parse(row.input_json) as unknown, result: JSON.parse(row.result_json) as unknown, createdAt: row.created_at,
  } : null;
}

export function listSkillRuns(ownerId = "local"): SkillRunSummary[] {
  const rows = db().prepare("SELECT id, kind, model_id, skill_id, input_json, created_at FROM skill_runs WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC")
    .all(ownerId) as Pick<RunRow, "id" | "kind" | "model_id" | "skill_id" | "input_json" | "created_at">[];
  return rows.map(row => {
    const input = JSON.parse(row.input_json) as unknown;
    const companyName = input && typeof input === "object" && "companyName" in input ? input.companyName : undefined;
    return {
      id: row.id, kind: row.kind, modelId: row.model_id, skillId: row.skill_id, createdAt: row.created_at,
      title: row.kind === "company-research" ? (typeof companyName === "string" ? `${companyName}背调` : "公司背调") : "JD 与简历匹配",
    };
  });
}
