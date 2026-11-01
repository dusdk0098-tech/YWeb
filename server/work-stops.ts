import { SOLE_MANAGER_NOTE, soleManager } from "./sole-manager.js";
import { persistedAccountSession } from "./account-session.js";
import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, canWriteSite, type SiteOperations } from "./site-operations.js";
import {
  workStopInput,
  workStopReason,
  workStopAssignment,
  workStopActionTime,
  workStopReview,
  workStopResumption,
  workStopPage,
  workStopFilter,
  type WorkStopStatus,
} from "./work-stop-validation.js";
import {
  workStopHash,
  workStopRow,
  workStopRecord,
  type WorkStopRow,
  type WorkStopEvent,
} from "./work-stop-model.js";
import { printWorkStop } from "./work-stop-print.js";
export function registerWorkStops(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/work-stops";
  function liveAccess(req: Request, manager = false) {
    if (
      !req.session.userId ||
      !req.session.authEpoch ||
      !persistedAccountSession(
        db,
        req.sessionID,
        req.session.userId,
        req.session.authEpoch,
      )
    )
      throw new HttpError(401, "세션이 만료되었습니다. 다시 로그인하세요.");
    access(req, true, manager);
  }
  const get = (req: Request) =>
    workStopRow(db, String(req.params.siteId), String(req.params.id));
  function actor(req: Request) {
    return db
      .prepare("SELECT id,name FROM users WHERE id=?")
      .get(req.session.userId!) as { id: string; name: string };
  }
  function eligible(site: string, id: string) {
    if (
      !canWriteSite(db, site, id)
    )
      throw new HttpError(
        400,
        "담당자는 현재 현장의 작성자/관리자 계정이어야 합니다.",
      );
  }
  function expected(
    row: WorkStopRow,
    version: number,
    states: WorkStopStatus[],
  ) {
    if (row.version !== version || !states.includes(row.status))
      throw new HttpError(
        409,
        "버전 또는 기록 상태가 변경되었습니다. 입력을 보관하고 최신본을 다시 여세요.",
      );
  }
  function event(req: Request, row: WorkStopRow, name: string, note: string) {
    const a = actor(req);
    db.prepare(
      "INSERT INTO work_stop_events(record_id,version,event,actor_id,actor_name,at,note,snapshot) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      row.id,
      row.version,
      name,
      a.id,
      a.name,
      row.updated_at,
      note,
      JSON.stringify(workStopRecord(db, row)),
    );
    audit(db, a.id, row.site_id, "work_stop_" + name, row.id);
  }
  function save(
    req: Request,
    old: WorkStopRow,
    change: Partial<WorkStopRow>,
    name: string,
    note: string,
  ) {
    const next = {
      ...old,
      ...change,
      version: old.version + 1,
      updated_at: new Date().toISOString(),
    };
    const result = db
      .prepare(
        "UPDATE work_stops SET status=?,version=?,assignee_id=?,stop_record=?,review_record=?,resumption_record=?,updated_at=? WHERE id=? AND site_id=? AND version=?",
      )
      .run(
        next.status,
        next.version,
        next.assignee_id,
        next.stop_record,
        next.review_record,
        next.resumption_record,
        next.updated_at,
        next.id,
        next.site_id,
        old.version,
      );
    if (result.changes !== 1) throw new HttpError(409, "동시 변경 충돌");
    event(req, next, name, note);
    return workStopRecord(db, next);
  }
  app.get(base + "/assignees", (req, res) => {
    access(req, false, true);
    const { offset } = workStopPage.parse(req.query);
    const rows = db
      .prepare(
        "SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? AND m.role IN('editor','manager') ORDER BY u.name,u.id LIMIT 51 OFFSET ?",
      )
      .all(String(req.params.siteId), offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get(base, (req, res) => {
    access(req);
    const q = workStopFilter.parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM work_stops WHERE site_id=? AND (? IS NULL OR status=?) ORDER BY updated_at DESC,id DESC LIMIT 51 OFFSET ?",
      )
      .all(
        String(req.params.siteId),
        q.status || null,
        q.status || null,
        q.offset,
      ) as WorkStopRow[];
    res.json({
      items: rows.slice(0, 50).map((r) => workStopRecord(db, r)),
      hasMore: rows.length > 50,
    });
  });
  app.post(base, (req, res) => {
    access(req, true);
    const input = workStopInput.parse(req.body);
    mutate(
      req,
      res,
      `site:${req.params.siteId}:work-stop:create`,
      input,
      () => {
        const a = actor(req),
          id = randomUUID(),
          site = String(req.params.siteId),
          at = new Date().toISOString(),
          name = db
            .prepare("SELECT name FROM sites WHERE id=?")
            .get(site)!.name;
        const original = JSON.stringify({
          id,
          site: { id: site, name },
          requester: a,
          body: input,
          requestedAt: at,
        });
        db.prepare(
          "INSERT INTO work_stops(id,site_id,requester_id,original,original_hash,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'requested',1,?,?)",
        ).run(id, site, a.id, original, workStopHash(original), at, at);
        const row = workStopRow(db, site, id);
        event(
          req,
          row,
          "requested",
          "수기 요청 접수; 외부 알림/현장 조치 없음",
        );
        return workStopRecord(db, row);
      },
      () => {
        liveAccess(req);
      },
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(workStopRecord(db, get(req)));
  });
  app.get(base + "/:id/history", (req, res) => {
    access(req);
    const row = get(req),
      { offset } = workStopPage.parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM work_stop_events WHERE record_id=? ORDER BY version,id LIMIT 51 OFFSET ?",
      )
      .all(row.id, offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    const row = get(req),
      events = db
        .prepare(
          "SELECT * FROM work_stop_events WHERE record_id=? ORDER BY version,id LIMIT 1001",
        )
        .all(row.id) as WorkStopEvent[];
    if (events.length > 1000)
      throw new HttpError(
        400,
        "전체 이력이 1000건을 넘어 인쇄하지 않습니다. 페이지별 이력을 확인하세요. 일부만 출력하지 않습니다.",
      );
    res.type("html").send(printWorkStop(workStopRecord(db, row), events));
  });
  app.post(base + "/:id/:action", (req, res) => {
    const action = String(req.params.action),
      isReview = action === "request-review";
    if (
      ![
        "acknowledge",
        "reassign",
        "record-stop",
        "request-review",
        "return-review",
        "record-resumption",
        "close-without-stop",
        "annotate",
      ].includes(action)
    )
      throw new HttpError(404, "지원하지 않는 기록 동작");
    function authorize() {
      liveAccess(req, !isReview);
      const row = get(req);
      if (isReview && row.assignee_id !== req.session.userId)
        throw new HttpError(
          403,
          "현재 배정된 계정만 개선 기록을 제출할 수 있습니다.",
        );
      if (action === "record-resumption") {
        const record = workStopRecord(db, row);
        if (
          (row.requester_id === req.session.userId ||
            record.review_record?.actorId === req.session.userId) &&
          !soleManager(db, row.site_id, req.session.userId!)
        )
          throw new HttpError(
            403,
            "원 요청자와 개선 제출자가 아닌 다른 현장 관리자가 기록해야 합니다. 현장 관리에서 다른 관리자 배정을 확인하세요.",
          );
      }
    }
    authorize();
    const current = get(req);
    const schema = ["acknowledge", "reassign"].includes(action)
      ? workStopAssignment
      : action === "record-stop"
        ? workStopActionTime
        : isReview
          ? workStopReview
          : action === "record-resumption"
            ? workStopResumption
            : workStopReason;
    const input = schema.parse(req.body);
    mutate(
      req,
      res,
      `site:${current.site_id}:work-stop:${current.id}:${action}`,
      input,
      () => {
        const row = get(req),
          a = actor(req),
          at = new Date().toISOString();
        const note = input.reason;
        const timed = (value: { recordedLocal: string }) => ({
          actorId: a.id,
          actorName: a.name,
          recordedLocal: value.recordedLocal,
          reason: note,
          at,
        });
        if (action === "acknowledge" || action === "reassign") {
          const value = workStopAssignment.parse(input);
          expected(
            row,
            value.version,
            action === "acknowledge"
              ? ["requested"]
              : ["acknowledged", "stop_recorded", "review_requested"],
          );
          eligible(row.site_id, value.assigneeId);
          return save(
            req,
            row,
            {
              assignee_id: value.assigneeId,
              status:
                action === "acknowledge"
                  ? "acknowledged"
                  : row.status === "review_requested"
                    ? "stop_recorded"
                    : row.status,
              review_record: null,
            },
            action,
            note,
          );
        }
        if (action === "record-stop") {
          const value = workStopActionTime.parse(input);
          expected(row, value.version, ["acknowledged"]);
          return save(
            req,
            row,
            {
              status: "stop_recorded",
              stop_record: JSON.stringify(timed(value)),
            },
            action,
            note,
          );
        }
        if (isReview) {
          const value = workStopReview.parse(input);
          expected(row, value.version, ["stop_recorded"]);
          if (row.assignee_id !== a.id)
            throw new HttpError(403, "현재 담당자만 제출");
          eligible(row.site_id, a.id);
          return save(
            req,
            row,
            {
              status: "review_requested",
              review_record: JSON.stringify({
                actorId: a.id,
                actorName: a.name,
                improvements: value.improvements,
                conditions: value.conditions,
                reason: note,
                at,
              }),
            },
            action,
            note,
          );
        }
        if (action === "return-review") {
          expected(row, input.version, ["review_requested"]);
          return save(
            req,
            row,
            { status: "stop_recorded", review_record: null },
            action,
            note,
          );
        }
        if (action === "record-resumption") {
          const value = workStopResumption.parse(input);
          expected(row, value.version, ["review_requested"]);
          const record = workStopRecord(db, row);
          if (!record.stop_record || !record.review_record)
            throw new HttpError(409, "중지/개선 기록이 필요합니다.");
          eligible(row.site_id, record.review_record.actorId);
          const sole = soleManager(db, row.site_id, a.id);
          if (
            (a.id === row.requester_id ||
              a.id === record.review_record.actorId) &&
            !sole
          )
            throw new HttpError(403, "다른 관리자의 검토 기록이 필요합니다.");
          if (value.recordedLocal < record.stop_record.recordedLocal)
            throw new HttpError(
              400,
              "재개 입력 시각은 중지 입력 시각보다 이를 수 없습니다.",
            );
          return save(
            req,
            row,
            {
              status: "resumption_recorded",
              resumption_record: JSON.stringify({
                ...timed(value),
                conditions: value.conditions,
                ...(sole ? { selfProcessed: true, note: SOLE_MANAGER_NOTE } : {}),
              }),
            },
            action,
            sole ? `${SOLE_MANAGER_NOTE} · ${note}` : note,
          );
        }
        if (action === "close-without-stop") {
          expected(row, input.version, ["requested", "acknowledged"]);
          return save(
            req,
            row,
            { status: "closed_without_stop_record" },
            action,
            note,
          );
        }
        expected(row, input.version, [
          "requested",
          "acknowledged",
          "stop_recorded",
          "review_requested",
          "resumption_recorded",
          "closed_without_stop_record",
        ]);
        return save(req, row, {}, "annotation", note);
      },
      authorize,
    );
  });
}
