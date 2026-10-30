import { persistedAccountSession } from "./account-session.js";
import type { Request, Response } from "express";
import { z } from "zod";
import { transaction, type Db } from "./db.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function siteOperations(db: Db) {
  function access(req: Request, write = false, manager = false) {
    const row = db
      .prepare("SELECT role FROM memberships WHERE site_id=? AND user_id=?")
      .get(String(req.params.siteId), req.session.userId!) as
      { role: string } | undefined;
    if (
      !row ||
      (write && row.role === "viewer") ||
      (manager && row.role !== "manager")
    )
      throw new HttpError(403, "이 현장에 대한 권한이 없습니다.");
    return row.role;
  }
  function mutate(
    req: Request,
    res: Response,
    scope: string,
    value: unknown,
    action: () => unknown,
    authorizeInTransaction: () => void,
  ) {
    const key = z.uuid().parse(req.get("idempotency-key"));
    const serialized = JSON.stringify(value);
    const result = transaction(db, () => {
      if (
        !req.session.userId ||
        !req.session.authEpoch ||
        !req.session.csrf ||
        !persistedAccountSession(
          db,
          req.sessionID,
          req.session.userId,
          req.session.authEpoch,
          req.session.csrf,
        )
      )
        throw new HttpError(
          401,
          "인증 상태가 변경되었습니다. 다시 로그인하세요.",
        );
      authorizeInTransaction();
      const existing = db
        .prepare(
          "SELECT request,response FROM idempotency WHERE user_id=? AND scope=? AND key=?",
        )
        .get(req.session.userId!, scope, key) as
        { request: string; response: string } | undefined;
      if (existing) {
        if (existing.request !== serialized)
          throw new HttpError(
            409,
            "같은 요청 키로 다른 내용을 저장할 수 없습니다.",
          );
        return JSON.parse(existing.response);
      }
      const output = action();
      db.prepare(
        "INSERT INTO idempotency(user_id,scope,key,request,response) VALUES(?,?,?,?,?)",
      ).run(
        req.session.userId!,
        scope,
        key,
        serialized,
        JSON.stringify(output),
      );
      return output;
    });
    res.json(result);
  }
  return { access, mutate };
}
export type SiteOperations = ReturnType<typeof siteOperations>;
