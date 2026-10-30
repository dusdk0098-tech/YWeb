import { ppeReturnQuota, MAX_STOCK_MOVEMENTS_WITH_PPE } from "./ppe-return-ledger.js";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
import { stockUnits, stockText, MAX_STOCK } from "./stock-quantity.js";
export type StockItem = {
  id: string;
  site_id: string;
  name: string;
  unit: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type StockMovement = {
  id: string;
  item_id: string;
  sequence: number;
  kind:
    "opening" | "receipt" | "issue" | "adjust_in" | "adjust_out" | "reversal";
  quantity: string;
  direction: 1 | -1;
  effective_date: string;
  reason: string;
  reverses_id: string | null;
  actor_id: string;
  actor_name: string;
  recorded_at: string;
  item_snapshot: string;
  balance_after: string;
  hash: string;
};
export function stockItem(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM stock_items WHERE site_id=? AND id=?")
    .get(site, id) as StockItem | undefined;
  if (!row) throw new HttpError(404, "재고 품목을 찾을 수 없습니다.");
  return row;
}
export function movementHash(row: Omit<StockMovement, "hash">) {
  return journalHash(row);
}
export function stockState(db: Db, item: StockItem) {
  const rows = db
    .prepare(
      "SELECT * FROM stock_movements WHERE item_id=? ORDER BY sequence LIMIT 9001",
    )
    .all(item.id) as StockMovement[];
  if (rows.length > MAX_STOCK_MOVEMENTS_WITH_PPE)
    throw new HttpError(
      400,
      "품목별 보존 이동9000건을 넘어 조회를 중단합니다.",
    );
  let balance = 0n,
    lastDate = "";
  const known = new Map<string, StockMovement>(),
    reversed = new Set<string>();
  for (const row of rows) {
    const { hash, ...body } = row;
    const snapshot = JSON.parse(row.item_snapshot) as {
      id: string;
      siteId: string;
      unit: string;
    };
    if (
      movementHash(body) !== hash ||
      row.sequence !== known.size + 1 ||
      row.effective_date < lastDate ||
      snapshot.id !== item.id ||
      snapshot.siteId !== item.site_id ||
      snapshot.unit !== item.unit
    )
      throw new HttpError(409, "이동 이력 해시/순서/출처가 일치하지 않습니다.");
    const n = stockUnits(row.quantity);
    if (row.kind === "reversal") {
      const target = known.get(row.reverses_id || "");
      if (
        !target ||
        target.kind === "reversal" ||
        reversed.has(target.id) ||
        target.quantity !== row.quantity ||
        target.direction !== -row.direction
      )
        throw new HttpError(409, "역분개 출처가 일치하지 않습니다.");
      reversed.add(target.id);
    } else if (
      row.reverses_id ||
      row.direction !== (["issue", "adjust_out"].includes(row.kind) ? -1 : 1) ||
      (row.kind === "opening" && row.sequence !== 1)
    )
      throw new HttpError(409, "이동 유형이 일치하지 않습니다.");
    balance += BigInt(row.direction) * n;
    if (
      balance < 0n ||
      balance > MAX_STOCK ||
      stockText(balance) !== row.balance_after
    )
      throw new HttpError(
        409,
        "이동 누계가 허용 범위/기록과 일치하지 않습니다.",
      );
    known.set(row.id, row);
    lastDate = row.effective_date;
  }
  const quota = ppeReturnQuota(db,item.id,rows);
  return { rows, balance, lastDate, reversed, ...quota };

}
export function stockView(db: Db, item: StockItem) {
  const state = stockState(db, item);
  return {
    ...item,
    balance: stockText(state.balance),
    movementCount: state.rows.length,
    originalCount: state.originalCount,
    reversalCount: state.reversalCount,
    ...(state.ppeReturnMovementCount ? { ppeReturnMovementCount: state.ppeReturnMovementCount } : {}),
    lastEffectiveDate: state.lastDate || null,
  };
}
