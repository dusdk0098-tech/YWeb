import type { Express,Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit,type Db } from "./db.js";
import { HttpError,type SiteOperations } from "./site-operations.js";
import { date,revision } from "./validation.js";
import { companyPage } from "./companies.js";
import { account } from "./inspection-model.js";
import { minutesRow,fixedMinutes,minutesHash,minutesFollowupRow,minutesFollowupRecord,type MinutesFollowupRow,type MinutesFollowupSource,type MinutesFollowupReport } from "./minutes-model.js";
const reason=z.string().trim().min(1).max(1000),prose=z.string().trim().min(1).max(10000);
export function registerMinutesFollowups(app:Express,db:Db,{access,mutate}:SiteOperations){
 const base="/api/sites/:siteId/minutes-followups";
 const get=(req:Request)=>minutesFollowupRow(db,String(req.params.siteId),String(req.params.id));
 function eligible(site:string,id:string){if(!db.prepare("SELECT 1 FROM memberships WHERE site_id=? AND user_id=? AND role IN('manager','editor')").get(site,id))throw new HttpError(400,"현재 현장의 manager/editor 계정을 배정하세요.");}
 function manager(req:Request){access(req,true,true);get(req);}
 function assigned(req:Request){access(req,true);if(get(req).assignee_id!==req.session.userId)throw new HttpError(403,"현재 배정 계정만 보고할 수 있습니다.");}
 function verifier(req:Request){manager(req);const old=get(req),report=old.report?JSON.parse(old.report) as MinutesFollowupReport:null;if(old.assignee_id===req.session.userId||report?.actor.id===req.session.userId)throw new HttpError(403,"보고/배정 계정과 다른 관리자가 확인해야 합니다.");}
 function event(req:Request,row:MinutesFollowupRow,kind:string,why:string){const actor=account(db,req.session.userId!);db.prepare("INSERT INTO minutes_followup_events(followup_id,version,event,reason,actor_id,actor_name,at,body) VALUES(?,?,?,?,?,?,?,?)").run(row.id,row.version,kind,why,actor.id,actor.name,new Date().toISOString(),JSON.stringify(minutesFollowupRecord(db,row)));audit(db,actor.id,row.site_id,"minutes.followup."+kind,row.id);}
 app.get(base+"/assignees",(req,res)=>{access(req,true,true);const q=companyPage.parse(req.query);const rows=db.prepare("SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? AND m.role IN('manager','editor') ORDER BY u.name,u.id LIMIT 51 OFFSET ?").all(String(req.params.siteId),q.offset);res.json({items:rows.slice(0,50),hasMore:rows.length>50});});
 app.get(base,(req,res)=>{access(req);const q=companyPage.extend({minutesId:z.uuid().optional()}).parse(req.query);const rows=db.prepare("SELECT * FROM minutes_followups WHERE site_id=? AND (? IS NULL OR minutes_id=?) ORDER BY due,id LIMIT 51 OFFSET ?").all(String(req.params.siteId),q.minutesId??null,q.minutesId??null,q.offset) as MinutesFollowupRow[];res.json({items:rows.slice(0,50).map(r=>minutesFollowupRecord(db,r)),hasMore:rows.length>50});});
 app.get(base+"/:id",(req,res)=>{access(req);res.json(minutesFollowupRecord(db,get(req)));});
 app.get(base+"/:id/events",(req,res)=>{access(req);const row=get(req),q=companyPage.parse(req.query),rows=db.prepare("SELECT *,body AS snapshot FROM minutes_followup_events WHERE followup_id=? ORDER BY version LIMIT 51 OFFSET ?").all(row.id,q.offset);res.json({items:rows.slice(0,50),hasMore:rows.length>50});});
 app.post("/api/sites/:siteId/minutes/:id/followups",(req,res)=>{
  access(req,true,true);const v=z.object({version:revision,snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),actionIndex:z.number().int().min(0).max(49),assigneeId:z.uuid(),due:date,reason,confirmManualTracking:z.literal(true)}).strict().parse(req.body),site=String(req.params.siteId),id=String(req.params.id);
  mutate(req,res,`site:${site}:minutes:${id}:followup:create`,v,()=>{
   const old=minutesRow(db,site,id),fixed=fixedMinutes(db,old);if(old.version!==v.version||fixed.hash!==v.snapshotHash||db.prepare("SELECT 1 FROM minutes_records WHERE parent_id=?").get(id))throw new HttpError(409,"후속 정정본 없는 정확한 확정 회의록을 선택하세요.");
   const action=fixed.body.body.actions[v.actionIndex];if(!action)throw new HttpError(400,"보관본의 후속 항목을 선택하세요.");eligible(site,v.assigneeId);
   if(db.prepare("SELECT 1 FROM minutes_followups WHERE minutes_id=? AND action_index=?").get(id,v.actionIndex))throw new HttpError(409,"이 항목의 후속기록이 이미 있습니다.");
   const next=randomUUID(),now=new Date().toISOString(),source:MinutesFollowupSource={minutesId:id,siteId:site,snapshotHash:fixed.hash,snapshotVersion:fixed.body.version,title:fixed.body.body.title,decisions:fixed.body.body.decisions,actionIndex:v.actionIndex,action,createdBy:account(db,req.session.userId!),createdAt:now};
   db.prepare("INSERT INTO minutes_followups VALUES(?,?,?,?,?,?,'assigned',?,?,1,NULL,NULL,?,?)").run(next,site,id,v.actionIndex,JSON.stringify(source),minutesHash(source),v.assigneeId,v.due,now,now);
   const row=minutesFollowupRow(db,site,next);event(req,row,"assigned",v.reason);return minutesFollowupRecord(db,row);
  },()=>{access(req,true,true);minutesRow(db,site,id);});
 });
 app.post(base+"/:id/assign",(req,res)=>{
  manager(req);const v=z.object({version:revision,assigneeId:z.uuid(),due:date,reason}).strict().parse(req.body);
  mutate(req,res,`site:${req.params.siteId}:minutes-followup:${req.params.id}:assign`,v,()=>{
   const old=get(req);if(old.version!==v.version||old.status==="verified")throw new HttpError(409,"확인기록은 먼저 재개방하거나 최신 버전을 조회하세요.");eligible(old.site_id,v.assigneeId);
   db.prepare("UPDATE minutes_followups SET status='assigned',assignee_id=?,due=?,report=NULL,verification=NULL,version=version+1,updated_at=? WHERE id=?").run(v.assigneeId,v.due,new Date().toISOString(),old.id);const row=get(req);event(req,row,"reassigned",v.reason);return minutesFollowupRecord(db,row);
  },()=>manager(req));
 });
 app.post(base+"/:id/report",(req,res)=>{
  assigned(req);const v=z.object({version:revision,text:prose,claimedLocalDate:date,reason,confirmHumanReport:z.literal(true)}).strict().parse(req.body);
  mutate(req,res,`site:${req.params.siteId}:minutes-followup:${req.params.id}:report`,v,()=>{
   const old=get(req);if(old.version!==v.version||old.status==="verified")throw new HttpError(409,"확인기록은 먼저 재개방하거나 최신 버전을 조회하세요.");const now=new Date().toISOString(),report:MinutesFollowupReport={text:v.text,claimedLocalDate:v.claimedLocalDate,actor:account(db,req.session.userId!),at:now};
   db.prepare("UPDATE minutes_followups SET status='reported',report=?,verification=NULL,version=version+1,updated_at=? WHERE id=?").run(JSON.stringify(report),now,old.id);const row=get(req);event(req,row,old.status==="reported"?"report_corrected":"reported",v.reason);return minutesFollowupRecord(db,row);
  },()=>assigned(req));
 });
 app.post(base+"/:id/verify",(req,res)=>{
  verifier(req);const v=z.object({version:revision,note:prose,reportHash:z.string().regex(/^[a-f0-9]{64}$/),reason,confirmHumanRecord:z.literal(true)}).strict().parse(req.body);
  mutate(req,res,`site:${req.params.siteId}:minutes-followup:${req.params.id}:verify`,v,()=>{
   const old=get(req);if(old.version!==v.version||old.status!=="reported"||!old.report||minutesHash(JSON.parse(old.report))!==v.reportHash)throw new HttpError(409,"현재 보고내용과 버전을 확인하세요.");const now=new Date().toISOString(),verification={note:v.note,actor:account(db,req.session.userId!),at:now,reportHash:v.reportHash};
   db.prepare("UPDATE minutes_followups SET status='verified',verification=?,version=version+1,updated_at=? WHERE id=?").run(JSON.stringify(verification),now,old.id);const row=get(req);event(req,row,"verified",v.reason);return minutesFollowupRecord(db,row);
  },()=>verifier(req));
 });
 app.post(base+"/:id/reopen",(req,res)=>{
  manager(req);const v=z.object({version:revision,reason}).strict().parse(req.body);
  mutate(req,res,`site:${req.params.siteId}:minutes-followup:${req.params.id}:reopen`,v,()=>{
   const old=get(req);if(old.version!==v.version||old.status!=="verified")throw new HttpError(409,"현재 확인기록에서 재개방하세요.");
   db.prepare("UPDATE minutes_followups SET status='assigned',report=NULL,verification=NULL,version=version+1,updated_at=? WHERE id=?").run(new Date().toISOString(),old.id);const row=get(req);event(req,row,"reopened",v.reason);return minutesFollowupRecord(db,row);
  },()=>manager(req));
 });
}
