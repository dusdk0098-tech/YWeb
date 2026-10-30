import { validateReturnEntries, type ReturnSnapshot } from "./ppe-return-ledger.js";
import type { Express, Request } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { date, revision } from "./validation.js";
import { account } from "./inspection-model.js";
import { stockItem, stockState } from "./stock-model.js";
import { stockText, stockUnits } from "./stock-quantity.js";
import { stockWriter } from "./stock-write.js";
import {
  companyPage,
  workerCompany,
  type Company,
  type AffiliatedWorker,
} from "./companies.js";
import { escapeHtml as e } from "./print.js";
export type PpeOriginal = {
  id: string;
  site: { id: string; name: string };
  worker: AffiliatedWorker;
  company: Company | null;
  affiliationVersion: number;
  item: { id: string; name: string; unit: string };
  quantity: string;
  effectiveDate: string;
  trade: string;
  location: string;
  reason: string;
  actor: { id: string; name: string };
  at: string;
  issueMovementId: string;
};
export type PpeRow = {
  id: string;
  site_id: string;
  worker_id: string;
  item_id: string;
  issue_movement_id: string;
  return_movement_id: string | null;
  original: string;
  original_hash: string;
  status: "issued" | "returned";
  version: number;
  return_record: string | null;
  created_at: string;
  updated_at: string;
};
export type PpeRecord = Omit<PpeRow, "original" | "return_record"> & {
  original: PpeOriginal;
  return_record: {
    movementId: string;
    effectiveDate: string;
    reason: string;
    actor: { id: string; name: string };
    at: string;
  } | null;
};
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const reason = z.string().trim().min(1).max(1000);
export const ppeIssueInput = z
  .object({
    confirmIssue: z.literal(true),
    workerId: z.uuid(),
    workerVersion: revision,
    affiliationVersion: z.number().int().nonnegative(),
    companyVersion: revision.nullable(),
    itemId: z.uuid(),
    itemVersion: revision,
    quantity: z.string().max(24),
    effectiveDate: date,
    trade: z.string().trim().max(200),
    location: z.string().trim().min(1).max(300),
    reason,
  })
  .strict();
