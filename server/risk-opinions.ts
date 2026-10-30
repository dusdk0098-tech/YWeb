import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { revision } from "./validation.js";
import { companyPage } from "./companies.js";
import { assessment, assessmentRecord } from "./risk-core.js";
import { fixedRiskSubmission } from "./risk-review.js";
import { riskHash } from "./risk-model.js";
import { account } from "./inspection-model.js";
type Actor = { id: string; name: string };
type OpinionSource = {
  assessmentId: string;
  siteId: string;
  submissionHash: string;
  submissionVersion: number;
  title: string;
  assessmentDate: string;
  hazardId: string | null;
  task: string | null;
};
type Original = { text: string; author: Actor; recordedAt: string };
type Response = {
  outcome: "planned" | "not_applied" | "needs_information";
  note: string;
  actor: Actor;
  recordedAt: string;
  opinionVersion: number;
};
type OpinionRow = {
  id: string;
  site_id: string;
  assessment_id: string;
  author_id: string;
  hazard_id: string | null;
  source: string;
  source_hash: string;
  original: string;
  original_hash: string;
  current_text: string;
  version: number;
  status: "open" | "responded";
  response: string | null;
  created_at: string;
  updated_at: string;
};
function row(db: Db, site: string, id: string) {
  const value = db
    .prepare("SELECT * FROM risk_opinions WHERE site_id=? AND id=?")
    .get(site, id) as OpinionRow | undefined;
  if (!value)
    throw new HttpError(404, "이 현장에서 조회 가능한 의견이 없습니다.");
  return value;
}
function record(db: Db, r: OpinionRow) {
  const source = JSON.parse(r.source) as OpinionSource,
    original = JSON.parse(r.original) as Original;
  if (
    riskHash(source) !== r.source_hash ||
    riskHash(original) !== r.original_hash ||
    source.assessmentId !== r.assessment_id ||
    source.siteId !== r.site_id ||
    source.hazardId !== r.hazard_id ||
    original.author.id !== r.author_id
  )
    throw new HttpError(409, "의견 원문/출처가 일치하지 않습니다.");
  const doc = assessment(db, r.site_id, r.assessment_id);
  return {
    ...r,
    source,
    original,
    response: r.response ? (JSON.parse(r.response) as Response) : null,
    sourceDocument: {
      status: doc.status,
      version: doc.version,
      successorId: doc.successor_id,
    },
  };
}
export type RiskOpinion = ReturnType<typeof record>;
const prose = z.string().trim().min(1).max(5000),
  reason = z.string().trim().min(1).max(1000);
