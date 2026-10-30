import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { hazardInput } from "./hazard-validation.js";
import { date } from "./validation.js";
export const hazardInboxQuery = z.object({ kind: z.enum(["mine", "reviews"]).default("mine"), offset: z.coerce.number().int().min(0).max(1000000).default(0) }).strict();
export type HazardInboxKind = z.infer<typeof hazardInboxQuery>["kind"];
export type HazardInboxItem = { id: string; title: string; location: string; observedDate: string; version: number; status: "assigned" | "review_requested"; dueDate: string;
  canReport: boolean; canClose: boolean; canReturn: boolean; stateLabel: string };
export type HazardInbox = { siteId: string; kind: HazardInboxKind; offset: number; total: number; hasMore: boolean; retrievedAt: string; items: HazardInboxItem[] };
export function serializeHazardInbox(value: HazardInbox) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 256 * 1024) throw new HttpError(409, "개인 업무함 응답 한도 초과로 전체 조회를 중단합니다. 기존 신고 목록에서 개별 기록을 확인하세요.");
  return json;
}
export function readHazardInbox(db: Db, site: string, user: string, role: string, query: z.infer<typeof hazardInboxQuery>): HazardInbox {
  if (query.kind === "reviews" && role !== "manager") throw new HttpError(403, "관리자 독립 검토 대기 목록입니다.");
  const where = query.kind === "mine" ? "h.site_id=? AND h.assignee_id=? AND h.status IN ('assigned','review_requested')" : "h.site_id=? AND h.status='review_requested' AND (h.remediator_id<>? OR h.remediator_id IS NULL)";
  const total = Number((db.prepare(`SELECT COUNT(*) n FROM hazard_reports h WHERE ${where}`).get(site,user) as {n:number}).n);
  const rows = db.prepare(`SELECT h.id,h.body,h.version,h.status,h.due_date,h.assignee_id,h.remediator_id,
    EXISTS(SELECT 1 FROM memberships m WHERE m.site_id=h.site_id AND m.user_id=h.assignee_id AND m.role IN ('manager','editor')) AS assignee_eligible
    FROM hazard_reports h WHERE ${where} ORDER BY h.updated_at DESC,h.id DESC LIMIT 51 OFFSET ?`).all(site,user,query.offset) as {
      id:string;body:string;version:number;status:"assigned"|"review_requested";due_date:string;assignee_id:string|null;remediator_id:string|null;assignee_eligible:number }[];
  const items = rows.slice(0,50).map(r => {
    // Parse only this page, not all descriptions or immutable attachment snapshots.
    if (Buffer.byteLength(r.body) > 64*1024 || !Number.isSafeInteger(r.version) || r.version < 1 || !r.assignee_id || !date.safeParse(r.due_date).success || (r.status === "review_requested" && !r.remediator_id)) throw new HttpError(409,"업무함 기록의 현재 출처가 불완전하여 전체 페이지를 표시하지 않습니다.");
    let body:z.infer<typeof hazardInput>;
    try { body=hazardInput.parse(JSON.parse(r.body)); } catch { throw new HttpError(409,"신고 본문을 읽을 수 없어 전체 페이지 조회를 중단합니다."); }
    const canReport=r.status==='assigned' && r.assignee_id===user && role!=='viewer';
    const canClose=r.status==='review_requested' && role==='manager' && r.remediator_id!==user;
    return {id:r.id,title:body.title,location:body.location,observedDate:body.observedDate,version:r.version,status:r.status,dueDate:r.due_date,
      canReport,canClose,canReturn:r.status==='review_requested'&&role==='manager'&&Boolean(r.assignee_eligible),
      stateLabel:r.status==='assigned'?(canReport?'내 조치 제출 대기':'현재 역할로 조치 제출 불가'):(canClose?'관리자 독립 검토 대기':'다른 관리자 검토 대기')};
  });
  return {siteId:site,kind:query.kind,offset:query.offset,total,hasMore:rows.length>50,retrievedAt:new Date().toISOString(),items};
}
export function registerHazardInbox(app:Express,db:Db,{access}:SiteOperations){
  app.get('/api/sites/:siteId/hazard-inbox',(req,res)=>{
    const query=hazardInboxQuery.parse(req.query);db.exec('BEGIN DEFERRED');
    try { const role=access(req);const result=readHazardInbox(db,String(req.params.siteId),req.session.userId!,role,query);const json=serializeHazardInbox(result);db.exec('COMMIT');res.set('Cache-Control','no-store').type('json').send(json); }
    catch(e){db.exec('ROLLBACK');throw e;}
  });
}