function getPpe(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM ppe_issues WHERE site_id=? AND id=?")
    .get(site, id) as PpeRow | undefined;
  if (!row)
    throw new HttpError(404, "이 현장의 보호구 원장을 찾을 수 없습니다.");
  return row;
}
export function ppeRecord(row: PpeRow): PpeRecord {
  if (digest(row.original) !== row.original_hash)
    throw new HttpError(409, "지급 원본 hash가 일치하지 않습니다.");
  const original = JSON.parse(row.original) as PpeOriginal;
  if (
    original.id !== row.id ||
    original.site.id !== row.site_id ||
    original.worker.id !== row.worker_id ||
    original.item.id !== row.item_id ||
    original.issueMovementId !== row.issue_movement_id
  )
    throw new HttpError(409, "지급 출처가 일치하지 않습니다.");
  return {
    ...row,
    original,
    return_record: row.return_record ? JSON.parse(row.return_record) : null,
  };
}
export function registerPpe(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/ppe-issues",
    { append } = stockWriter(db);
  function event(req: Request, row: PpeRow, type: string, note: string) {
    const a = account(db, req.session.userId!);
    db.prepare(
      "INSERT INTO ppe_events(issue_id,version,event,actor_id,actor_name,at,reason,snapshot) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      row.id,
      row.version,
      type,
      a.id,
      a.name,
      row.updated_at,
      note,
      JSON.stringify(ppeRecord(row)),
    );
    audit(db, a.id, row.site_id, "ppe." + type, row.id);
  }
  app.get(base, (req, res) => {
    access(req, true, true);
    const q = companyPage
      .extend({
        status: z.enum(["issued", "returned"]).optional(),
        workerId: z.uuid().optional(),
      })
      .parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM ppe_issues WHERE site_id=? AND (? IS NULL OR status=?) AND (? IS NULL OR worker_id=?) ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
      )
      .all(
        String(req.params.siteId),
        q.status || null,
        q.status || null,
        q.workerId || null,
        q.workerId || null,
        q.offset,
      ) as PpeRow[];
    res.json({
      items: rows.slice(0, 50).map(ppeRecord),
      hasMore: rows.length > 50,
    });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const input = ppeIssueInput.parse(req.body),
      v = { ...input, quantity: stockText(stockUnits(input.quantity)) },
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `ppe:issue:${site}`,
      v,
      () => {
        const source = workerCompany(db, site, v.workerId),
          item = stockItem(db, site, v.itemId);
        if (
          source.worker.version !== v.workerVersion ||
          source.version !== v.affiliationVersion ||
          (source.company?.version ?? null) !== v.companyVersion ||
          item.version !== v.itemVersion
        )
          throw new HttpError(
            409,
            "명부/업체 연결/업체/재고 품목이 바뀌었습니다. 선택 자료를 다시 조회하세요.",
          );
        if (!source.worker.active || source.company?.active === 0)
          throw new HttpError(
            409,
            "새 지급은 활성 명부와 연결된 활성 업체에만 가능합니다. 기존 지급의 반납은 비활성 상태에서도 가능합니다.",
          );
        const id = randomUUID(),
          at = new Date().toISOString(),
          actor = account(db, req.session.userId!),
          siteName = String(
            db.prepare("SELECT name FROM sites WHERE id=?").get(site)!.name,
          );
        const result = append(
          req,
          item,
          {
            effectiveDate: v.effectiveDate,
            reason: `PPE 지급 ${id} · ${v.reason}`,
          },
          "issue",
          v.quantity,
          -1,
          null,
        );
        const original: PpeOriginal = {
          id,
          site: { id: site, name: siteName },
          worker: source.worker,
          company: source.company,
          affiliationVersion: source.version,
          item: { id: item.id, name: item.name, unit: item.unit },
          quantity: v.quantity,
          effectiveDate: v.effectiveDate,
          trade: v.trade,
          location: v.location,
          reason: v.reason,
          actor,
          at,
          issueMovementId: result.movement.id,
        };
        const json = JSON.stringify(original);
        db.prepare(
          "INSERT INTO ppe_issues(id,site_id,worker_id,item_id,issue_movement_id,original,original_hash,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'issued',1,?,?)",
        ).run(
          id,
          site,
          v.workerId,
          v.itemId,
          result.movement.id,
          json,
          digest(json),
          at,
          at,
        );
        const row = getPpe(db, site, id);
        event(
          req,
          row,
          "issued",
          "관리자 수기 지급 기록; 수령 서명/신원 확인 아님",
        );
        return ppeRecord(row);
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req, true, true);
    res.json(
      ppeRecord(getPpe(db, String(req.params.siteId), String(req.params.id))),
    );
  });
  app.post(base + "/:id/return", (req, res) => {
    access(req, true, true);
    const v = z
        .object({
          version: revision,
          itemVersion: revision,
          effectiveDate: date,
          reason,
          confirmFullReturn: z.literal(true),
        })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `ppe:return:${site}:${id}`,
      v,
      () => {
        const row = getPpe(db, site, id),
          item = stockItem(db, site, row.item_id),
          source = ppeRecord(row);
        if (
          row.version !== v.version ||
          row.status !== "issued" ||
          item.version !== v.itemVersion
        )
          throw new HttpError(409, "지급/품목 상태 또는 버전이 바뀌었습니다.");
        if(db.prepare("SELECT 1 FROM ppe_return_entries WHERE issue_id=?").get(id)) throw new HttpError(409,"부분 반납 이력이 있습니다. 전용 잔여 반납을 사용하세요.");
        const state = stockState(db, item),
          movement = state.rows.find((m) => m.id === row.issue_movement_id);
        if (
          !movement ||
          movement.kind !== "issue" ||
          movement.quantity !== source.original.quantity ||
          state.reversed.has(movement.id)
        )
          throw new HttpError(
            409,
            "지급 출고 이동이 원본과 일치하지 않습니다.",
          );
        const result = append(
            req,
            item,
            {
              effectiveDate: v.effectiveDate,
              reason: `PPE 전량 반납 ${id} · ${v.reason}`,
            },
            "reversal",
            movement.quantity,
            1,
            movement.id,
          ),
          at = new Date().toISOString(),
          actor = account(db, req.session.userId!);
        const record = {
          movementId: result.movement.id,
          effectiveDate: v.effectiveDate,
          reason: v.reason,
          actor,
          at,
        };
        db.prepare(
          "UPDATE ppe_issues SET return_movement_id=?,return_record=?,status='returned',version=version+1,updated_at=? WHERE id=?",
        ).run(result.movement.id, JSON.stringify(record), at, id);
        const next = getPpe(db, site, id);
        event(
          req,
          next,
          "full_return_recorded",
          "전량 반납 수기 기록; 재고는 원 지급 수량만큼 증가",
        );
        return ppeRecord(next);
      },
      () => {
        access(req, true, true);
        getPpe(db, site, id);
      },
    );
  });
  app.post(base + "/:id/notes", (req, res) => {
    access(req, true, true);
    const v = z
        .object({
          version: revision,
          reason,
          correctionMovementId: z.uuid().nullable(),
        })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `ppe:note:${site}:${id}`,
      v,
      () => {
        const row = getPpe(db, site, id);
        if (row.version !== v.version)
          throw new HttpError(409, "지급 원장 버전이 바뀌었습니다.");
        let note = v.reason;
        if (v.correctionMovementId) {
          const item = stockItem(db, site, row.item_id),
            state = stockState(db, item),
            movement = state.rows.find((m) => m.id === v.correctionMovementId);
          if(db.prepare("SELECT 1 FROM ppe_return_entries WHERE movement_id=?").get(v.correctionMovementId)) throw new HttpError(409,"전용 보호구 반납을 별도 조정 메모로 재연결하지 않습니다.");
          if (
            !movement ||
            !["adjust_in", "adjust_out"].includes(movement.kind) ||
            state.reversed.has(movement.id)
          )
            throw new HttpError(
              400,
              "같은 품목의 현재 유효한 수기 증감 조정 이동만 참조할 수 있습니다.",
            );
          if (
            db
              .prepare("SELECT 1 FROM ppe_correction_links WHERE movement_id=?")
              .get(movement.id)
          )
            throw new HttpError(
              409,
              "이미 다른 정정 메모에 연결한 이동입니다.",
            );
          db.prepare("INSERT INTO ppe_correction_links VALUES(?,?,?)").run(
            movement.id,
            id,
            JSON.stringify(movement),
          );
          note += `\n별도 재고 조정 참조 ${movement.id} (${movement.direction > 0 ? "+" : "-"}${movement.quantity}); 메모 자체는 재고/지급 수량을 변경하지 않음.`;
        }
        db.prepare(
          "UPDATE ppe_issues SET version=version+1,updated_at=? WHERE id=?",
        ).run(new Date().toISOString(), id);
        const next = getPpe(db, site, id);
        event(req, next, "correction_note", note);
        return ppeRecord(next);
      },
      () => {
        access(req, true, true);
        getPpe(db, site, id);
      },
    );
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req, true, true);
    const row = getPpe(db, String(req.params.siteId), String(req.params.id)),
      q = companyPage.parse(req.query),
      events = db
        .prepare(
          "SELECT * FROM ppe_events WHERE issue_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(row.id, q.offset);
    res.json({ items: events.slice(0, 50), hasMore: events.length > 50 });
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req, true, true);
    const row = getPpe(db, String(req.params.siteId), String(req.params.id)),
      record = ppeRecord(row),
      events = db
        .prepare(
          "SELECT * FROM ppe_events WHERE issue_id=? ORDER BY version LIMIT 1001",
        )
        .all(row.id) as {
        version: number;
        event: string;
        actor_name: string;
        actor_id: string;
        at: string;
        reason: string;
      }[];
    if (events.length > 1000)
      throw new HttpError(
        400,
        "이력1000건 초과: 일부를 생략하지 않고 인쇄를 중단합니다.",
      );
    const returnRows=stockState(db,stockItem(db,row.site_id,row.item_id)).returnRows.filter(r=>r.issue_id===row.id);
    const returnEntries=returnRows.map(r=>JSON.parse(r.snapshot) as ReturnSnapshot);
    const returnSummary=validateReturnEntries(record.original.quantity,returnEntries);
    const returnHtml=returnRows.length?`<section><h2>제한된 부분 반납·잔여종결 원본</h2><p>누적 ${e(returnSummary.returnedQuantity)} · 잔여 ${e(returnSummary.remainingQuantity)} · 부분 ${returnSummary.partialCount}/3 · ${returnSummary.terminal?"불변 종결":"미종결"}</p><p>부분 최대3회(취소해도 횟수 유지), 각 전체취소1회, 별도 잔여종결1회. 종결 후 취소 불가. 용량 예약은 실물 사실/날짜/최대 잔량 조건을 대체하지 않습니다.</p>${returnRows.map(r=>`<article><pre>${e(JSON.stringify(JSON.parse(r.snapshot),null,2))}</pre><p>SHA256 ${e(r.snapshot_hash)}</p></article>`).join("")}</section>`:"";
    res
      .type("html")
      .send(
        `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>보호구 수기 지급·전량 반납</title><link rel="stylesheet" href="/print.css"></head><body><aside>수기 기록이며 수령 서명·본인 신원·보호구 적합성 인증이 아닙니다. 부분 반납은 별도3회·예약종결 정책이며 실물/로트 증명이 아닙니다.</aside><main><h1>보호구 지급·전량 반납 원장</h1><p>${e(record.original.site.name)} · ${e(record.id)} · ${e(record.status)} · v${record.version}</p><h2>변경하지 않는 지급 원본</h2><pre>${e(JSON.stringify(record.original, null, 2))}</pre><p>SHA256 ${e(record.original_hash)}</p><h2>전량 반납 기록</h2><pre>${e(record.return_record ? JSON.stringify(record.return_record, null, 2) : "반납 기록 없음")}</pre>${returnHtml}<h2>이력 / 정정 메모</h2>${events.map((x) => `<article><h3>v${x.version} ${e(x.event)}</h3><p>${e(x.actor_name)} (${e(x.actor_id)}) · ${e(x.at)}</p><p>${e(x.reason)}</p></article>`).join("")}<footer>정정 메모만으로 수량이 수정되지 않습니다. 잘못된 종결 반납은 별도 재고 원장의 사실에 근거한 증감 조정과 그 이동ID 참조가 필요하며, 기존 날짜/잔량/건수 제한을 완화하지 않습니다.</footer></main></body></html>`,
      );
  });
}
