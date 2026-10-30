import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  noticeInput,
  noticeVersion,
  noticeReason,
  noticePage,
  type NoticeContent,
} from "./notice-validation.js";
import {
  noticeRow,
  noticeView,
  noticeReadable,
  type NoticeRow,
  type NoticeSnapshot,
  type NoticeTarget,
  type NoticeAck,
} from "./notice-model.js";
import { printNotice } from "./notice-print.js";
export function registerNoticeRoutes(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/notices";
  function expected(site: string, id: string, version: number, status: string) {
    const row = noticeRow(db, site, id);
    if (row.version !== version || row.status !== status)
      throw new HttpError(
        409,
        "공지 버전/상태가 바뀌었습니다. 최신본을 다시 여세요.",
      );
    return row;
  }
  function actor(req: Request) {
    return db
      .prepare("SELECT id,name FROM users WHERE id=?")
      .get(req.session.userId!) as { id: string; name: string };
  }
  function event(req: Request, id: string, kind: string, reason = "") {
    const row = noticeRow(db, String(req.params.siteId), id),
      who = actor(req);
    db.prepare(
      "INSERT INTO notice_events(notice_id,version,event,actor_id,name,at,reason) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      row.version,
      kind,
      who.id,
      who.name,
      new Date().toISOString(),
      reason,
    );
    audit(db, who.id, row.site_id, "notice." + kind, id);
  }
  function targets(site: string, ids: string[]) {
    return ids
      .map((id) => {
        const u = db
          .prepare(
            "SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? AND m.user_id=?",
          )
          .get(site, id) as { id: string; name: string } | undefined;
        if (!u)
          throw new HttpError(
            400,
            "수신 계정은 모두 현재 같은 현장 구성원이어야 합니다.",
          );
        return { user_id: u.id, name: u.name };
      })
      .sort((a, b) => a.user_id.localeCompare(b.user_id));
  }
  function storeTargets(id: string, recipients: NoticeTarget[]) {
    db.prepare("DELETE FROM notice_targets WHERE notice_id=?").run(id);
    for (const r of recipients)
      db.prepare("INSERT INTO notice_targets VALUES(?,?,?)").run(
        id,
        r.user_id,
        r.name,
      );
  }
  function insert(
    req: Request,
    site: string,
    content: NoticeContent,
    recipients: NoticeTarget[],
    parent: string | null,
    reason = "",
  ) {
    const id = randomUUID(),
      now = new Date().toISOString();
    db.prepare("INSERT INTO notices VALUES(?,?,?,?,'draft',1,?,?,?)").run(
      id,
      site,
      parent,
      JSON.stringify(content),
      req.session.userId!,
      now,
      now,
    );
    storeTargets(id, recipients);
    event(
      req,
      id,
      "created",
      (parent ? "이전 공지 " + parent + "; " : "") + reason,
    );
    return id;
  }
  app.get(base + "/recipients", (req, res) => {
    access(req, true, true);
    const { offset } = noticePage.parse(req.query),
      rows = db
        .prepare(
          "SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? ORDER BY u.name,u.id LIMIT 51 OFFSET ?",
        )
        .all(String(req.params.siteId), offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.get(base, (req, res) => {
    const manager = access(req) === "manager",
      { offset } = noticePage.parse(req.query),
      rows = db
        .prepare(
          "SELECT n.* FROM notices n WHERE site_id=? AND (?=1 OR (status!='draft' AND EXISTS(SELECT 1 FROM notice_targets t WHERE t.notice_id=n.id AND t.user_id=?))) ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
        )
        .all(
          String(req.params.siteId),
          Number(manager),
          req.session.userId!,
          offset,
        ) as NoticeRow[];
    res.json({
      items: rows
        .slice(0, 50)
        .map((r) => noticeView(db, r, req.session.userId!, manager)),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/:id", (req, res) => {
    const manager = access(req) === "manager";
    res.json(
      noticeView(
        db,
        noticeRow(db, String(req.params.siteId), String(req.params.id)),
        req.session.userId!,
        manager,
      ),
    );
  });
  app.get(base + "/:id/print", (req, res) => {
    const manager = access(req) === "manager",
      r = noticeView(
        db,
        noticeRow(db, String(req.params.siteId), String(req.params.id)),
        req.session.userId!,
        manager,
      );
    res.type("html").send(printNotice(r, manager));
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req, true, true);
    const row = noticeRow(db, String(req.params.siteId), String(req.params.id)),
      { offset } = noticePage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM notice_events WHERE notice_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(row.id, offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = noticeInput.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `notice:create:${site}`,
      v,
      () =>
        noticeView(
          db,
          noticeRow(
            db,
            site,
            insert(req, site, v.content, targets(site, v.recipientIds), null),
          ),
          req.session.userId!,
          true,
        ),
      () => {
        access(req, true, true);
      },
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true, true);
    const v = noticeInput
        .extend({ version: noticeVersion.shape.version })
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `notice:edit:${site}:${id}`,
      v,
      () => {
        expected(site, id, v.version, "draft");
        storeTargets(id, targets(site, v.recipientIds));
        db.prepare(
          "UPDATE notices SET body=?,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(v.content), new Date().toISOString(), id);
        event(req, id, "updated");
        return noticeView(
          db,
          noticeRow(db, site, id),
          req.session.userId!,
          true,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/publish", (req, res) => {
    access(req, true, true);
    const v = noticeVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `notice:publish:${site}:${id}`,
      v,
      () => {
        const row = expected(site, id, v.version, "draft"),
          content = JSON.parse(row.body) as NoticeContent;
        if (!content.text || !content.workScope)
          throw new HttpError(
            400,
            "게시에는 공지 본문과 적용 작업/범위가 필요합니다.",
          );
        const recipients = targets(
          site,
          (
            db
              .prepare("SELECT user_id FROM notice_targets WHERE notice_id=?")
              .all(id) as { user_id: string }[]
          ).map((r) => r.user_id),
        );
        if (!recipients.length)
          throw new HttpError(400, "수신 계정을 선택하세요.");
        storeTargets(id, recipients);
        const now = new Date().toISOString();
        if (row.parent_id) {
          const parent = noticeRow(db, site, row.parent_id);
          if (!["published", "withdrawn"].includes(parent.status))
            throw new HttpError(
              409,
              "이전 공지 상태가 변경되어 게시할 수 없습니다.",
            );
          if (parent.status === "published") {
            db.prepare(
              "UPDATE notices SET status='superseded',version=version+1,updated_at=? WHERE id=?",
            ).run(now, parent.id);
            event(req, parent.id, "superseded", "후속 공지 " + id);
          }
        }
        const snapshot: NoticeSnapshot = {
          content,
          targets: recipients,
          site: {
            id: site,
            name: (
              db.prepare("SELECT name FROM sites WHERE id=?").get(site) as {
                name: string;
              }
            ).name,
          },
          publisher: actor(req),
          publishedAt: now,
          publishedVersion: row.version + 1,
          parentId: row.parent_id,
        };
        db.prepare("INSERT INTO notice_snapshots VALUES(?,?)").run(
          id,
          JSON.stringify(snapshot),
        );
        db.prepare(
          "UPDATE notices SET status='published',version=version+1,updated_at=? WHERE id=?",
        ).run(now, id);
        event(req, id, "published");
        return noticeView(
          db,
          noticeRow(db, site, id),
          req.session.userId!,
          true,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/withdraw", (req, res) => {
    access(req, true, true);
    const v = noticeReason.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `notice:withdraw:${site}:${id}`,
      v,
      () => {
        expected(site, id, v.version, "published");
        db.prepare(
          "UPDATE notices SET status='withdrawn',version=version+1,updated_at=? WHERE id=?",
        ).run(new Date().toISOString(), id);
        event(req, id, "withdrawn", v.reason);
        return noticeView(
          db,
          noticeRow(db, site, id),
          req.session.userId!,
          true,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const v = noticeReason.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `notice:revise:${site}:${id}`,
      v,
      () => {
        const row = noticeRow(db, site, id);
        if (
          row.version !== v.version ||
          !["published", "withdrawn"].includes(row.status)
        )
          throw new HttpError(
            409,
            "최신 게시/철회본에서만 후속 초안을 만들 수 있습니다.",
          );
        if (db.prepare("SELECT id FROM notices WHERE parent_id=?").get(id))
          throw new HttpError(
            409,
            "이미 후속 초안/게시본이 있습니다. 기존 후속을 여세요.",
          );
        const old = db
          .prepare(
            "SELECT user_id,name FROM notice_targets WHERE notice_id=? ORDER BY user_id",
          )
          .all(id) as NoticeTarget[];
        const next = insert(
          req,
          site,
          JSON.parse(row.body) as NoticeContent,
          old,
          id,
          v.reason,
        );
        audit(db, req.session.userId!, site, "notice.revision.created", next);
        return noticeView(
          db,
          noticeRow(db, site, next),
          req.session.userId!,
          true,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/acknowledge", (req, res) => {
    access(req);
    const v = noticeVersion.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    function eligible() {
      const row = noticeRow(db, site, id);
      noticeReadable(db, row, req.session.userId!, false);
      return expected(site, id, v.version, "published");
    }
    eligible();
    mutate(
      req,
      res,
      `notice:ack:${site}:${id}`,
      v,
      () => {
        const row = eligible(),
          old = db
            .prepare(
              "SELECT * FROM notice_acknowledgements WHERE notice_id=? AND user_id=?",
            )
            .get(id, req.session.userId!) as NoticeAck | undefined;
        if (!old) {
          const who = actor(req);
          db.prepare(
            "INSERT INTO notice_acknowledgements VALUES(?,?,?,?,?,?)",
          ).run(
            randomUUID(),
            id,
            who.id,
            who.name,
            new Date().toISOString(),
            row.version,
          );
          audit(db, who.id, site, "notice.account_acknowledged", id);
        }
        return noticeView(db, row, req.session.userId!, false);
      },
      () => {
        access(req);
        eligible();
      },
    );
  });
}
