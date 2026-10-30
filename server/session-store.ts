import { currentSessionEpoch } from "./account-session.js";
import session from "express-session";
import { transaction, type Db } from "./db.js";

/** Small persistence adapter only; session IDs/cookies are managed by express-session. */
export class SqliteSessionStore extends session.Store {
  constructor(private db: Db) {
    super();
  }
  get(
    sid: string,
    callback: (error: unknown, value?: session.SessionData | null) => void,
  ) {
    try {
      const row = this.db
        .prepare("SELECT data,expires FROM sessions WHERE sid=?")
        .get(sid) as { data: string; expires: number } | undefined;
      if (!row || row.expires <= Date.now()) {
        this.db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
        callback(null, null);
      } else {
        const value = JSON.parse(row.data) as session.SessionData;
        if (!currentSessionEpoch(this.db, value)) {
          this.db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
          callback(null, null);
        } else callback(null, value);
      }
    } catch (error) {
      callback(error);
    }
  }
  set(
    sid: string,
    value: session.SessionData,
    callback?: (error?: unknown) => void,
  ) {
    try {
      transaction(this.db, () => {
        if (!currentSessionEpoch(this.db, value)) {
          this.db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
          return;
        }
        this.db
          .prepare("DELETE FROM sessions WHERE expires<=?")
          .run(Date.now());
        this.db
          .prepare(
            "INSERT OR REPLACE INTO sessions(sid,data,expires) VALUES(?,?,?)",
          )
          .run(
            sid,
            JSON.stringify(value),
            new Date(value.cookie.expires!).getTime(),
          );
      });
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
  touch(
    sid: string,
    value: session.SessionData,
    callback?: (error?: unknown) => void,
  ) {
    try {
      if (!currentSessionEpoch(this.db, value))
        this.db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
      // No expiry extension: sessions have an absolute eight-hour lifetime.
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
  destroy(sid: string, callback?: (error?: unknown) => void) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
}
