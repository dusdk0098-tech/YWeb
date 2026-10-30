import type session from "express-session";
import type { Db } from "./db.js";
export const SESSION_LIFETIME = 8 * 60 * 60 * 1000;
export function currentSessionEpoch(db: Db, value: session.SessionData) {
  if (!value.userId) return true;
  if (
    !value.authEpoch ||
    !value.issuedAt ||
    Date.now() - value.issuedAt >= SESSION_LIFETIME
  )
    return false;
  const row = db
    .prepare("SELECT epoch FROM account_auth WHERE user_id=?")
    .get(value.userId) as { epoch: number } | undefined;
  return row?.epoch === value.authEpoch;
}
export function persistedAccountSession(
  db: Db,
  sid: string,
  user: string,
  epoch: number,
  csrf?: string,
) {
  const row = db
    .prepare("SELECT data,expires FROM sessions WHERE sid=?")
    .get(sid) as { data: string; expires: number } | undefined;
  if (!row || row.expires <= Date.now()) return false;
  const value = JSON.parse(row.data) as session.SessionData;
  return (
    value.userId === user &&
    value.authEpoch === epoch &&
    (csrf === undefined || value.csrf === csrf) &&
    currentSessionEpoch(db, value)
  );
}
