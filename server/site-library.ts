import type { Express, Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { account } from "./inspection-model.js";
import { rawAttachmentMetadata, checkRawImageHeader, checkRawPdfHeader, recheckUploadSession } from "./raw-attachment.js";
import { attachmentUsage, enforceAttachmentQuota } from "./attachment-quota.js";
import { sendAttachment, type boundedUploadReader } from "./bounded-upload.js";
// WEB-01 1단계 (docs/REMAINING_AREAS_SPEC.md "권장대로"): a site-members-only library. Managers upload PDF/PNG/JPEG after confirming
// they checked the file's rights; members download the unscanned original. Files are never deleted, only withdrawn with a reason.
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
export function migrateSiteLibrary(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS library_files(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),title TEXT NOT NULL,edition TEXT NOT NULL,filename TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN('image/png','image/jpeg','application/pdf')),size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880),sha256 TEXT NOT NULL,bytes BLOB NOT NULL CHECK(length(bytes)=size),
  rights_checked_by TEXT NOT NULL,uploaded_by TEXT NOT NULL REFERENCES users(id),uploaded_at TEXT NOT NULL,withdrawn_at TEXT,withdrawn_reason TEXT,withdrawn_by TEXT);
 CREATE INDEX IF NOT EXISTS library_files_site ON library_files(site_id,uploaded_at);
 CREATE TRIGGER IF NOT EXISTS library_file_withdraw_once BEFORE UPDATE ON library_files WHEN OLD.withdrawn_at IS NOT NULL OR NEW.withdrawn_at IS NULL OR
  NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.title IS NOT OLD.title OR NEW.edition IS NOT OLD.edition OR NEW.filename IS NOT OLD.filename OR NEW.format IS NOT OLD.format OR
  NEW.size IS NOT OLD.size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.bytes IS NOT OLD.bytes OR NEW.rights_checked_by IS NOT OLD.rights_checked_by OR NEW.uploaded_by IS NOT OLD.uploaded_by OR NEW.uploaded_at IS NOT OLD.uploaded_at
 BEGIN SELECT RAISE(ABORT,'Library file fixed; withdraw once'); END;
 CREATE TRIGGER IF NOT EXISTS library_file_retained BEFORE DELETE ON library_files BEGIN SELECT RAISE(ABORT,'Library file retained'); END;
 PRAGMA user_version=66;
`);
}
export const LIBRARY_MAX_FILES = 200;
export function isLibraryUpload(method: string, path: string) {
  return method === "POST" && /^\/api\/sites\/[^/]+\/library\/?$/i.test(path);
}
const headerText = (req: Request, name: string, max: number, label: string) => {
  let v: string;
  try { v = decodeURIComponent(req.get(name) || "").trim(); } catch { throw new HttpError(400, `${label} 인코딩이 올바르지 않습니다.`); }
  if (!v || v.length > max) throw new HttpError(400, `${label}을(를) ${max}자 이하로 입력하세요.`);
  return v;
};
type FileRow = { id: string; title: string; edition: string; filename: string; format: string; size: number; sha256: string; rights_checked_by: string; uploaded_at: string; uploader: string; withdrawn_at: string | null; withdrawn_reason: string | null };
const listFiles = (db: Db, site: string) => db.prepare(`SELECT f.id,f.title,f.edition,f.filename,f.format,f.size,f.sha256,f.rights_checked_by,f.uploaded_at,u.name AS uploader,f.withdrawn_at,f.withdrawn_reason
  FROM library_files f JOIN users u ON u.id=f.uploaded_by WHERE f.site_id=? ORDER BY f.uploaded_at DESC,f.id`).all(site) as FileRow[];
export function registerSiteLibrary(app: Express, db: Db, { access, mutate }: SiteOperations, read: ReturnType<typeof boundedUploadReader>) {
  const base = "/api/sites/:siteId/library";
  // Revision = number of files; an upload sends revision+1 (the slot it fills), so a duplicate or concurrent upload is visible.
  const revision = (site: string) => (db.prepare("SELECT count(*) n FROM library_files WHERE site_id=?").get(site) as { n: number }).n;
  app.get(base, (req, res) => { access(req); const site = String(req.params.siteId); res.json({ revision: revision(site), items: listFiles(db, site) }); });
  app.post(base, async (req, res, next) => {
    try {
      access(req, true, true);
      const site = String(req.params.siteId), { version, format, filename } = rawAttachmentMetadata(req, "x-library-revision", true);
      const title = headerText(req, "x-library-title", 200, "자료 제목"), edition = headerText(req, "x-library-edition", 100, "판 표시");
      if (req.get("x-rights-confirmed") !== "1") throw new HttpError(400, "자료의 저작권·사용 허락을 확인했는지 체크하세요.");
      const bytes = await read(req);
      if (format === "application/pdf") checkRawPdfHeader(bytes); else checkRawImageHeader(bytes, format);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      recheckUploadSession(db, req);
      mutate(req, res, `library:upload:${site}`, { version, title, edition, filename, format, size: bytes.length, sha256 }, () => {
        access(req, true, true);
        const current = revision(site);
        if (current + 1 !== version) throw new HttpError(409, "자료 목록이 바뀌었습니다. 목록을 새로 보고 다시 올리세요.");
        if (current >= LIBRARY_MAX_FILES) throw new HttpError(409, `현장 자료실에는 ${LIBRARY_MAX_FILES}개까지 둘 수 있습니다.`);
        enforceAttachmentQuota({ ...attachmentUsage(db, site, site, "library"), reportCount: 0 }, bytes.length);
        const id = randomUUID(), actor = account(db, req.session.userId!);
        db.prepare("INSERT INTO library_files(id,site_id,title,edition,filename,format,size,sha256,bytes,rights_checked_by,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(id, site, title, edition, filename, format, bytes.length, sha256, bytes, actor.name, actor.id, new Date().toISOString());
        audit(db, actor.id, site, "library.uploaded", id);
        return { revision: revision(site), items: listFiles(db, site) };
      }, () => { access(req, true, true); });
    } catch (err) { req.pause(); res.set("Connection", "close"); next(err); }
  });
  app.post(base + "/:fileId/withdraw", (req, res) => {
    access(req, true, true);
    const v = z.object({ reason: z.string().trim().min(1, "게시 중지 사유를 입력하세요.").max(500) }).strict().parse(req.body), site = String(req.params.siteId), fileId = String(req.params.fileId);
    mutate(req, res, `library:withdraw:${site}:${fileId}`, v, () => {
      const r = db.prepare("UPDATE library_files SET withdrawn_at=?,withdrawn_reason=?,withdrawn_by=? WHERE id=? AND site_id=? AND withdrawn_at IS NULL").run(new Date().toISOString(), v.reason, req.session.userId!, fileId, site);
      if (!r.changes) throw new HttpError(404, "게시 중인 자료를 찾을 수 없습니다.");
      audit(db, req.session.userId!, site, "library.withdrawn", fileId);
      return { revision: revision(site), items: listFiles(db, site) };
    }, () => { access(req, true, true); });
  });
  app.get(base + "/:fileId/download", (req, res) => {
    access(req);
    const f = db.prepare("SELECT * FROM library_files WHERE id=? AND site_id=?").get(String(req.params.fileId), String(req.params.siteId)) as (FileRow & { bytes: Uint8Array }) | undefined;
    if (!f) throw new HttpError(404, "자료를 찾을 수 없습니다.");
    if (f.withdrawn_at) throw new HttpError(410, "게시 중지된 자료입니다.");
    sendAttachment(res, f, f.bytes);
  });
}
