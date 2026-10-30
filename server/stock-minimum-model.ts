import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
import { stockItem, stockState, type StockItem } from "./stock-model.js";
import { stockText, stockUnits } from "./stock-quantity.js";

const settingSource = z.object({
  id: z.uuid(), siteId: z.uuid(), name: z.string(), unit: z.string(),
  version: z.number().int().positive(),
}).strict();
const snapshotInput = z.object({
  schemaVersion: z.literal(1), id: z.uuid(), version: z.number().int().positive(),
  item: settingSource, enabled: z.boolean(), minimum: z.string().nullable(),
  reason: z.string().min(1).max(1000),
  actor: z.object({ id: z.uuid(), name: z.string() }).strict(), at: z.string(),
}).strict();
export type StockMinimumSnapshot = z.infer<typeof snapshotInput>;
export type StockMinimumRow = { id: string; item_id: string; version: number; snapshot: string; snapshot_hash: string };
export type StockMinimumSetting = { snapshot: StockMinimumSnapshot; hash: string };
export type MinimumStatus = "below" | "equal" | "above" | "disabled" | "unset" | "unavailable";
export function minimumRow(db: Db, itemId: string) {
  return db.prepare("SELECT * FROM stock_minimum_events WHERE item_id=? ORDER BY version DESC LIMIT 1")
    .get(itemId) as StockMinimumRow | undefined;
}
export function readMinimum(row: StockMinimumRow, item: StockItem): StockMinimumSetting {
  const s = snapshotInput.parse(JSON.parse(row.snapshot));
  if (journalHash(s) !== row.snapshot_hash || s.id !== row.id || s.item.id !== row.item_id ||
    s.item.id !== item.id || s.item.siteId !== item.site_id || s.version !== row.version ||
    (s.enabled ? s.minimum === null || stockText(stockUnits(s.minimum, true)) !== s.minimum : s.minimum !== null))
    throw new HttpError(409, "최소재고 설정의 원문·출처가 일치하지 않습니다.");
  return { snapshot: s, hash: row.snapshot_hash };
}
export function validMinimum(row: StockMinimumRow, item: StockItem) {
  try { return readMinimum(row, item); }
  catch (e) {
    if (e instanceof HttpError || e instanceof SyntaxError || e instanceof z.ZodError)
      throw new HttpError(409, "최소재고 설정의 원문·출처를 확인할 수 없습니다.");
    throw e;
  }
}
export function minimumComparison(db: Db, item: StockItem) {
  const row = minimumRow(db, item.id);
  let setting: StockMinimumSetting | null = null;
  const common = { item: { id: item.id, name: item.name, unit: item.unit, version: item.version },
    configVersion: row?.version || 0 };
  try {
    setting = row ? validMinimum(row, item) : null;
    if (setting?.snapshot.enabled && setting.snapshot.item.unit !== item.unit)
      throw new HttpError(409, "설정 당시와 현재 단위가 다릅니다. 현재 단위로 명시 재설정하세요.");
    const state = stockState(db, item), last = state.rows.at(-1);
    const minimum = setting?.snapshot.enabled ? stockUnits(setting.snapshot.minimum!, true) : null;
    const status: MinimumStatus = !setting ? "unset" : !setting.snapshot.enabled ? "disabled" :
      state.balance < minimum! ? "below" : state.balance === minimum! ? "equal" : "above";
    return { ...common, setting, status, balance: stockText(state.balance),
      shortfall: minimum === null ? null : stockText(state.balance < minimum ? minimum - state.balance : 0n),
      movementCount: state.rows.length,
      lastMovement: last ? { id: last.id, sequence: last.sequence, hash: last.hash } : null,
      unavailableReason: null as string | null };
  } catch (e) {
    if (!(e instanceof HttpError || e instanceof SyntaxError || e instanceof z.ZodError)) throw e;
    return { ...common, setting, status: "unavailable" as MinimumStatus, balance: null, shortfall: null,
      movementCount: null, lastMovement: null,
      unavailableReason: "설정 또는 이동 이력·단위를 확인할 수 없어 비교하지 않았습니다. 0 또는 부족 없음이 아닙니다." };
  }
}
export function minimumDetail(db: Db, site: string, id: string) {
  return { ...minimumComparison(db, stockItem(db, site, id)), queriedAt: new Date().toISOString() };
}
export function minimumPage(db: Db, site: string, offset: number) {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM stock_items i WHERE i.site_id=?
    AND EXISTS(SELECT 1 FROM stock_minimum_events e WHERE e.item_id=i.id)`).get(site) as { n: number }).n;
  const rows = db.prepare(`SELECT i.* FROM stock_items i WHERE i.site_id=?
    AND EXISTS(SELECT 1 FROM stock_minimum_events e WHERE e.item_id=i.id)
    ORDER BY i.name,i.id LIMIT 10 OFFSET ?`).all(site, offset) as StockItem[];
  const items = rows.map(item => minimumComparison(db, item));
  const pageCounts: Record<MinimumStatus, number> = { below: 0, equal: 0, above: 0, disabled: 0, unset: 0, unavailable: 0 };
  for (const item of items) pageCounts[item.status]++;
  return { items, offset, pageSize: 10, totalConfiguredItems: total, pageCounts,
    hasMore: total > offset + 10, queriedAt: new Date().toISOString() };
}
