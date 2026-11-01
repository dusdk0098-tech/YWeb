import type { Db } from "./db.js";
// 관리자 1명 현장 (docs/UI_REDESIGN_PLAN.md 결정 11): when this account is the site's only manager, the step that
// normally needs "another manager" (inspection review, hazard close, work-stop resumption, follow-up verification,
// risk document review) is done by the same account — as part of the submit where possible — and the record carries
// this note with the actor and time. A second manager membership restores the two-person rule by itself.
// This is an app policy, not an electronic signature or a legal approval; the existing wording stays.
export const SOLE_MANAGER_NOTE = "본인 처리 · 관리자 1명 현장";
export function soleManager(db: Db, site: string, user: string) {
  const managers = db
    .prepare("SELECT user_id FROM memberships WHERE site_id=? AND role='manager'")
    .all(site) as { user_id: string }[];
  return managers.length === 1 && managers[0].user_id === user;
}
