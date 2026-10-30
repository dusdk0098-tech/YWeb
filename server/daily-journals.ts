import { registerDailyInspectionCandidates,resetDailyInspectionBody,captureDailyInspections } from "./daily-inspection-references.js";
import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { date } from "./validation.js";
import { inspectionPage } from "./inspection-validation.js";
import { account, checkVersion } from "./inspection-model.js";
import {
  dailyCreate,
  dailyEdit,
  dailyVersion,
  dailyRevise,
} from "./daily-journal-validation.js";
import {
  getDaily,
  fullDaily,
  dailyRecord,
  type DailyRow,
  type DailySnapshot,
} from "./daily-journal-model.js";
import {
  dailySourceFacts,
  journalHash,
  type DailyCapture,
} from "./daily-journal-sources.js";
import { printDaily } from "./daily-journal-print.js";
export function registerDailyJournals(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  registerDailyInspectionCandidates(app,db,{access,mutate});
  const base = "/api/sites/:siteId/daily-journals";
  function eligible(site: string, id: string) {
    if (
      !db
        .prepare(
          "SELECT 1 FROM memberships WHERE site_id=? AND user_id=? AND role IN ('manager','editor')",
        )
        .get(site, id)
    )
      throw new HttpError(400, "작성자는 현재 현장 작성자/관리자여야 합니다.");
  }
  function own(req: Request) {
    access(req, true);
    const row = getDaily(db, String(req.params.siteId), String(req.params.id));
    if (row.author_id !== req.session.userId)
      throw new HttpError(
        403,
        "원 작성자만 일지 초안/자료 참조를 변경할 수 있습니다.",
      );
    return row;
  }
  function event(req: Request, row: DailyRow, type: string, note: string) {
    const actor = account(db, req.session.userId!);
    db.prepare(
      "INSERT INTO daily_journal_events(journal_id,version,event,actor_id,actor_name,at,note) VALUES(?,?,?,?,?,?,?)",
    ).run(
      row.id,
      row.version,
      type,
      actor.id,
      actor.name,
      row.updated_at,
      note,
    );
    audit(db, actor.id, row.site_id, "daily." + type, row.id);
  }
  app.get(base, (req, res) => {
    access(req);
    const q = inspectionPage.extend({ date: date.optional() }).parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM daily_journals WHERE site_id=? AND (? IS NULL OR date=?) ORDER BY date DESC,created_at DESC,id LIMIT 51 OFFSET ?",
      )
      .all(
        String(req.params.siteId),
        q.date || null,
        q.date || null,
        q.offset,
      ) as DailyRow[];
    res.json({
      items: rows.slice(0, 50).map(dailyRecord),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/authors", (req, res) => {
    access(req, true, true);
    res.json(
      db
        .prepare(
          "SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.site_id=? AND m.role IN ('editor','manager') ORDER BY u.name,u.id",
        )
        .all(String(req.params.siteId)),
    );
  });
  app.post(base, (req, res) => {
    access(req, true);
    const v = dailyCreate.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `daily:create:${site}`,
      v,
      () => {
        if (
          db
            .prepare(
              "SELECT id FROM daily_journals WHERE site_id=? AND date=? AND parent_id IS NULL",
            )
            .get(site, v.date)
        )
          throw new HttpError(
            409,
            "그 현장·날짜의 최초 일지가 이미 있습니다. 날짜로 조회하고 기존 일지/정정본을 여세요.",
          );
        if(v.body.inspectionReferences)captureDailyInspections(db,site,v.date,v.body.inspectionReferences);
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO daily_journals VALUES(?,?,?,?,'draft',1,?,NULL,'',NULL,?,?)",
        ).run(
          id,
          site,
          v.date,
          JSON.stringify(v.body),
          req.session.userId!,
          now,
          now,
        );
        const row = getDaily(db, site, id);
        event(req, row, "created", "선택 날짜의 수기 일지 생성");
        return fullDaily(db, row);
      },
      () => {
        access(req, true);
      },
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(
      fullDaily(
        db,
        getDaily(db, String(req.params.siteId), String(req.params.id)),
      ),
    );
  });
  app.put(base + "/:id", (req, res) => {
    own(req);
    const v = dailyEdit.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `daily:edit:${site}:${id}`,
      v,
      () => {
        const row = own(req);
        checkVersion(row, v.version, "draft");
        if(v.body.inspectionReferences)captureDailyInspections(db,site,row.date,v.body.inspectionReferences);
        db.prepare(
          "UPDATE daily_journals SET body=?,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(v.body), new Date().toISOString(), id);
        const next = getDaily(db, site, id);
        event(req, next, "draft_updated", "수기 일지 내용 수정");
        return fullDaily(db, next);
      },
      () => {
        own(req);
      },
    );
  });
  app.post(base + "/:id/capture", (req, res) => {
    own(req);
    const v = dailyVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `daily:capture:${site}:${id}`,
      v,
      () => {
        const row = own(req);
        checkVersion(row, v.version, "draft");
        const facts = dailySourceFacts(db, site, row.date, dailyRecord(row).body.inspectionReferences),
          capture: DailyCapture = {
            facts,
            fingerprint: journalHash(facts),
            capturedAt: new Date().toISOString(),
            capturedBy: account(db, req.session.userId!),
          };
        db.prepare(
          "UPDATE daily_journals SET source_capture=?,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(capture), capture.capturedAt, id);
        const next = getDaily(db, site, id);
        event(req, next, "sources_captured", capture.fingerprint);
        return fullDaily(db, next);
      },
      () => {
        own(req);
      },
    );
  });
  app.post(base + "/:id/archive", (req, res) => {
    access(req, true, true);
    const v = dailyVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    eligible(site, getDaily(db, site, id).author_id);
    mutate(
      req,
      res,
      `daily:archive:${site}:${id}`,
      v,
      () => {
        const row = getDaily(db, site, id);
        checkVersion(row, v.version, "draft");
        eligible(site, row.author_id);
        const parsed = dailyRecord(row);
        if (!parsed.body.workSummary || !parsed.body.safetyInstructions || (parsed.body.inspectionReferences && (!parsed.body.inspectionReferences.length || parsed.body.inspectionReferences.some(r=>!r.note))))
          throw new HttpError(
            400,
            "보관에는 작업 요약과 안전 안내 기록이 필요합니다.",
          );
        if (!parsed.source_capture)
          throw new HttpError(
            409,
            "작성자가 먼저 해당일 자료 참조를 명시적으로 가져와야 합니다.",
          );
        if (
          journalHash(dailySourceFacts(db, site, row.date, dailyRecord(row).body.inspectionReferences)) !==
          parsed.source_capture.fingerprint
        )
          throw new HttpError(
            409,
            "참조 원자료가 바뀌었습니다. 작성자가 자료 참조를 갱신한 뒤 다시 보관하세요.",
          );
        const now = new Date().toISOString(),
          snapshot: DailySnapshot = {
            id,
            date: row.date,
            version: row.version + 1,
            site: {
              id: site,
              name: (
                db.prepare("SELECT name FROM sites WHERE id=?").get(site) as {
                  name: string;
                }
              ).name,
            },
            author: account(db, row.author_id),
            parentId: row.parent_id,
            revisionReason: row.revision_reason,
            body: parsed.body,
            source: parsed.source_capture,
            archivedBy: account(db, req.session.userId!),
            archivedAt: now,
          };
        db.prepare(
          "UPDATE daily_journals SET status='archived',version=version+1,updated_at=? WHERE id=?",
        ).run(now, id);
        db.prepare("INSERT INTO daily_journal_snapshots VALUES(?,?,?)").run(
          id,
          JSON.stringify(snapshot),
          journalHash(snapshot),
        );
        const next = getDaily(db, site, id);
        event(
          req,
          next,
          "archived",
          "관리자 수기 일지 기록 보관 (안전 인증 아님)",
        );
        return fullDaily(db, next);
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const v = dailyRevise.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    eligible(site, v.authorId);
    mutate(
      req,
      res,
      `daily:revise:${site}:${id}`,
      v,
      () => {
        const row = getDaily(db, site, id);
        checkVersion(row, v.version, "archived");
        eligible(site, v.authorId);
        if (
          db.prepare("SELECT id FROM daily_journals WHERE parent_id=?").get(id)
        )
          throw new HttpError(
            409,
            "연결된 정정 초안이 이미 있습니다. 기존 후속 일지를 여세요.",
          );
        const nextId = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO daily_journals VALUES(?,?,?,?,'draft',1,?,?,?,NULL,?,?)",
        ).run(
          nextId,
          site,
          row.date,
          resetDailyInspectionBody(row.body),
          v.authorId,
          id,
          v.reason,
          now,
          now,
        );
        const next = getDaily(db, site, nextId);
        event(req, next, "revision_created", v.reason);
        return fullDaily(db, next);
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req);
    const row = getDaily(db, String(req.params.siteId), String(req.params.id)),
      q = inspectionPage.parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM daily_journal_events WHERE journal_id=? ORDER BY version LIMIT 51 OFFSET ?",
      )
      .all(row.id, q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    res
      .type("html")
      .send(
        printDaily(
          fullDaily(
            db,
            getDaily(db, String(req.params.siteId), String(req.params.id)),
          ),
        ),
      );
  });
}
