import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import type { NoticeContent } from "./notice-validation.js";
export type NoticeRow = {
  id: string;
  site_id: string;
  parent_id: string | null;
  body: string;
  status: "draft" | "published" | "withdrawn" | "superseded";
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type NoticeTarget = { user_id: string; name: string };
export type NoticeAck = {
  id: string;
  notice_id: string;
  user_id: string;
  name: string;
  at: string;
  published_version: number;
};
export type NoticeSnapshot = {
  content: NoticeContent;
  targets: NoticeTarget[];
  site: { id: string; name: string };
  publisher: { id: string; name: string };
  publishedAt: string;
  publishedVersion: number;
  parentId: string | null;
};
export type NoticeView = {
  id: string;
  site_id: string;
  status: NoticeRow["status"];
  version: number;
  content: NoticeContent;
  publication: Omit<NoticeSnapshot, "targets" | "parentId"> | null;
  ownAck: NoticeAck | null;
  isTarget: boolean;
  parentId: string | null;
  successorId: string | null;
  targets?: NoticeTarget[];
  acknowledgements?: NoticeAck[];
};
export function noticeRow(db: Db, site: string, id: string) {
  const r = db
    .prepare("SELECT * FROM notices WHERE site_id=? AND id=?")
    .get(site, id) as NoticeRow | undefined;
  if (!r) throw new HttpError(404, "공지를 찾을 수 없습니다.");
  return r;
}
export function noticeReadable(
  db: Db,
  row: NoticeRow,
  userId: string,
  manager: boolean,
) {
  if (
    !manager &&
    (row.status === "draft" ||
      !db
        .prepare("SELECT 1 FROM notice_targets WHERE notice_id=? AND user_id=?")
        .get(row.id, userId))
  )
    throw new HttpError(404, "공지를 찾을 수 없습니다.");
}
export function noticeView(
  db: Db,
  row: NoticeRow,
  userId: string,
  manager: boolean,
): NoticeView {
  noticeReadable(db, row, userId, manager);
  const raw = db
      .prepare("SELECT body FROM notice_snapshots WHERE notice_id=?")
      .get(row.id) as { body: string } | undefined,
    snap = raw ? (JSON.parse(raw.body) as NoticeSnapshot) : null;
  const targets = db
    .prepare(
      "SELECT user_id,name FROM notice_targets WHERE notice_id=? ORDER BY user_id",
    )
    .all(row.id) as NoticeTarget[];
  return {
    id: row.id,
    site_id: row.site_id,
    status: row.status,
    version: row.version,
    content: snap?.content || (JSON.parse(row.body) as NoticeContent),
    publication: snap
      ? {
          content: snap.content,
          site: snap.site,
          publisher: snap.publisher,
          publishedAt: snap.publishedAt,
          publishedVersion: snap.publishedVersion,
        }
      : null,
    ownAck:
      (db
        .prepare(
          "SELECT * FROM notice_acknowledgements WHERE notice_id=? AND user_id=?",
        )
        .get(row.id, userId) as NoticeAck | undefined) || null,
    isTarget: targets.some((t) => t.user_id === userId),
    parentId: manager ? row.parent_id : null,
    successorId: manager
      ? (
          db.prepare("SELECT id FROM notices WHERE parent_id=?").get(row.id) as
            { id: string } | undefined
        )?.id || null
      : null,
    ...(manager
      ? {
          targets,
          acknowledgements: db
            .prepare(
              "SELECT * FROM notice_acknowledgements WHERE notice_id=? ORDER BY at,id",
            )
            .all(row.id) as NoticeAck[],
        }
      : {}),
  };
}