export function registerRiskOpinions(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/risk-opinions";
  function readable(req: Request) {
    const role = access(req),
      r = row(db, String(req.params.siteId), String(req.params.id));
    if (role !== "manager" && r.author_id !== req.session.userId)
      throw new HttpError(404, "이 현장에서 조회 가능한 의견이 없습니다.");
    return r;
  }
  function author(req: Request) {
    access(req, true);
    const r = readable(req);
    if (r.author_id !== req.session.userId)
      throw new HttpError(403, "작성 계정만 의견을 보충/정정할 수 있습니다.");
    return r;
  }
  function manager(req: Request) {
    access(req, true, true);
    return readable(req);
  }
  function event(req: Request, r: RiskOpinion, kind: string, why: string) {
    const a = account(db, req.session.userId!);
    db.prepare(
      "INSERT INTO risk_opinion_events(opinion_id,version,event,reason,actor_id,actor_name,at,snapshot) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      r.id,
      r.version,
      kind,
      why,
      a.id,
      a.name,
      new Date().toISOString(),
      JSON.stringify(r),
    );
    audit(db, a.id, r.site_id, "risk.opinion." + kind, r.id);
  }
  app.get(base, (req, res) => {
    const role = access(req),
      q = companyPage
        .extend({ assessmentId: z.uuid().optional() })
        .parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM risk_opinions WHERE site_id=? AND (?='manager' OR author_id=?) AND (? IS NULL OR assessment_id=?) ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?",
      )
      .all(
        String(req.params.siteId),
        role,
        req.session.userId!,
        q.assessmentId ?? null,
        q.assessmentId ?? null,
        q.offset,
      ) as OpinionRow[];
    res.json({
      items: rows.slice(0, 50).map((r) => record(db, r)),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/:id", (req, res) => res.json(record(db, readable(req))));
  app.get(base + "/:id/events", (req, res) => {
    const r = readable(req),
      q = companyPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM risk_opinion_events WHERE opinion_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(r.id, q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post("/api/sites/:siteId/risk-assessments/:id/opinions", (req, res) => {
    access(req, true);
    const v = z
        .object({
          submissionHash: z.string().regex(/^[a-f0-9]{64}$/),
          hazardId: z.uuid().nullable(),
          text: prose,
          confirmAccountOpinion: z.literal(true),
        })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `risk:opinion:create:${site}:${id}`,
      v,
      () => {
        const doc = assessmentRecord(assessment(db, site, id));
        if (
          !["submitted", "accepted"].includes(doc.status) ||
          doc.successor_id ||
          doc.submission_hash !== v.submissionHash
        )
          throw new HttpError(
            409,
            "현재 후속 문서 없는 제출/수락본의 고정 원문을 선택하세요.",
          );
        const s = fixedRiskSubmission(doc),
          hazard = v.hazardId
            ? s.body.hazards.find((h) => h.id === v.hazardId)
            : null;
        if (v.hazardId && !hazard)
          throw new HttpError(404, "원 제출본의 위험행이 없습니다.");
        const oid = randomUUID(),
          at = new Date().toISOString(),
          source: OpinionSource = {
            assessmentId: id,
            siteId: site,
            submissionHash: doc.submission_hash!,
            submissionVersion: s.version,
            title: s.body.title,
            assessmentDate: s.body.date,
            hazardId: v.hazardId,
            task: hazard?.task ?? null,
          },
          original: Original = {
            text: v.text,
            author: account(db, req.session.userId!),
            recordedAt: at,
          };
        db.prepare(
          "INSERT INTO risk_opinions VALUES(?,?,?,?,?,?,?,?,?,?,1,'open',NULL,?,?)",
        ).run(
          oid,
          site,
          id,
          req.session.userId!,
          v.hazardId,
          JSON.stringify(source),
          riskHash(source),
          JSON.stringify(original),
          riskHash(original),
          v.text,
          at,
          at,
        );
        const r = record(db, row(db, site, oid));
        event(
          req,
          r,
          "created",
          "현재 계정 의견 제출 · 근로자 본인 참여 증명 아님",
        );
        return r;
      },
      () => {
        access(req, true);
        assessment(db, site, id);
      },
    );
  });
  app.post(base + "/:id/amend", (req, res) => {
    author(req);
    const v = z
      .object({ version: revision, text: prose, reason })
      .strict()
      .parse(req.body);
    mutate(
      req,
      res,
      `risk:opinion:amend:${req.params.siteId}:${req.params.id}`,
      v,
      () => {
        const old = author(req);
        if (old.version !== v.version)
          throw new HttpError(409, "의견 버전이 바뀌었습니다.");
        db.prepare(
          "UPDATE risk_opinions SET current_text=?,response=NULL,status='open',version=version+1,updated_at=? WHERE id=?",
        ).run(v.text, new Date().toISOString(), old.id);
        const r = record(db, readable(req));
        event(req, r, "amended", v.reason);
        return r;
      },
      () => {
        author(req);
      },
    );
  });
  app.post(base + "/:id/respond", (req, res) => {
    manager(req);
    const v = z
      .object({
        version: revision,
        outcome: z.enum(["planned", "not_applied", "needs_information"]),
        note: prose,
        reason,
      })
      .strict()
      .parse(req.body);
    mutate(
      req,
      res,
      `risk:opinion:respond:${req.params.siteId}:${req.params.id}`,
      v,
      () => {
        const old = manager(req);
        if (old.version !== v.version)
          throw new HttpError(409, "의견/응답 버전이 바뀌었습니다.");
        const response: Response = {
          outcome: v.outcome,
          note: v.note,
          actor: account(db, req.session.userId!),
          recordedAt: new Date().toISOString(),
          opinionVersion: old.version,
        };
        db.prepare(
          "UPDATE risk_opinions SET response=?,status='responded',version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(response), response.recordedAt, old.id);
        const r = record(db, readable(req));
        event(
          req,
          r,
          old.response ? "response_corrected" : "responded",
          v.reason,
        );
        return r;
      },
      () => {
        manager(req);
      },
    );
  });
}
