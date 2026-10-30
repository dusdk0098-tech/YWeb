import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { revision } from "./validation.js";
import { account } from "./inspection-model.js";
import { companyPage } from "./companies.js";
import { assessment, assessmentRecord } from "./risk-core.js";
import { fixedRiskSubmission } from "./risk-review.js";
import { riskHash } from "./risk-model.js";
import { publicationRow, publicationView, publicationReadable, publicationSource, publicationSnapshot, ownPublicationAck, type PublicationRow, type PublicationTarget, type PublicationSnapshot } from "./risk-publication-model.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(1).max(1000);
export const riskPublicationInput = z.object({
  assessmentId: z.uuid(), assessmentVersion: revision, submissionHash: hash,
  recipientIds: z.array(z.uuid()).min(1).max(200).refine((ids) => new Set(ids).size === ids.length, "대상 계정이 중복되었습니다."),
  statement: z.string().trim().min(1).max(2000), reason,
  confirmAccountPublication: z.literal(true),
}).strict();
export const riskPublicationAckInput = z.object({
  version: revision, publicationHash: hash, submissionHash: hash, confirmOwnAccount: z.literal(true),
}).strict();
export function registerRiskPublications(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const base = "/api/sites/:siteId/risk-publications";
  const row = (req: Request) => publicationRow(db, String(req.params.siteId), String(req.params.id));
  function targets(site: string, ids: string[]): PublicationTarget[] {
    return [...ids].sort().map((id) => {
      const target = db.prepare("SELECT u.id userId,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? AND m.user_id=?").get(site, id) as PublicationTarget | undefined;
      if (!target) throw new HttpError(400, "대상은 모두 현재 같은 현장의 계정이어야 합니다.");
      return target;
    });
  }
  function event(req: Request, value: PublicationRow, kind: string, why: string) {
    const actor = account(db, req.session.userId!);
    db.prepare("INSERT INTO risk_publication_events(publication_id,version,event,actor_id,name,at,reason) VALUES(?,?,?,?,?,?,?)").run(value.id, value.version, kind, actor.id, actor.name, new Date().toISOString(), why);
    audit(db, actor.id, value.site_id, "risk.publication." + kind, value.id);
  }
  function readTransaction<T>(read: () => T): T {
    db.exec("BEGIN DEFERRED");
    try { const result = read(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  app.get(base + "/recipients", (req, res) => {
    access(req, true, true);
    const q = companyPage.parse(req.query);
    const rows = db.prepare("SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? ORDER BY u.name,u.id LIMIT 51 OFFSET ?").all(String(req.params.siteId), q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get(base, (req, res) => {
    const q = companyPage.parse(req.query);
    res.json(readTransaction(() => {
      const manager = access(req) === "manager";
      const rows = db.prepare("SELECT p.* FROM risk_publications p WHERE p.site_id=? AND (?=1 OR EXISTS(SELECT 1 FROM risk_publication_targets t WHERE t.publication_id=p.id AND t.user_id=?)) ORDER BY p.created_at DESC,p.id DESC LIMIT 51 OFFSET ?").all(String(req.params.siteId), Number(manager), req.session.userId!, q.offset) as PublicationRow[];
      return { items: rows.slice(0, 50).map((r) => publicationView(db, r, req.session.userId!, manager)), hasMore: rows.length > 50 };
    }));
  });
  app.get(base + "/:id", (req, res) => {
    res.json(readTransaction(() => {
      const manager = access(req) === "manager";
      return publicationView(db, row(req), req.session.userId!, manager);
    }));
  });
  app.get(base + "/:id/source", (req, res) => {
    res.json(readTransaction(() => {
      const manager = access(req) === "manager", current = row(req);
      publicationReadable(db, current, req.session.userId!, manager);
      publicationSnapshot(db, current);
      return publicationSource(db, current);
    }));
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req, true, true);
    const q = companyPage.parse(req.query), current = row(req);
    const rows = db.prepare("SELECT * FROM risk_publication_events WHERE publication_id=? ORDER BY version LIMIT 51 OFFSET ?").all(current.id, q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = riskPublicationInput.parse(req.body), site = String(req.params.siteId);
    function eligible() {
      access(req, true, true);
      const doc = assessmentRecord(assessment(db, site, v.assessmentId));
      if (doc.status !== "accepted" || doc.successor_id || doc.version !== v.assessmentVersion || doc.submission_hash !== v.submissionHash) throw new HttpError(409, "후속 문서 없는 최신 문서 수락본과 정확한 버전/hash가 필요합니다.");
      const source = fixedRiskSubmission(doc);
      return { doc, source, recipients: targets(site, v.recipientIds) };
    }
    eligible();
    mutate(req, res, `risk:publication:create:${site}`, v, () => {
      const { doc, source, recipients } = eligible();
      if (db.prepare("SELECT 1 FROM risk_publications WHERE assessment_id=? AND status='published'").get(doc.id)) throw new HttpError(409, "이 평가에 활성 게시본이 있습니다. 대상 변경은 기존 게시본 철회 후 별도로 게시하세요.");
      const id = randomUUID(), now = new Date().toISOString();
      const snapshot: PublicationSnapshot = {
        id, siteId: site,
        source: { assessmentId: doc.id, assessmentVersion: doc.version, submissionVersion: source.version, submissionHash: doc.submission_hash!, title: source.body.title },
        statement: v.statement, publisher: account(db, req.session.userId!), publishedAt: now, targets: recipients,
      };
      db.prepare("INSERT INTO risk_publications(id,site_id,assessment_id,submission_version,submission_hash,snapshot,snapshot_hash,status,version,created_at) VALUES(?,?,?,?,?,?,?,'published',1,?)").run(id, site, doc.id, source.version, doc.submission_hash!, JSON.stringify(snapshot), riskHash(snapshot), now);
      for (const target of recipients) db.prepare("INSERT INTO risk_publication_targets VALUES(?,?,?)").run(id, target.userId, target.name);
      event(req, publicationRow(db, site, id), "published", v.reason);
      return { id }; // Replayed creation receipt is an ID, not a stale/private current-state view.
    }, () => { eligible(); });
  });
  app.post(base + "/:id/withdraw", (req, res) => {
    access(req, true, true);
    const v = z.object({ version: revision, reason }).strict().parse(req.body);
    const site = String(req.params.siteId), id = String(req.params.id);
    mutate(req, res, `risk:publication:withdraw:${site}:${id}`, v, () => {
      const current = row(req);
      if (current.status !== "published" || current.version !== v.version) throw new HttpError(409, "게시 상태/버전이 바뀌었습니다. 다시 조회하세요.");
      db.prepare("UPDATE risk_publications SET status='withdrawn',version=version+1,withdrawn_at=?,withdraw_reason=? WHERE id=?").run(new Date().toISOString(), v.reason, id);
      event(req, row(req), "withdrawn", v.reason);
      return { id, status: "withdrawn", version: current.version + 1 };
    }, () => { access(req, true, true); row(req); });
  });
  app.post(base + "/:id/acknowledge", (req, res) => {
    access(req);
    const v = riskPublicationAckInput.parse(req.body), site = String(req.params.siteId), id = String(req.params.id);
    function eligible() {
      access(req);
      const current = row(req);
      publicationReadable(db, current, req.session.userId!, false);
      const snapshot = publicationSnapshot(db, current), source = publicationSource(db, current);
      if (current.status !== "published" || current.version !== v.version || current.snapshot_hash !== v.publicationHash || current.submission_hash !== v.submissionHash || source.sourceHasSuccessor || source.sourceStatus !== "accepted") throw new HttpError(409, "게시/원문 상태가 바뀌었습니다. 철회·후속 문서가 있는 게시본은 새 확인을 받지 않습니다.");
      return { current, snapshot };
    }
    eligible();
    mutate(req, res, `risk:publication:ack:${site}:${id}`, v, () => {
      const { current, snapshot } = eligible();
      if (!ownPublicationAck(db, id, req.session.userId!)) {
        const actor = account(db, req.session.userId!);
        db.prepare("INSERT INTO risk_publication_acks VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(), id, actor.id, actor.name, new Date().toISOString(), current.submission_hash, current.snapshot_hash, snapshot.statement);
        audit(db, actor.id, site, "risk.publication.account_acknowledged", id);
      }
      return { publicationId: id, ownAck: ownPublicationAck(db, id, req.session.userId!) };
    }, () => { eligible(); });
  });
}
