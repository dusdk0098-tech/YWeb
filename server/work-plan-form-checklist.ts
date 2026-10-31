import type { Express, Request } from "express";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { getWorkPlan } from "./work-plan-model.js";
import { escapeHtml as e } from "./print.js";
import { FORM_MODULES, FORM_POLICY_VERSION, defaultFormChoices, formChoiceProblem, type FormChoice, type FormRequirement } from "./work-plan-form-catalog.js";
// P-01 1단계: 양식사용 체크리스트 per work plan, kept beside the plan body so plan snapshots stay byte-identical.
// Editable only while the plan is a draft (archived plans keep the list they had).
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
export function migrateWorkPlanFormChecklists(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS work_plan_form_checklists(plan_id TEXT PRIMARY KEY REFERENCES work_plans(id),site_id TEXT NOT NULL REFERENCES sites(id),policy_version TEXT NOT NULL,
  body TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),updated_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS work_plan_checklist_draft_insert BEFORE INSERT ON work_plan_form_checklists WHEN NOT EXISTS(
  SELECT 1 FROM work_plans WHERE id=NEW.plan_id AND site_id=NEW.site_id AND status='draft')
 BEGIN SELECT RAISE(ABORT,'Checklist requires a draft plan'); END;
 CREATE TRIGGER IF NOT EXISTS work_plan_checklist_draft_update BEFORE UPDATE ON work_plan_form_checklists WHEN NEW.plan_id IS NOT OLD.plan_id OR NEW.site_id IS NOT OLD.site_id OR
  NOT EXISTS(SELECT 1 FROM work_plans WHERE id=OLD.plan_id AND status='draft')
 BEGIN SELECT RAISE(ABORT,'Checklist requires a draft plan'); END;
 CREATE TRIGGER IF NOT EXISTS work_plan_checklist_retained BEFORE DELETE ON work_plan_form_checklists BEGIN SELECT RAISE(ABORT,'Checklist retained'); END;
 PRAGMA user_version=65;
`);
}
const choice = z.object({
  type: z.enum(FORM_MODULES.map((m) => m.type) as [FormChoice["type"], ...FormChoice["type"][]]),
  included: z.boolean(),
  exclusionReason: z.string().trim().max(500),
  note: z.string().trim().max(500),
}).strict();
const checklistSave = z.object({ version: z.number().int().min(0), choices: z.array(choice) }).strict();
const LEVEL: Record<FormRequirement, string> = { REQUIRED: "필수", RECOMMENDED: "권장", OPTIONAL: "선택" };
type Row = { body: string; version: number; policy_version: string; updated_at: string };
export function formChecklist(db: Db, planId: string) {
  const row = db.prepare("SELECT body,version,policy_version,updated_at FROM work_plan_form_checklists WHERE plan_id=?").get(planId) as Row | undefined;
  return row
    ? { saved: true, version: row.version, policyVersion: row.policy_version, updatedAt: row.updated_at, choices: JSON.parse(row.body) as FormChoice[] }
    : { saved: false, version: 0, policyVersion: FORM_POLICY_VERSION, updatedAt: null, choices: defaultFormChoices() };
}
export function registerWorkPlanFormChecklists(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const base = "/api/sites/:siteId/work-plans/:id/form-checklist";
  const plan = (req: Request) => getWorkPlan(db, String(req.params.siteId), String(req.params.id));
  app.get(base, (req, res) => { access(req); res.json(formChecklist(db, plan(req).id)); });
  app.put(base, (req, res) => {
    access(req, true);
    const v = checklistSave.parse(req.body), problem = formChoiceProblem(v.choices);
    if (problem) throw new HttpError(400, problem);
    mutate(req, res, `work-plan:form-checklist:${req.params.siteId}:${req.params.id}`, v, () => {
      const row = plan(req);
      if (row.author_id !== req.session.userId) throw new HttpError(403, "작업계획 작성자만 양식 체크리스트를 바꿀 수 있습니다.");
      if (row.status !== "draft") throw new HttpError(409, "보관된 작업계획의 체크리스트는 바꿀 수 없습니다. 개정 초안에서 다시 정하세요.");
      const current = formChecklist(db, row.id);
      if (current.version !== v.version) throw new HttpError(409, "다른 곳에서 체크리스트가 바뀌었습니다. 입력을 보관하고 최신 내용을 확인하세요.");
      const choices = FORM_MODULES.map((m) => v.choices.find((c) => c.type === m.type)!), now = new Date().toISOString();
      if (current.saved) db.prepare("UPDATE work_plan_form_checklists SET body=?,version=version+1,updated_by=?,updated_at=? WHERE plan_id=?").run(JSON.stringify(choices), req.session.userId!, now, row.id);
      else db.prepare("INSERT INTO work_plan_form_checklists VALUES(?,?,?,?,1,?,?)").run(row.id, row.site_id, FORM_POLICY_VERSION, JSON.stringify(choices), req.session.userId!, now);
      audit(db, req.session.userId!, row.site_id, "work_plan.form_checklist_saved", row.id);
      return formChecklist(db, row.id);
    }, () => { access(req, true); plan(req); });
  });
  app.get(base + "/print", (req, res) => {
    access(req);
    const row = plan(req), list = formChecklist(db, row.id), title = (JSON.parse(row.body) as { title?: string }).title ?? "";
    const rows = FORM_MODULES.map((m) => {
      const c = list.choices.find((x) => x.type === m.type)!;
      return `<tr><td>${e(m.sheet)}</td><th>${e(m.title)}</th><td>${LEVEL[m.requirement]}</td><td>${c.included ? "포함" : "제외"}</td><td>${e(c.exclusionReason)}</td><td>${e(c.note)}</td><td>${e(m.app)}</td></tr>`;
    }).join("");
    res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>양식사용 체크리스트</title><link rel="stylesheet" href="/print.css"></head><body><main>
<section class="form-page"><h1>양식사용 체크리스트</h1><p>작업계획: ${e(title)} · ${row.status === "draft" ? "작성 중" : "보관본"} · ${list.saved ? `v${list.version} 저장 ${e(list.updatedAt)}` : "저장 전 기본값"} · 정책 ${e(list.policyVersion)}</p>
<table><thead><tr><th>원본 시트</th><th>양식</th><th>구분</th><th>포함</th><th>제외 사유</th><th>메모</th><th>이 앱</th></tr></thead><tbody>${rows}</tbody></table>
<p>원본 P 앱의 양식 구성 기준입니다. 포함 여부는 작성자의 선택이며 법적 필수 서류 판정이 아닙니다. 계산 양식은 공학 검토(P-02) 전까지 이 앱에서 계산하지 않습니다.</p></section>
</main></body></html>`);
  });
}
