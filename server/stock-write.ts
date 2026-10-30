import { checkPpeReturnIntent, bindPpeReturn, type PpeReturnIntent } from "./ppe-return-write.js";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { account } from "./inspection-model.js";
import {
  stockItem,
  stockState,
  stockView,
  movementHash,
  type StockItem,
  type StockMovement,
} from "./stock-model.js";
import { stockUnits, stockText, MAX_STOCK } from "./stock-quantity.js";
export function stockWriter(db: Db) {
  function event(
    req: Request,
    row: StockItem,
    kind: string,
    why: string,
    movementId: string | null = null,
  ) {
    const actor = account(db, req.session.userId!),
      view = stockView(db, row);
    db.prepare(
      "INSERT INTO stock_events(item_id,version,event,actor_id,actor_name,at,reason,data) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      row.id,
      row.version,
      kind,
      actor.id,
      actor.name,
      row.updated_at,
      why,
      JSON.stringify({ item: view, movementId }),
    );
    audit(db, actor.id, row.site_id, "stock." + kind, row.id);
    return view;
  }
  function append(
    req: Request,
    row: StockItem,
    v: { effectiveDate: string; reason: string },
    kind: StockMovement["kind"],
    quantity: string,
    direction: 1 | -1,
    reverses: string | null,
    ppeReturn?: PpeReturnIntent,
  ) {
    const state = stockState(db, row);
    if (
      state.rows.length >= 9000 ||
      (!ppeReturn && kind !== "reversal" && state.originalCount >= 1000) ||
      (!ppeReturn && kind === "reversal" && state.reversalCount >= 1000)
    )
      throw new HttpError(
        409,
        "일반 원본1000/전량 역분개1000 또는 전체9000건 한도입니다. PPE 전용 반납은 별도 예약 정책을 따릅니다. 날짜/잔량 제한은 그대로이며 새 일반 원본 이관은 별도 정책이 필요합니다.",
      );
    const returnProposal = ppeReturn ? checkPpeReturnIntent(db,row.id,state.rows,quantity,kind,direction,reverses,ppeReturn) : null;
    // Loopback-only app: the server's local date is the user's date. A future typo would lock every later movement.
    if (v.effectiveDate > new Date().toLocaleDateString("en-CA"))
      throw new HttpError(400, "효력일은 오늘 이후일 수 없습니다.");
    if (v.effectiveDate < state.lastDate)
      throw new HttpError(
        409,
        "효력일은 최근 이동일보다 이전일 수 없습니다. 같은 날은 새 순번으로 추가됩니다.",
      );
    if (kind === "opening" && state.rows.length)
      throw new HttpError(409, "초기 수량은 첫 이동으로만 기록할 수 있습니다.");
    const balance = state.balance + BigInt(direction) * stockUnits(quantity);
    if (balance < 0n)
      throw new HttpError(
        409,
        "잔량이 음수가 되어 저장하지 않았습니다. 오류 원본의 종속 이동을 먼저 역분개하거나 실제 반납 사실을 기록해야 합니다. 허위 입고로 우회하지 마세요.",
      );
    if (balance > MAX_STOCK)
      throw new HttpError(409, "잔량이10^9 한도를 넘습니다.");
    const actor = account(db, req.session.userId!),
      now = new Date().toISOString();
    const movement: Omit<StockMovement, "hash"> = {
      id: randomUUID(),
      item_id: row.id,
      sequence: state.rows.length + 1,
      kind,
      quantity,
      direction,
      effective_date: v.effectiveDate,
      reason: v.reason,
      reverses_id: reverses,
      actor_id: actor.id,
      actor_name: actor.name,
      recorded_at: now,
      item_snapshot: JSON.stringify({
        id: row.id,
        siteId: row.site_id,
        name: row.name,
        unit: row.unit,
      }),
      balance_after: stockText(balance),
    };
    const hash = movementHash(movement);
    db.prepare(
      "INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      movement.id,
      row.id,
      movement.sequence,
      kind,
      quantity,
      direction,
      v.effectiveDate,
      v.reason,
      reverses,
      actor.id,
      actor.name,
      now,
      movement.item_snapshot,
      movement.balance_after,
      hash,
    );
    if(returnProposal) bindPpeReturn(db,returnProposal,{...movement,hash});
    db.prepare(
      "UPDATE stock_items SET version=version+1,updated_at=? WHERE id=?",
    ).run(now, row.id);
    return {
      item: event(
        req,
        stockItem(db, row.site_id, row.id),
        kind,
        v.reason,
        movement.id,
      ),
      movement: {
        ...movement,
        hash,
        item_snapshot: JSON.parse(movement.item_snapshot),
        reversedBy: null,
      },
    };
  }
  return { event, append };
}
