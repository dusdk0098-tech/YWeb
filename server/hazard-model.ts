import type { HazardAttachment } from "./hazard-attachment-model.js";
import type { HazardInput } from "./hazard-validation.js";
export type HazardStatus =
  "draft" | "reported" | "assigned" | "review_requested" | "closed";
export type HazardRow = {
  id: string;
  site_id: string;
  owner_id: string;
  body: string;
  status: HazardStatus;
  version: number;
  assignee_id: string | null;
  due_date: string | null;
  remediation: string;
  remediator_id: string | null;
  submitted_snapshot: string | null;
  created_at: string;
  updated_at: string;
};
export type HazardOriginal = {
  id: string;
  site: { id: string; name: string };
  reporter: { id: string; name: string };
  details: HazardInput;
  submittedAt: string;
  attachments?: HazardAttachment[];
};
export type HazardEvent = {
  id: number;
  report_id: string;
  version: number;
  event: string;
  from_status: HazardStatus | null;
  to_status: HazardStatus;
  note: string;
  actor_id: string;
  actor_name: string;
  at: string;
  snapshot: string;
};
export const hazardRecord = (r: HazardRow) => ({
  ...r,
  body: JSON.parse(r.body) as HazardInput,
  submitted_snapshot: r.submitted_snapshot
    ? (JSON.parse(r.submitted_snapshot) as HazardOriginal)
    : null,
});
