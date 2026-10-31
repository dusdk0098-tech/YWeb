import type { MinutesSnapshot } from "../server/minutes-model";
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "x-csrf-token": csrf } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok)
    throw new Error(errorText(data));
  return data as T;
}
// Append the server's Korean field reasons (custom zod messages); zod's English defaults stay hidden.
export function errorText(data: { error?: string; fields?: { message: string }[] }) {
  const reasons = [...new Set((data.fields ?? []).map((f) => f.message).filter((m) => /[가-힣]/.test(m)))];
  return (data.error || "요청을 처리하지 못했습니다.") + (reasons.length ? " " + reasons.join(" / ") : "");
}
export type User = { id: string; name: string; email: string };
export type Site = {
  id: string;
  name: string;
  role: "manager" | "editor" | "viewer";
  version: number;
};
export type Meeting = {
  status?: "draft" | "finalized";
  parentId?: string | null;
  successorId?: string | null;
  revisionReason?: string;
  snapshot?: {body:MinutesSnapshot;hash:string} | null;
  id: string;
  version: number;
  title: string;
  type: "안전보건협의체" | "기타";
  date: string;
  time: string;
  location: string;
  attendees: string;
  agenda: string;
  discussion: string;
  decisions: string;
  actions: {
    task: string;
    owner: string;
    due: string;
    status: "대기" | "진행" | "완료";
  }[];
};

// Dedicated raw upload; original bytes are not previewed or opened by the app.
async function uploadRawImageAttachment<T>(
  path: string,
  file: File,
  version: number,
  key: string,
  versionHeader: "x-hazard-version"|"x-minutes-version"|"x-work-plan-version"|"x-cost-period-version"|"x-education-version",
  allowPdfOriginal = false,
  evidenceVersion?: number,
): Promise<T> {
  const format = allowPdfOriginal && /\.pdf$/i.test(file.name) ? "application/pdf" : /\.png$/i.test(file.name) ? "image/png" : "image/jpeg";
  const response = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/octet-stream",
      "x-csrf-token": csrf,
      "idempotency-key": key,
      "x-file-name": encodeURIComponent(file.name),
      "x-file-type": format,
      [versionHeader]: String(version),
      ...(evidenceVersion === undefined ? {} : { "x-cost-evidence-version": String(evidenceVersion) }),
    },
    body: file,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "첨부 저장 실패");
  return data as T;
}

export function uploadHazardAttachment<T>(path:string,file:File,version:number,key:string){return uploadRawImageAttachment<T>(path,file,version,key,"x-hazard-version");}
export function uploadMinutesAttachment<T>(path:string,file:File,version:number,key:string){return uploadRawImageAttachment<T>(path,file,version,key,"x-minutes-version",true);}

export function uploadWorkPlanAttachment<T>(path:string,file:File,version:number,key:string){return uploadRawImageAttachment<T>(path,file,version,key,"x-work-plan-version",true);}

export function uploadCostEvidence<T>(path:string,file:File,periodVersion:number,evidenceVersion:number,key:string){return uploadRawImageAttachment<T>(path,file,periodVersion,key,"x-cost-period-version",true,evidenceVersion);}

export function uploadCostPhotoDisplay<T>(path:string,display:Blob,periodVersion:number,key:string){return uploadRawImageAttachment<T>(path,new File([display],"display.jpg",{type:"image/jpeg"}),periodVersion,key,"x-cost-period-version");}
export function uploadEducationAttachment<T>(path:string,file:File,version:number,key:string){return uploadRawImageAttachment<T>(path,file,version,key,"x-education-version",true);}
