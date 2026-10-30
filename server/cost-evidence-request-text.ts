import { HttpError } from "./site-operations.js";
import { moneyUnits } from "./cost-money.js";
export type EvidenceRequestRow = {
  id: string; version: number; hash: string; spendDate: string; description: string;
  categoryLabel: string; status: "active" | "cancelled"; amount: string;
  reasons: ("no_link" | "changed_link" | "cancelled_link")[];
  links: { fileId: string; fileHash: string; sourceVersion: number; sourceHash: string }[];
};
export type EvidenceRequestView = {
  siteId: string; periodId: string; month: string; periodVersion: number;
  periodStatus: "open" | "closed"; evidenceVersion: number; fingerprint: string;
  rows: EvidenceRequestRow[];
};
const labels = { no_link: "활성 지출에 연결된 원본 없음", changed_link: "원본 연결 뒤 지출 행 변경", cancelled_link: "취소된 지출에 원본 연결 유지" };
export const evidenceRequestNotice = "내부 확인용 초안입니다. 원본 연결 상태만 안내하며 법정 증빙 누락·적격성·실제 거래 여부를 판단하지 않습니다. 파일이나 원장 내용을 변경하거나 외부로 전송하지 않았습니다.";
// Display-only escaping, deliberately not a round-trip interchange format.
export function requestVisibleText(value: string) {
  return value.replace(/[\\"\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, c =>
    c === "\\" ? "\\\\" : c === '"' ? "\\u0022" : "\\u" + c.codePointAt(0)!.toString(16).padStart(4, "0"));
}
export function requestTsvText(value: string) { return "text: " + requestVisibleText(value); }
export function renderEvidenceRequest(view: EvidenceRequestView, selected: EvidenceRequestRow[]) {
  if (!selected.length || selected.length > 50 || new Set(selected.map(r => r.id)).size !== selected.length)
    throw new HttpError(400, "확인할 지출을 중복 없이 1~50개 선택하세요.");
  for (const r of selected) moneyUnits(r.amount);
  const heading = ["내부 원본 연결 상태 확인 요청 초안", evidenceRequestNotice,
    `현장 ID: ${view.siteId} / 월: ${view.month} / 원장 ID: ${view.periodId}`,
    `현재 원장 버전: ${view.periodVersion} (${view.periodStatus}) / 참조 버전: ${view.evidenceVersion}`,
    `선택 기준 지문: ${view.fingerprint}`, "아래 행의 현재 원본 연결 상태를 확인해 주세요. 취소행은 취소 상태를 함께 확인해 주세요."];
  const rows = selected.map(r => ({ r, reasons: r.reasons.map(x => labels[x]).join("; "),
    links: r.links.map(l => `${l.fileId}@${l.fileHash}:v${l.sourceVersion}@${l.sourceHash}`).join("; ") }));
  const text = [...heading, ...rows.map(({ r, reasons, links }) =>
    `- 지출 ${r.id} v${r.version} (${r.status}), ${r.spendDate}, ${requestVisibleText(r.categoryLabel)}, ${requestVisibleText(r.description)}, ${r.amount}원\n  확인 사유: ${reasons}\n  현재 행 해시: ${r.hash}\n  연결 당시 출처: ${links || "없음"}`),
    "수신자·기한은 지정하지 않았습니다. 내용을 사람이 검토한 뒤 필요한 곳에 직접 복사하세요. 생성/복사는 발송·수신·읽음·확인 완료 기록이 아닙니다."].join("\n");
  const header = ["현장 ID", "월", "원장 ID", "원장 버전", "참조 버전", "목록 지문", "지출 ID", "지출 버전", "현재 행 해시", "상태", "지출일", "항목", "설명", "정확 원 금액(텍스트)", "확인 사유", "연결 당시 출처"];
  const tsv = [header.map(requestTsvText).join("\t"), ...rows.map(({ r, reasons, links }) => [
    view.siteId, view.month, view.periodId, String(view.periodVersion), String(view.evidenceVersion), view.fingerprint,
    r.id, String(r.version), r.hash, r.status, r.spendDate, r.categoryLabel, r.description,
    "won: " + r.amount, reasons, links || "없음"].map(requestTsvText).join("\t"))].join("\n");
  assertEvidenceRequestOutputSize(text, tsv);
  return { text, tsv, selectedCount: rows.length, fingerprint: view.fingerprint };
}

export function assertEvidenceRequestOutputSize(text: string, tsv: string) {
  if (Buffer.byteLength(text, "utf8") + Buffer.byteLength(tsv, "utf8") > 256 * 1024)
    throw new HttpError(409, "초안 전체 256KiB 한도를 넘었습니다. 선택 행을 줄이세요. 내용을 잘라내지 않았습니다.");
}
