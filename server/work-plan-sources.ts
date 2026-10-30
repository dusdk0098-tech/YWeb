import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { equipmentRecord, getEquipment } from "./equipment-model.js";
import type { WorkerRow } from "./attendance.js";
import type { WorkPlanBody } from "./work-plan-validation.js";
import { journalHash } from "./daily-journal-sources.js";
export function planSourceFacts(db: Db, site: string, body: WorkPlanBody) {
  const equipment = body.equipmentIds.map((id) => {
    const r = getEquipment(db, site, id);
    if (r.status !== "active")
      throw new HttpError(
        409,
        "선택한 장비가 퇴역했습니다. 선택을 검토하세요.",
      );
    return equipmentRecord(r);
  });
  const duties = body.duties.map((d) => {
    const worker = db
      .prepare("SELECT * FROM workers WHERE id=? AND site_id=?")
      .get(d.workerId, site) as WorkerRow | undefined;
    if (!worker)
      throw new HttpError(404, "이 현장의 명부 항목을 찾을 수 없습니다.");
    if (!worker.active)
      throw new HttpError(
        409,
        "선택한 명부가 비활성입니다. 선택을 검토하세요.",
      );
    return {
      worker: {
        id: worker.id,
        version: worker.version,
        name: worker.name,
        affiliation: worker.affiliation,
        kind: worker.kind,
      },
      duty: d.duty,
    };
  });
  return { siteId: site, equipment, duties };
}
export type WorkPlanSource = {
  facts: ReturnType<typeof planSourceFacts>;
  fingerprint: string;
  capturedAt: string;
};
export function capturePlanSources(
  db: Db,
  site: string,
  body: WorkPlanBody,
): WorkPlanSource {
  const facts = planSourceFacts(db, site, body);
  return {
    facts,
    fingerprint: journalHash(facts),
    capturedAt: new Date().toISOString(),
  };
}
