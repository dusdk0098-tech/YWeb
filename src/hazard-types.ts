export type HazardStatus =
  "draft" | "reported" | "assigned" | "review_requested" | "closed";
export type HazardDetails = {
  title: string;
  observedDate: string;
  location: string;
  description: string;
};
export type HazardRecord = {
  id: string;
  site_id: string;
  owner_id: string;
  body: HazardDetails;
  status: HazardStatus;
  version: number;
  assignee_id: string | null;
  due_date: string | null;
  remediation: string;
  remediator_id: string | null;
  submitted_snapshot: {
    site: { id: string; name: string };
    reporter: { id: string; name: string };
    details: HazardDetails;
    submittedAt: string;
  } | null;
  created_at: string;
  updated_at: string;
};
export type HazardEvent = {
  id: number;
  version: number;
  event: string;
  from_status: HazardStatus | null;
  to_status: HazardStatus;
  note: string;
  actor_id: string;
  actor_name: string;
  at: string;
  snapshot: HazardRecord;
};
export const statusLabel: Record<HazardStatus, string> = {
  draft: "초안",
  reported: "신고 제출",
  assigned: "담당자 배정",
  review_requested: "검토 요청",
  closed: "기록상 종결",
};
