import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./Settings.css";

type Stage = { id: string; name: string; goal: string };
type Prompts = { system?: string; question?: string; assessment?: string; report?: string };
type Skill = {
  id: string;
  name: string;
  description: string;
  kind: string;
  ownerId: string | null;
  stages: Stage[];
  prompts: Prompts;
};
type Draft = { id?: string; name: string; description: string; kind: string; stages: string; prompts: Prompts };

const emptyDraft: Draft = {
  name: "", description: "", kind: "interview",
  stages: "开场：了解岗位动机\n经历深挖：核验个人贡献\n情境问题：考察 JD 核心能力",
  prompts: {},
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || `请求失败（${response.status}）`);
  return body as T;
}

const Settings = ({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    void request<{ skills: Skill[] }>("/api/skills")
      .then(result => setSkills(result.skills))
      .catch(cause => setError(cause instanceof Error ? cause.message : "Skill 加载失败"));
  }, []);

  const refresh = async () => {
    const result = await request<{ skills: Skill[] }>("/api/skills");
    setSkills(result.skills);
    onSaved();
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const stages = draft.stages.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
      const separator = line.search(/[:：]/);
      const name = (separator < 0 ? line : line.slice(0, separator)).trim();
      const goal = (separator < 0 ? line : line.slice(separator + 1)).trim() || name;
      return { id: `stage-${index + 1}`, name, goal };
    });
    if (!stages.length) { setError("至少需要一个 Skill 阶段"); return; }
    setBusy(true);
    setError("");
    try {
      await request(draft.id ? `/api/skills/${encodeURIComponent(draft.id)}` : "/api/skills", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), description: draft.description.trim(), kind: draft.kind, stages, prompts: draft.prompts, allowedTools: [] }),
      });
      await refresh();
      setDraft(emptyDraft);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Skill 保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skill: Skill) => {
    if (!window.confirm(`删除自定义 Skill「${skill.name}」？`)) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Skill 删除失败");
    } finally {
      setBusy(false);
    }
  };

  return <dialog ref={dialog} className="settingsDialog" onClose={onClose} aria-labelledby="settings-title">
    <div className="settingsHeader"><div><h2 id="settings-title">设置</h2><p>管理聊天可使用的 Skill 配置。</p></div><button type="button" onClick={() => dialog.current?.close()} aria-label="关闭设置">×</button></div>
    {error && <p className="settingsError" role="alert">{error}</p>}
    <div className="settingsSkillHeader"><h3>Skill 目录</h3><button type="button" onClick={() => { setDraft(emptyDraft); setEditing(true); }}>新建 Skill</button></div>
    <div className="settingsSkillList">{skills.map(skill => <div key={skill.id} className="settingsSkillItem"><div><strong>{skill.name}</strong><span>{skill.ownerId ? "自定义" : "内置"}</span><p>{skill.description}</p></div>{skill.ownerId && <div className="settingsSkillActions"><button type="button" onClick={() => { setDraft({ id: skill.id, name: skill.name, description: skill.description, kind: skill.kind, stages: skill.stages.map(stage => `${stage.name}：${stage.goal}`).join("\n"), prompts: skill.prompts }); setEditing(true); }}>编辑</button><button type="button" disabled={busy} onClick={() => void remove(skill)}>删除</button></div>}</div>)}</div>
    {editing && <form className="settingsEditor" onSubmit={event => void save(event)}>
      <h3>{draft.id ? "编辑 Skill" : "新建 Skill"}</h3>
      <div className="settingsFields"><label>名称<input required maxLength={80} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label><label>类型<select value={draft.kind} onChange={event => setDraft(current => ({ ...current, kind: event.target.value }))}><option value="interview">模拟面试</option><option value="resume-match">JD 与简历匹配</option><option value="company-research">公司背调</option></select></label></div>
      <label>说明<input required maxLength={500} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></label>
      <label>阶段（每行“名称：目标”）<textarea required rows={4} value={draft.stages} onChange={event => setDraft(current => ({ ...current, stages: event.target.value }))} /></label>
      <details><summary>提示词</summary>{(["system", "question", "assessment", "report"] as const).map(key => <label key={key}>{({ system: "系统规则", question: "提问规则", assessment: "评估规则", report: "报告规则" })[key]}<textarea rows={3} value={draft.prompts[key] || ""} onChange={event => setDraft(current => ({ ...current, prompts: { ...current.prompts, [key]: event.target.value } }))} /></label>)}</details>
      <p className="settingsHint">自定义 Skill 只包含阶段与提示词；不能执行脚本，工具权限由服务端控制。</p>
      <div className="settingsEditorActions"><button type="button" onClick={() => setEditing(false)}>取消</button><button type="submit" disabled={busy}>{busy ? "保存中…" : "保存 Skill"}</button></div>
    </form>}
  </dialog>;
};

export default Settings;
