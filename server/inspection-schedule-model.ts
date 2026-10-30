import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import type { TemplateSnapshot, InspectionRow } from "./inspection-model.js";
export type TaskBody = {
  plannedDate: string;
  location: string;
  instructions: string;
};
export type InspectionTaskRow = {
  id: string;
  site_id: string;
  template_id: string;
  template_snapshot: string;
  body: string;
  assignee_id: string;
  status: "planned" | "started" | "cancelled";
  version: number;
  root_inspection_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export const taskRecord = (r: InspectionTaskRow) => ({
  ...r,
  body: JSON.parse(r.body) as TaskBody,
  template_snapshot: JSON.parse(r.template_snapshot) as TemplateSnapshot,
});
export function getTask(db: Db, site: string, id: string) {
  const r = db
    .prepare("SELECT * FROM inspection_tasks WHERE site_id=? AND id=?")
    .get(site, id) as InspectionTaskRow | undefined;
  if (!r) throw new HttpError(404, "점검 일정을 찾을 수 없습니다.");
  return r;
}
export type TaskSource = {
  task: ReturnType<typeof taskRecord>;
  assignee: { id: string; name: string };
  startedBy: { id: string; name: string };
  startedAt: string;
};
export function inspectionTaskSource(
  db: Db,
  site: string,
  id: string,
): TaskSource | null {
  const row = db
    .prepare(
      "SELECT l.snapshot FROM inspection_task_links l JOIN inspections i ON i.id=l.inspection_id WHERE i.site_id=? AND i.id=?",
    )
    .get(site, id) as { snapshot: string } | undefined;
  return row ? (JSON.parse(row.snapshot) as TaskSource) : null;
}
export function carryTaskSource(db: Db, parent: string, child: string) {
  const link = db
    .prepare(
      "SELECT task_id,snapshot FROM inspection_task_links WHERE inspection_id=?",
    )
    .get(parent) as { task_id: string; snapshot: string } | undefined;
  if (link)
    db.prepare("INSERT INTO inspection_task_links VALUES(?,?,?)").run(
      child,
      link.task_id,
      link.snapshot,
    );
}
export type TaskChainItem = Pick<
  InspectionRow,
  "id" | "status" | "version" | "owner_id" | "parent_id"
>;
export function taskChain(db: Db, row: InspectionTaskRow) {
  const items: TaskChainItem[] = [],
    seen = new Set<string>();
  let id = row.root_inspection_id;
  while (id && items.length < 100) {
    if (seen.has(id))
      throw new HttpError(
        409,
        "점검 연결에 순환이 있습니다. 관리자 검토가 필요합니다.",
      );
    seen.add(id);
    const current = db
      .prepare(
        "SELECT i.id,i.status,i.version,i.owner_id,i.parent_id FROM inspections i JOIN inspection_task_links l ON l.inspection_id=i.id WHERE i.site_id=? AND i.id=? AND l.task_id=?",
      )
      .get(row.site_id, id, row.id) as TaskChainItem | undefined;
    if (!current)
      throw new HttpError(
        409,
        "점검 연결이 일치하지 않습니다. 관리자 검토가 필요합니다.",
      );
    items.push(current);
    const next = db
      .prepare("SELECT id FROM inspections WHERE parent_id=? AND site_id=?")
      .get(id, row.site_id) as { id: string } | undefined;
    id = next?.id || null;
  }
  return { items, hasMore: !!id, latest: id ? null : items.at(-1) || null };
}
