import { minutesAttachmentManifest } from "./minutes-attachment-model.js";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit,type Db } from "./db.js";
import { HttpError,type SiteOperations } from "./site-operations.js";
import { meetingInput,revision } from "./validation.js";
import { account } from "./inspection-model.js";
import { minutesRow,minutesRecord,fixedMinutes,minutesHash,validateMinutesFinal,correctedMinutesBody,type MinutesSnapshot } from "./minutes-model.js";
export function registerMinutesRecords(app:Express,db:Db,{access,mutate}:SiteOperations){
 const base="/api/sites/:siteId/minutes/:id";
 app.post(base+"/finalize",(req,res)=>{
  access(req,true,true);const v=z.object({version:revision,confirmRecordOnly:z.literal(true)}).strict().parse(req.body),site=String(req.params.siteId),id=String(req.params.id);
  mutate(req,res,`site:${site}:minutes:${id}:finalize`,v,()=>{
   const old=minutesRow(db,site,id);if(old.status!=="draft"||old.version!==v.version)throw new HttpError(409,"최신 회의 초안에서 확정하세요.");
   const body=meetingInput.parse(JSON.parse(old.body));validateMinutesFinal(body);
   const now=new Date().toISOString(),actor=account(db,req.session.userId!),author=account(db,old.author_id),name=(db.prepare("SELECT name FROM sites WHERE id=?").get(site) as {name:string}).name;
   const snapshot:MinutesSnapshot={schemaVersion:2,attachments:minutesAttachmentManifest(db,id),id,site:{id:site,name},author,version:old.version+1,body,parentId:old.parent_id,revisionReason:old.revision_reason,finalizedBy:actor,finalizedAt:now};
   const changed=db.prepare("UPDATE minutes SET version=version+1,updated_at=? WHERE id=? AND version=?").run(now,id,v.version);
   if(!changed.changes)throw new HttpError(409,"회의록 버전 충돌입니다.");
   db.prepare("INSERT INTO minutes_records(minutes_id,status,parent_id,revision_reason) VALUES(?,'finalized',?,?) ON CONFLICT(minutes_id) DO UPDATE SET status='finalized'").run(id,old.parent_id,old.revision_reason);
   db.prepare("INSERT INTO minutes_snapshots VALUES(?,?,?)").run(id,JSON.stringify(snapshot),minutesHash(snapshot));audit(db,actor.id,site,"minutes.finalized",id);return minutesRecord(db,minutesRow(db,site,id));
  },()=>{access(req,true,true);});
 });
 app.post(base+"/revise",(req,res)=>{
  access(req,true,true);const v=z.object({version:revision,reason:z.string().trim().min(1).max(1000)}).strict().parse(req.body),site=String(req.params.siteId),id=String(req.params.id);
  mutate(req,res,`site:${site}:minutes:${id}:revise`,v,()=>{
   const old=minutesRow(db,site,id);if(old.version!==v.version||db.prepare("SELECT 1 FROM minutes_records WHERE parent_id=?").get(id))throw new HttpError(409,"이미 정정본이 있거나 회의록 버전이 바뀌었습니다.");
   const snap=fixedMinutes(db,old),next=randomUUID(),now=new Date().toISOString();
   db.prepare("INSERT INTO minutes(id,site_id,body,version,author_id,created_at,updated_at) VALUES(?,?,?,1,?,?,?)").run(next,site,JSON.stringify(correctedMinutesBody(snap.body.body)),req.session.userId!,now,now);
   db.prepare("INSERT INTO minutes_records VALUES(?,'draft',?,?)").run(next,id,v.reason);
   audit(db,req.session.userId!,site,"minutes.revision.created",next);return minutesRecord(db,minutesRow(db,site,next));
  },()=>{access(req,true,true);});
 });
}
