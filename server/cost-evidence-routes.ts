import type { Express, Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { getCostPeriod, getExpense } from "./cost-model.js";
import { expectedCost } from "./cost-write.js";
import { account } from "./inspection-model.js";
import { journalHash } from "./daily-journal-sources.js";
import { rawAttachmentMetadata, checkRawImageHeader, checkRawPdfHeader, recheckUploadSession } from "./raw-attachment.js";
import { attachmentUsage, enforceAttachmentQuota } from "./attachment-quota.js";
import { sendAttachment, type boundedUploadReader } from "./bounded-upload.js";
import { currentCostEvidence, evidenceVersion, fixedCostEvidence, serializeCostEvidence, type EvidenceLink } from "./cost-evidence-model.js";
import { printCostEvidence } from "./cost-evidence-print.js";
const version = z.number().int().positive(), evidenceRevision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
export const evidenceLinkInput = z.object({ periodVersion: version, evidenceVersion: evidenceRevision,
  targets: z.array(z.object({ expenseId: z.uuid(), version }).strict()).max(50), reason: z.string().trim().min(1).max(1000),
  confirmReferencesOnly: z.literal(true) }).strict();
export function isCostEvidenceUpload(method: string, path: string) {
  return method === "POST" && /^\/api\/sites\/[^/]+\/cost-periods\/[^/]+\/evidence\/files\/?$/i.test(path);
}
export function registerCostEvidence(app: Express, db: Db, { access, mutate }: SiteOperations, read: ReturnType<typeof boundedUploadReader>) {
  const base = "/api/sites/:siteId/cost-periods/:id/evidence";
  function period(req: Request, write = false) {
    access(req, true, true);
    const row = getCostPeriod(db, String(req.params.siteId), String(req.params.id));
    if (write && row.status !== "open") throw new HttpError(409, "마감 월의 원본/연결은 변경할 수 없습니다.");
    return row;
  }
  function expected(req: Request, periodVersion: number, expectedEvidenceVersion: number) {
    const row = period(req, true); expectedCost(row, periodVersion);
    if (evidenceVersion(db, row.id) !== expectedEvidenceVersion) throw new HttpError(409, "증빙 버전이 변경되었습니다. 입력을 보관하고 최신 목록을 확인하세요.");
    return row;
  }
  function event(req: Request, attachmentId: string, kind: string, reason: string) {
    const row = period(req, true), next = evidenceVersion(db, row.id) + 1, actor = account(db, req.session.userId!),
      view = currentCostEvidence(db, row.site_id, row.id), item = view.items.find(i => i.file.id === attachmentId)!;
    const data = { schemaVersion: 1, periodId: row.id, version: next, item };
    db.prepare("INSERT INTO cost_evidence_events(period_id,version,event,attachment_id,actor_id,actor_name,at,reason,data,hash) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(row.id, next, kind, attachmentId, actor.id, actor.name, new Date().toISOString(), reason, serializeCostEvidence(data), journalHash(data));
    audit(db, actor.id, row.site_id, "cost.evidence." + kind, attachmentId);
    return { ...view, evidenceVersion: next };
  }
  function readTransaction<T>(action: () => T) {
    db.exec("BEGIN DEFERRED");
    try { const v = action(); db.exec("COMMIT"); return v; } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  app.get(base, (req, res) => {
    const row = period(req); res.json(readTransaction(() => currentCostEvidence(db, row.site_id, row.id)));
  });
  app.get(base + "/events", (req, res) => {
    const row = period(req), q = z.object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) }).strict().parse(req.query);
    const rows = db.prepare("SELECT version,event,attachment_id,actor_id,actor_name,at,reason,data,hash FROM cost_evidence_events WHERE period_id=? ORDER BY version DESC LIMIT 21 OFFSET ?")
      .all(row.id, q.offset) as { data: string; hash: string }[];
    res.json({ items: rows.slice(0, 20).map(r => {
      const data = JSON.parse(r.data); if (journalHash(data) !== r.hash) throw new HttpError(409, "증빙 이력 해시 불일치");
      return { ...r, data };
    }), hasMore: rows.length > 20 });
  });
  app.get(base + "/closures/:closureId", (req, res) => {
    const row = period(req); res.json(readTransaction(() => fixedCostEvidence(db, row.site_id, row.id, String(req.params.closureId))));
  });
  app.get(base + "/closures/:closureId/print", (req, res) => {
    const row = period(req); const fixed = readTransaction(() => fixedCostEvidence(db, row.site_id, row.id, String(req.params.closureId)));
    res.type("html").send(printCostEvidence(fixed));
  });
  app.get(base + "/files/:attachmentId/download", (req, res) => {
    const row = period(req), file = db.prepare("SELECT * FROM cost_evidence_files WHERE id=? AND period_id=? AND site_id=?")
      .get(String(req.params.attachmentId), row.id, row.site_id) as { id: string; filename: string; size: number; sha256: string; bytes: Uint8Array } | undefined;
    if (!file) throw new HttpError(404, "이 월의 보존 원본을 찾을 수 없습니다.");
    sendAttachment(res, file, file.bytes);
  });
  app.post(base + "/files", async (req, res, next) => {
    try {
      period(req, true);
      const { version: periodVersion, format, filename } = rawAttachmentMetadata(req, "x-cost-period-version", true),
        ev = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1).parse(req.get("x-cost-evidence-version"));
      const bytes = await read(req);
      if (format === "application/pdf") checkRawPdfHeader(bytes); else checkRawImageHeader(bytes, format);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      recheckUploadSession(db, req); period(req, true);
      mutate(req, res, `cost:evidence:upload:${req.params.siteId}:${req.params.id}`,
        { periodVersion, evidenceVersion: ev, filename, format, size: bytes.length, sha256 }, () => {
          const row = expected(req, periodVersion, ev);
          enforceAttachmentQuota(attachmentUsage(db, row.site_id, row.id, "cost"), bytes.length);
          const id = randomUUID();
          db.prepare("INSERT INTO cost_evidence_files VALUES(?,?,?,?,?,?,?,?,?,?)")
            .run(id, row.site_id, row.id, filename, format, bytes.length, sha256, bytes, req.session.userId!, new Date().toISOString());
          return event(req, id, "uploaded", "미검사 원본 업로드, 지출 미연결");
        }, () => { period(req, true); });
    } catch (e) { req.pause(); res.set("Connection", "close"); next(e); }
  });
  app.post(base + "/files/:attachmentId/links", (req, res) => {
    period(req, true); const v = evidenceLinkInput.parse(req.body), fileId = String(req.params.attachmentId);
    if (new Set(v.targets.map(t => t.expenseId)).size !== v.targets.length) throw new HttpError(400, "연결 지출을 중복 없이 선택하세요.");
    mutate(req, res, `cost:evidence:links:${req.params.siteId}:${req.params.id}:${fileId}`, v, () => {
      const row = expected(req, v.periodVersion, v.evidenceVersion);
      if (!db.prepare("SELECT 1 FROM cost_evidence_files WHERE id=? AND period_id=? AND site_id=?").get(fileId, row.id, row.site_id))
        throw new HttpError(404, "이 월의 보존 원본을 찾을 수 없습니다.");
      const selected = v.targets.map(t => { const e = getExpense(db, row.id, t.expenseId);
        if (e.version !== t.version) throw new HttpError(409, "선택 지출이 변경되었습니다. 최신행을 다시 확인하세요.");
        return e;
      });
      const existing = db.prepare("SELECT * FROM cost_evidence_links WHERE attachment_id=?").all(fileId) as EvidenceLink[];
      for (const link of existing) if (!selected.some(e => e.id === link.expense_id))
        db.prepare("UPDATE cost_evidence_links SET active=0 WHERE attachment_id=? AND expense_id=?").run(fileId, link.expense_id);
      for (const e of selected) db.prepare(`INSERT INTO cost_evidence_links VALUES(?,?,?,1,?,?)
        ON CONFLICT(attachment_id,expense_id) DO UPDATE SET active=1,source=excluded.source,source_hash=excluded.source_hash`)
        .run(fileId, e.id, row.id, JSON.stringify(e), journalHash(e));
      return event(req, fileId, "links_replaced", v.reason);
    }, () => { period(req, true); });
  });
}
