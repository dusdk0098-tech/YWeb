import { rawAttachmentMetadata, checkRawImageHeader, recheckUploadSession } from "./raw-attachment.js";
import { attachmentUsage, enforceAttachmentQuota } from "./attachment-quota.js";
import type { Express, Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { hazardRecord, type HazardRow } from "./hazard-model.js";
import { hazardAttachments } from "./hazard-attachment-model.js";
import { recordHazardEvent } from "./hazard-write.js";
import type { boundedUploadReader } from "./bounded-upload.js";
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
export function isHazardUpload(method: string, path: string) {
  return (
    method === "POST" &&
    /^\/api\/sites\/[^/]+\/hazards\/[^/]+\/attachments\/?$/i.test(path)
  );
}
export function registerHazardAttachments(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
  read: ReturnType<typeof boundedUploadReader>,
) {
  const base = "/api/sites/:siteId/hazards/:id/attachments";
  function report(req: Request, write = false) {
    access(req, write);
    const row = db
      .prepare("SELECT * FROM hazard_reports WHERE site_id=? AND id=?")
      .get(String(req.params.siteId), String(req.params.id)) as
      HazardRow | undefined;
    if (!row) throw new HttpError(404, "신고 기록을 찾을 수 없습니다.");
    if (write && row.owner_id !== req.session.userId)
      throw new HttpError(403, "초안 작성자만 첨부를 변경할 수 있습니다.");
    if (write && row.status !== "draft")
      throw new HttpError(409, "제출 후 첨부 목록은 변경할 수 없습니다.");
    return row;
  }
  function expected(row: HazardRow, version: number) {
    if (row.version !== version)
      throw new HttpError(
        409,
        "신고 버전이 바뀌었습니다. 최신 기록을 불러오세요.",
      );
  }
  function bump(req: Request, row: HazardRow, event: string, note: string) {
    const next = {
      ...row,
      version: row.version + 1,
      updated_at: new Date().toISOString(),
    };
    db.prepare(
      "UPDATE hazard_reports SET version=?,updated_at=? WHERE id=? AND version=?",
    ).run(next.version, next.updated_at, row.id, row.version);
    recordHazardEvent(db, req.session.userId!, next, event, row.status, note);
    return {
      record: hazardRecord(next),
      attachments: hazardAttachments(db, row.id),
    };
  }
  function attachment(req: Request) {
    const row = db
      .prepare(
        "SELECT id,filename,format,size,sha256,attached,uploaded_by,uploaded_at FROM hazard_attachments WHERE id=? AND report_id=? AND site_id=?",
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
    res.json(hazardAttachments(db, row.id));
  });
  app.get(base + "/:attachmentId/download", (req, res) => {
    report(req);
    const meta = attachment(req);
    // Original is unscanned. Never serve it as an image or inline content.
    const row = db
      .prepare("SELECT bytes FROM hazard_attachments WHERE id=?")
      .get(String(meta.id)) as { bytes: Uint8Array };
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="attachment-${meta.id}.bin"; filename*=UTF-8''${encodeURIComponent(String(meta.filename)).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "X-Attachment-Scan": "UNSCANNED",
    });
    res.send(Buffer.from(row.bytes));
  });
  app.post(base, async (req, res, next) => {
    try {
      report(req, true);
      const {version,format,filename}=rawAttachmentMetadata(req,"x-hazard-version");
      const bytes = await read(req);
      checkRawImageHeader(bytes,format);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      // Recheck the persisted session too: logout/expiry may occur while a body is arriving.
      recheckUploadSession(db,req);
      // Recheck current authorization and draft state BEFORE receipt replay, after asynchronous input.
      report(req, true);
      mutate(
        req,
        res,
        `site:${req.params.siteId}:hazard:${req.params.id}:attachment:upload`,
        { version, filename, format, size: bytes.length, sha256 },
        () => {
          const row = report(req, true);
          expected(row, version);
          enforceAttachmentQuota(
            attachmentUsage(db, row.site_id, row.id),
            bytes.length,
          );
          const id = randomUUID();
          db.prepare(
            "INSERT INTO hazard_attachments(id,site_id,report_id,filename,format,size,sha256,bytes,attached,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)",
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
          return bump(req, row, "attachment_added", `미검사 원본 첨부 ${id}`);
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
      `site:${req.params.siteId}:hazard:${req.params.id}:attachment:${req.params.attachmentId}:state`,
      input,
      () => {
        const row = report(req, true);
        expected(row, input.version);
        const old = attachment(req);
        if (Number(old.attached) === Number(input.attached))
          throw new HttpError(409, "이미 요청한 첨부 상태입니다.");
        db.prepare("UPDATE hazard_attachments SET attached=? WHERE id=?").run(
          Number(input.attached),
          String(old.id),
        );
        return bump(
          req,
          row,
          input.attached ? "attachment_reattached" : "attachment_detached",
          `${old.id} · ${input.reason}`,
        );
      },
      () => {
        report(req, true);
        attachment(req);
      },
    );
  });
}
