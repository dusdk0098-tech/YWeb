import { minutesAttachmentManifest, type MinutesAttachment } from "./minutes-attachment-model.js";
import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { meetingInput,type MeetingInput } from "./validation.js";
export type MinutesRow={id:string;site_id:string;body:string;version:number;author_id:string;created_at:string;updated_at:string;status:"draft"|"finalized";parent_id:string|null;revision_reason:string};
type MinutesSnapshotCore={id:string;site:{id:string;name:string};author:{id:string;name:string};version:number;body:MeetingInput;parentId:string|null;revisionReason:string;finalizedBy:{id:string;name:string};finalizedAt:string};
export type MinutesSnapshot=({schemaVersion:1}&MinutesSnapshotCore)|({schemaVersion:2;attachments:MinutesAttachment[]}&MinutesSnapshotCore);
export const minutesHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function minutesRow(db:Db,site:string,id:string){const row=db.prepare("SELECT m.*,COALESCE(r.status,'draft') status,r.parent_id,COALESCE(r.revision_reason,'') revision_reason FROM minutes m LEFT JOIN minutes_records r ON r.minutes_id=m.id WHERE m.site_id=? AND m.id=?").get(site,id) as MinutesRow|undefined;if(!row)throw new HttpError(404,"회의록을 찾을 수 없습니다.");return row;}
export function fixedMinutes(db:Db,row:MinutesRow){
 const stored=db.prepare("SELECT body,hash FROM minutes_snapshots WHERE minutes_id=?").get(row.id) as {body:string;hash:string}|undefined;
 if(row.status!=="finalized"||!stored)throw new HttpError(409,"확정 회의록이 필요합니다.");
 const body=JSON.parse(stored.body) as MinutesSnapshot;
 if(minutesHash(body)!==stored.hash||body.id!==row.id||body.site.id!==row.site_id||body.version!==row.version||body.author.id!==row.author_id||body.parentId!==row.parent_id||body.revisionReason!==row.revision_reason||JSON.stringify(body.body)!==JSON.stringify(meetingInput.parse(JSON.parse(row.body))))throw new HttpError(409,"회의록 보관본이 일치하지 않습니다.");
 if(body.schemaVersion!==1&&body.schemaVersion!==2)throw new HttpError(409,"지원하지 않는 회의록 보관본 형식입니다.");
 if(body.schemaVersion===2&&JSON.stringify(body.attachments)!==JSON.stringify(minutesAttachmentManifest(db,row.id)))throw new HttpError(409,"회의록 고정 첨부 목록이 일치하지 않습니다.");
 return {body,hash:stored.hash};
}
export function minutesRecord(db:Db,row:MinutesRow){return {id:row.id,siteId:row.site_id,...meetingInput.parse(JSON.parse(row.body)),version:row.version,authorId:row.author_id,createdAt:row.created_at,updatedAt:row.updated_at,status:row.status,parentId:row.parent_id,revisionReason:row.revision_reason,successorId:(db.prepare("SELECT minutes_id id FROM minutes_records WHERE parent_id=?").get(row.id) as {id:string}|undefined)?.id??null,snapshot:row.status==="finalized"?fixedMinutes(db,row):null};}
export function validateMinutesFinal(body:MeetingInput){
 // Temporary record-completeness policy, not a statutory template. Explicit
 // human statements such as '없음' are allowed; the server invents no facts.
 for(const key of ["attendees","agenda","discussion","decisions"] as const)
  if(!body[key].trim())throw new HttpError(400,"확정 전 참석자·안건·논의·결정 내용을 작성하세요. 해당 없음도 사람이 명시합니다.");
}
export function correctedMinutesBody(body:MeetingInput):MeetingInput{return {...structuredClone(body),actions:body.actions.map(a=>({...a,status:"대기" as const}))};}
export type MinutesFollowupSource={minutesId:string;siteId:string;snapshotHash:string;snapshotVersion:number;title:string;decisions:string;actionIndex:number;action:MeetingInput["actions"][number];createdBy:{id:string;name:string};createdAt:string};
export type MinutesFollowupRow={id:string;site_id:string;minutes_id:string;action_index:number;source:string;source_hash:string;status:"assigned"|"reported"|"verified";assignee_id:string;due:string;version:number;report:string|null;verification:string|null;created_at:string;updated_at:string};
export type MinutesFollowupReport={text:string;claimedLocalDate:string;actor:{id:string;name:string};at:string};
export function minutesFollowupRow(db:Db,site:string,id:string){const row=db.prepare("SELECT * FROM minutes_followups WHERE site_id=? AND id=?").get(site,id) as MinutesFollowupRow|undefined;if(!row)throw new HttpError(404,"이 현장의 회의 후속기록을 찾을 수 없습니다.");return row;}
export function minutesFollowupRecord(db:Db,row:MinutesFollowupRow){const source=JSON.parse(row.source) as MinutesFollowupSource,original=minutesRow(db,row.site_id,row.minutes_id),fixed=fixedMinutes(db,original);
 if(minutesHash(source)!==row.source_hash||source.siteId!==row.site_id||source.minutesId!==row.minutes_id||source.actionIndex!==row.action_index||source.snapshotHash!==fixed.hash||source.snapshotVersion!==fixed.body.version||JSON.stringify(source.action)!==JSON.stringify(fixed.body.body.actions[row.action_index])||source.decisions!==fixed.body.body.decisions)throw new HttpError(409,"후속기록의 고정 출처가 일치하지 않습니다.");
 return {...row,source,reportHash:row.report?minutesHash(JSON.parse(row.report)):null,report:row.report?JSON.parse(row.report) as MinutesFollowupReport:null,verification:row.verification?JSON.parse(row.verification) as {note:string;actor:{id:string;name:string};at:string;reportHash:string}:null,sourceHasSuccessor:!!db.prepare("SELECT 1 FROM minutes_records WHERE parent_id=?").get(row.minutes_id)};
}
