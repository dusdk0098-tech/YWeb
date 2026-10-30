import type { TbmRiskReference } from "../server/tbm-risk-reference";
import type { TbmSnapshot } from "../server/tbm";
export type TbmDetails = {
  title: string;
  date: string;
  time: string;
  location: string;
  facilitator: string;
  work: string;
  topics: string;
};
export type TbmParticipant = {
  worker_id: string;
  name: string;
  affiliation: string;
  kind: "worker" | "visitor";
  state: "pending" | "present" | "absent";
  recorded_by: string | null;
  recorded_at: string | null;
};
export type TbmSession = {
  id: string;
  site_id: string;
  body: TbmDetails;
  status: "draft" | "finalized";
  version: number;
  parent_id: string | null;
  revision_reason: string;
  author_id: string;
  created_at: string;
  updated_at: string;
};
export type TbmFull = TbmSession & {
  riskReference?: TbmRiskReference | null;
  riskSourceState?: {sourceHasSuccessor:boolean;sourceStatus:string} | null;
  participants: TbmParticipant[];
  successorId: string | null;
  snapshot: {
    body: TbmSnapshot;
    hash: string;
  } | null;
};
