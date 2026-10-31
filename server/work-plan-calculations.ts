import type { Express, Request } from "express";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { getWorkPlan } from "./work-plan-model.js";
import { escapeHtml as e } from "./print.js";
import { CALC_FORMULA_VERSION, calcBody, evaluateCalc, type CalcBody } from "./equipment-calc.js";
// P-02: equipment calculation inputs per work plan, beside the plan body (plan snapshots stay byte-identical). Inputs only are
// stored; results are recomputed from them. Editable by the plan author while the plan is a draft, kept after archive.
// Per the owner's decision the "not reviewed by an engineer" warnings live in the editor only — the print below has none.
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
export function migrateWorkPlanCalculations(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS work_plan_calculations(plan_id TEXT PRIMARY KEY REFERENCES work_plans(id),site_id TEXT NOT NULL REFERENCES sites(id),formula_version TEXT NOT NULL,
  body TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>=1),updated_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS work_plan_calc_draft_insert BEFORE INSERT ON work_plan_calculations WHEN NOT EXISTS(
  SELECT 1 FROM work_plans WHERE id=NEW.plan_id AND site_id=NEW.site_id AND status='draft')
 BEGIN SELECT RAISE(ABORT,'Calculation requires a draft plan'); END;
 CREATE TRIGGER IF NOT EXISTS work_plan_calc_draft_update BEFORE UPDATE ON work_plan_calculations WHEN NEW.plan_id IS NOT OLD.plan_id OR NEW.site_id IS NOT OLD.site_id OR
  NOT EXISTS(SELECT 1 FROM work_plans WHERE id=OLD.plan_id AND status='draft')
 BEGIN SELECT RAISE(ABORT,'Calculation requires a draft plan'); END;
 CREATE TRIGGER IF NOT EXISTS work_plan_calc_retained BEFORE DELETE ON work_plan_calculations BEGIN SELECT RAISE(ABORT,'Calculation retained'); END;
 PRAGMA user_version=69;
`);
}
const EMPTY: CalcBody = { loadT: 0, hookT: 0, otherT: 0, ground: null, lifting: null, slings: [], shackles: [] };
type Row = { body: string; version: number; formula_version: string; updated_at: string };
export function workPlanCalculation(db: Db, planId: string) {
  const row = db.prepare("SELECT body,version,formula_version,updated_at FROM work_plan_calculations WHERE plan_id=?").get(planId) as Row | undefined;
  const body = row ? (JSON.parse(row.body) as CalcBody) : EMPTY;
  return { saved: !!row, version: row?.version ?? 0, formulaVersion: row?.formula_version ?? CALC_FORMULA_VERSION, updatedAt: row?.updated_at ?? null, body, result: evaluateCalc(body) };
}
// A revision draft starts from the archived plan's inputs when they still fit the current formulas; results are recomputed.
export function copyWorkPlanCalculation(db: Db, fromPlan: string, toPlan: string, site: string, userId: string) {
  const row = db.prepare("SELECT body FROM work_plan_calculations WHERE plan_id=?").get(fromPlan) as { body: string } | undefined;
  const body = row ? calcBody.safeParse(JSON.parse(row.body)) : null;
  if (!body?.success) return;
  db.prepare("INSERT INTO work_plan_calculations VALUES(?,?,?,?,1,?,?)").run(toPlan, site, CALC_FORMULA_VERSION, JSON.stringify(body.data), userId, new Date().toISOString());
}
const save = z.object({ version: z.number().int().min(0), body: calcBody }).strict();
export function registerWorkPlanCalculations(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const base = "/api/sites/:siteId/work-plans/:id/calculations";
  const plan = (req: Request) => getWorkPlan(db, String(req.params.siteId), String(req.params.id));
  app.get(base, (req, res) => { access(req); res.json(workPlanCalculation(db, plan(req).id)); });
  app.put(base, (req, res) => {
    access(req, true);
    const v = save.parse(req.body);
    mutate(req, res, `work-plan:calculations:${req.params.siteId}:${req.params.id}`, v, () => {
      const row = plan(req);
      if (row.author_id !== req.session.userId) throw new HttpError(403, "작업계획 작성자만 장비 계산을 바꿀 수 있습니다.");
      if (row.status !== "draft") throw new HttpError(409, "보관된 작업계획의 장비 계산은 바꿀 수 없습니다. 개정 초안에서 다시 입력하세요.");
      const current = workPlanCalculation(db, row.id);
      if (current.version !== v.version) throw new HttpError(409, "다른 곳에서 장비 계산이 바뀌었습니다. 입력을 보관하고 최신 내용을 확인하세요.");
      const now = new Date().toISOString();
      if (current.saved) db.prepare("UPDATE work_plan_calculations SET body=?,formula_version=?,version=version+1,updated_by=?,updated_at=? WHERE plan_id=?").run(JSON.stringify(v.body), CALC_FORMULA_VERSION, req.session.userId!, now, row.id);
      else db.prepare("INSERT INTO work_plan_calculations VALUES(?,?,?,?,1,?,?)").run(row.id, row.site_id, CALC_FORMULA_VERSION, JSON.stringify(v.body), req.session.userId!, now);
      audit(db, req.session.userId!, row.site_id, "work_plan.calculations_saved", row.id);
      return workPlanCalculation(db, row.id);
    }, () => { access(req, true); plan(req); });
  });
  app.get(base + "/print", (req, res) => {
    access(req);
    const row = plan(req), c = workPlanCalculation(db, row.id), title = (JSON.parse(row.body) as { title?: string }).title ?? "";
    const sections = c.result.checks.map((k) => `<h2>${e(k.title)}</h2><table><thead><tr><th>항목</th><th>식</th><th>값</th></tr></thead><tbody>${
      k.lines.map((l) => `<tr><th>${e(l.label)}</th><td>${e(l.formula)}</td><td>${l.value} ${e(l.unit)}</td></tr>`).join("")}</tbody></table><p><strong>판정: ${e(k.verdict)}</strong></p>`).join("");
    res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>장비 계산서</title><link rel="stylesheet" href="/print.css"></head><body><main>
<section class="form-page"><h1>장비 계산서</h1><p>작업계획: ${e(title)} · ${row.status === "draft" ? "작성 중" : "보관본"} · ${c.saved ? `v${c.version} 저장 ${e(c.updatedAt)}` : "저장 전"} · 계산식 ${e(c.formulaVersion)}</p>
${sections || "<p>입력된 계산이 없습니다.</p>"}</section>
</main></body></html>`);
  });
}
