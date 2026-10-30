import { escapeHtml as e } from "./print.js";
import type {
  EquipmentRecord,
  EquipmentUseRecord,
  EquipmentEvent,
} from "./equipment-model.js";
function equipmentBody(r: EquipmentRecord) {
  const b = r.body;
  return `<h2>${e(b.name)} · ${e(b.typeLabel)}</h2><p>장비ID ${e(r.id)} · 코드 ${e(b.assetCode || "없음")} · 모델 ${e(b.model)} · 일련표시 ${e(b.serial)}</p><p>소유업체 표시 ${e(b.ownerCompany)} · ${e(r.status)} v${r.version}</p><p>${e(b.notes)}</p><p>당시 입력: 검사 예정일 ${e(r.dueMetadata?.nextInspectionDate || "미기록")} · 보험 기록상 종료일 ${e(r.dueMetadata?.insuranceRecordedUntil || "미기록")} · 출처 메모 ${e(r.dueMetadata?.sourceNote || "미기록")}. 날짜 메모이며 유효성/합격 판단이 아닙니다.</p>`;
}
function useBody(r: EquipmentUseRecord) {
  return `<p>사용기록 ${e(r.id)} · ${e(r.status)} v${r.version} · 작성계정 ${e(r.owner_id)}</p><p>${e(r.body.date)} · ${e(r.body.location)}</p><p>${e(r.body.workSummary)}</p>${equipmentBody(r.equipment_snapshot)}`;
}
export function printEquipment(
  r: EquipmentRecord | EquipmentUseRecord,
  events: EquipmentEvent[],
  use: boolean,
) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>장비 수기 대장</title><link rel="stylesheet" href="/print.css"></head><body><aside>브라우저 인쇄/PDF</aside><main><h1>${use ? "수기 장비 사용기록" : "장비 등록 대장"}</h1><p>등록/사용 가능한 상태는 이 앱의 기록 분류일 뿐 안전 승인·검사/보험 유효성·장비 적합성 인증이 아닙니다. 공학 계산·첨부 미지원.</p>${use ? useBody(r as EquipmentUseRecord) : equipmentBody(r as EquipmentRecord)}<h2>변경 이력</h2>${events.map((v) => `<article><h3>v${v.version} · ${e(v.event || "사용기록 변경")}</h3><p>${e(v.reason)} · ${e(v.name)} (${e(v.actor_id)}) · ${e(v.at)}</p>${use ? useBody(JSON.parse(v.snapshot) as EquipmentUseRecord) : equipmentBody(JSON.parse(v.snapshot) as EquipmentRecord)}</article>`).join("")}</main></body></html>`;
}
