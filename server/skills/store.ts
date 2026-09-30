import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { builtInSkills, type Skill, type SkillInput } from "./catalog";

const dataDir = path.resolve(process.env.SKILLS_DATA_DIR ?? path.join(process.cwd(), "data"));
mkdirSync(dataDir, { recursive: true });

// ponytail: synchronous SQLite is sufficient for the single-process M1 server; move to a managed DB when multi-instance deployment is needed.
const db = new DatabaseSync(path.join(dataDir, "skills.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_skills (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    payload TEXT NOT NULL
  )
`);

export function closeSkillsStore(): void {
  db.close();
}

type SkillRow = { id: string; owner_id: string; version: number; payload: string };

const fromRow = (row: SkillRow): Skill => ({
  ...JSON.parse(row.payload) as SkillInput,
  id: row.id,
  ownerId: row.owner_id,
  version: row.version,
  enabled: true,
});

export function listSkills(ownerId = "local"): Skill[] {
  const rows = db.prepare("SELECT * FROM custom_skills WHERE owner_id = ? ORDER BY rowid DESC").all(ownerId) as SkillRow[];
  return [...builtInSkills, ...rows.map(fromRow)];
}

export function getSkill(id: string, ownerId = "local"): Skill | null {
  const builtIn = builtInSkills.find(skill => skill.id === id);
  if (builtIn) return builtIn;
  const row = db.prepare("SELECT * FROM custom_skills WHERE id = ? AND owner_id = ?").get(id, ownerId) as SkillRow | undefined;
  return row ? fromRow(row) : null;
}

export function createSkill(input: SkillInput, ownerId = "local"): Skill {
  const id = randomUUID();
  db.prepare("INSERT INTO custom_skills (id, owner_id, version, payload) VALUES (?, ?, 1, ?)")
    .run(id, ownerId, JSON.stringify(input));
  return { ...input, id, ownerId, version: 1, enabled: true };
}

export function updateSkill(id: string, input: SkillInput, ownerId = "local"): Skill | null {
  const old = getSkill(id, ownerId);
  if (!old || old.ownerId !== ownerId) return null;
  const version = old.version + 1;
  db.prepare("UPDATE custom_skills SET version = ?, payload = ? WHERE id = ? AND owner_id = ?")
    .run(version, JSON.stringify(input), id, ownerId);
  return { ...input, id, ownerId, version, enabled: true };
}

export function deleteSkill(id: string, ownerId = "local"): boolean {
  return db.prepare("DELETE FROM custom_skills WHERE id = ? AND owner_id = ?").run(id, ownerId).changes > 0;
}
