import { rawAttachmentMetadata, checkRawImageHeader, checkRawPdfHeader, recheckUploadSession } from "./raw-attachment.js";
import { attachmentUsage, enforceAttachmentQuota } from "./attachment-quota.js";
import type { Express, Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { account } from "./inspection-model.js";
import { getEducationForAttachment, fixedEducationAttachments, printEducationAttachments } from "./education-attachment-model.js";
import { fullEducationRecord } from "./education-record.js";
import type { EducationRow } from "./education.js";
import { HttpError, type SiteOperations } from "./site-operations.js";

import { educationAttachments } from "./education-attachment-model.js";

import { sendAttachment, type boundedUploadReader } from "./bounded-upload.js";
const versionSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
const stateInput = z
  .object({
    version: versionSchema,
    attached: z.boolean(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export function isEducationUpload(method: string, path: string) {
  return (
    method === "POST" &&
    /^\/api\/sites\/[^/]+\/education\/[^/]+\/attachments\/?$/i.test(path)
  );
}
export function registerEducationAttachments(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
  read: ReturnType<typeof boundedUploadReader>,
) {
  const base = "/api/sites/:siteId/education/:id/attachments";
  function report(req: Request, write = false) {
    access(req, write);
    const row=getEducationForAttachment(db,String(req.params.siteId),String(req.params.id));
    if(write && row.author_id!==req.session.userId)throw new HttpError(403,"현재 작성 계정만 초안 첨부를 변경할 수 있습니다.");
    if(write && row.status!=="draft")throw new HttpError(409,"제출/보관 후 첨부 목록은 변경할 수 없습니다.");
    return row;
  }
  function expected(row: EducationRow, version: number) {
    if (row.version !== version)
      throw new HttpError(
        409,
        "교육일지 버전이 바뀌었습니다. 최신 기록을 불러오세요.",
      );
  }
  function bump(req:Request,row:EducationRow,event:string,note:string,attachmentId:string){
    const now=new Date().toISOString(),actor=account(db,req.session.userId!);
    const changed=db.prepare("UPDATE education_sessions SET version=version+1,updated_at=? WHERE id=? AND version=?").run(now,row.id,row.version);
    if(!changed.changes)throw new HttpError(409,"교육일지 버전 충돌입니다.");
    const attachments=educationAttachments(db,row.id);
    db.prepare("INSERT INTO education_attachment_events(session_id,version,event,attachment_id,actor_id,actor_name,at,reason,data) VALUES(?,?,?,?,?,?,?,?,?)").run(row.id,row.version+1,event,attachmentId,actor.id,actor.name,now,note,JSON.stringify(attachments));
    audit(db,actor.id,row.site_id,"education."+event,row.id);
    return {record:fullEducationRecord(db,getEducationForAttachment(db,row.site_id,row.id)),attachments};
  }
  function attachment(req: Request) {
    const row = db
      .prepare(
        "SELECT id,filename,format,size,sha256,attached,uploaded_by,uploaded_at FROM education_attachments WHERE id=? AND session_id=? AND site_id=?",
      )
      .get(
        String(req.params.attachmentId),
        String(req.params.id),
        String(req.params.siteId),
      );
    if (!row) throw new HttpError(404, "첨부를 찾을 수 없습니다.");
    return row;
  }
  app.get(base, (req, res) => {
    const row = report(req);
    res.json(educationAttachments(db, row.id));
  });
  app.get(base+"/fixed",(req,res)=>{report(req);res.json(fixedEducationAttachments(db,String(req.params.siteId),String(req.params.id)));});
  app.get(base+"/fixed/print",(req,res)=>{report(req);res.type("html").send(printEducationAttachments(fixedEducationAttachments(db,String(req.params.siteId),String(req.params.id))));});
  app.get(base+"/events",(req,res)=>{
    const row=report(req),offset=z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.offset);
    const items=db.prepare("SELECT * FROM education_attachment_events WHERE session_id=? ORDER BY version DESC LIMIT 51 OFFSET ?").all(row.id,offset) as {data:string}[];
    res.json({items:items.slice(0,50).map(r=>({...r,data:JSON.parse(r.data)})),hasMore:items.length>50});
  });
  app.get(base + "/:attachmentId/download", (req, res) => {
    report(req);
    const meta = attachment(req);
    const row = db
      .prepare("SELECT bytes FROM education_attachments WHERE id=?")
      .get(String(meta.id)) as { bytes: Uint8Array };
    sendAttachment(res, meta, row.bytes);
  });
  app.post(base, async (req, res, next) => {
    try {
      report(req, true);
      const {version,format,filename}=rawAttachmentMetadata(req,"x-education-version",true);
      const bytes = await read(req);
      if (format === "application/pdf") checkRawPdfHeader(bytes);
      else checkRawImageHeader(bytes,format);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      // Recheck the persisted session too: logout/expiry may occur while a body is arriving.
      recheckUploadSession(db,req);
      // Recheck current authorization and draft state BEFORE receipt replay, after asynchronous input.
      report(req, true);
      mutate(
        req,
        res,
        `site:${req.params.siteId}:education:${req.params.id}:attachment:upload`,
        { version, filename, format, size: bytes.length, sha256 },
        () => {
          const row = report(req, true);
          expected(row, version);
          enforceAttachmentQuota(
            attachmentUsage(db, row.site_id, row.id, "education"),
            bytes.length,
          );
          const id = randomUUID();
          db.prepare(
            "INSERT INTO education_attachments(id,site_id,session_id,filename,format,size,sha256,bytes,attached,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)",
          ).run(
            id,
            row.site_id,
            row.id,
            filename,
            format,
            bytes.length,
            sha256,
            bytes,
            req.session.userId!,
            new Date().toISOString(),
          );
          return bump(req, row, "attachment_added", "미검사 원본 저장", id);
        },
        () => {
          report(req, true);
        },
      );
    } catch (error) {
      // Do not drain an unbounded rejected stream. HTTP closes this connection after the response.
      req.pause();
      res.set("Connection", "close");
      next(error);
    }
  });
  app.post(base + "/:attachmentId/state", (req, res) => {
    report(req, true);
    attachment(req);
    const input = stateInput.parse(req.body);
    mutate(
      req,
      res,
      `site:${req.params.siteId}:education:${req.params.id}:attachment:${req.params.attachmentId}:state`,
      input,
      () => {
        const row = report(req, true);
        expected(row, input.version);
        const old = attachment(req);
        if (Number(old.attached) === Number(input.attached))
          throw new HttpError(409, "이미 요청한 첨부 상태입니다.");
        db.prepare("UPDATE education_attachments SET attached=? WHERE id=?").run(
          Number(input.attached),
          String(old.id),
        );
        return bump(
          req,
          row,
          input.attached ? "attachment_reattached" : "attachment_detached",
          input.reason,
          String(old.id),
        );
      },
      () => {
        report(req, true);
        attachment(req);
      },
    );
  });
}
