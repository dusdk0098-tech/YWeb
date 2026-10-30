export type Worker = {
  id: string;
  name: string;
  affiliation: string;
  kind: "worker" | "visitor";
  active: number;
  version: number;
};
export type Attendance = {
  id: string;
  worker_id: string;
  date: string;
  name: string;
  affiliation: string;
  kind: "worker" | "visitor";
  status: "present" | "cancelled";
  source: "manual";
  reason: string;
  version: number;
  updated_at: string;
};
export type AttendanceHistory = {
  version: number;
  status: "present" | "cancelled";
  reason: string;
  actor_id: string;
  actor_name: string;
  at: string;
};
export type Page<T> = { items: T[]; hasMore: boolean };
