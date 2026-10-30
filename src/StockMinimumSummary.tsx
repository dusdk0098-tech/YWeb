import { minimumLabels, type MinimumDetail } from "./stock-minimum-types";
export function StockMinimumSummary({ record }: { record: Omit<MinimumDetail, "queriedAt"> }) {
  const s = record.setting?.snapshot;
  return <div>
    <strong>{minimumLabels[record.status]}</strong>
    <p>현재 잔량 {record.balance === null ? "확인 불가" : `${record.balance} ${record.item.unit}`} · 기준 {s?.enabled ? `${s.minimum} ${s.item.unit}` : "비교하지 않음"} · 기준까지 부족량 {record.shortfall === null ? "비교하지 않음" : `${record.shortfall} ${record.item.unit}`}</p>
    {record.unavailableReason && <p role="alert">{record.unavailableReason}</p>}
    <p>품목 v{record.item.version} · 설정 v{record.configVersion} · 마지막 이동 {record.lastMovement?.id || "없음 또는 확인 불가"}</p>
    {s && <p>설정 당시 {s.item.name} ({s.item.unit}) · {s.actor.name} · {s.at} · 사유: {s.reason}</p>}
  </div>;
}
