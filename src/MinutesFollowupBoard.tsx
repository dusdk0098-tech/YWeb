import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { minutesFollowupRecord } from "../server/minutes-model";
type Followup = ReturnType<typeof minutesFollowupRecord>;
const labels = { assigned: "배정·보고 대기", reported: "담당 계정 보고", verified: "다른 관리자 확인 기록" };
// Site-wide follow-up board (handoff: 후속조치를 회의별이 아니라 기한·담당별로 찾기). Read-only; handled in the meeting.
export function MinutesFollowupBoard({ site, onClose }: { site: Site; onClose: () => void }) {
  const [mine, setMine] = useState(false),
    [openOnly, setOpenOnly] = useState(true),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState<{ items: Followup[]; hasMore: boolean }>({ items: [], hasMore: false }),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  // Device-local date: display hint only, not a site work-date decision.
  const d = new Date(),
    today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<typeof page>(
      `/sites/${site.id}/minutes-followups?offset=${offset}${mine ? "&mine=1" : ""}${openOnly ? "&open=1" : ""}`,
    )
      .then((v) => active && setPage(v))
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [site.id, mine, openOnly, offset]);
  return (
    <section>
      <button onClick={onClose}>회의록 목록으로</button>
      <h1>후속조치 보드</h1>
      <p>모든 회의록의 후속조치를 예정일 순으로 봅니다. 보고·확인은 원 회의록의 [후속조치]에서 처리합니다.</p>
      <label>
        <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setOffset(0); }} />
        내 담당만
      </label>
      <label>
        <input type="checkbox" checked={openOnly} onChange={(e) => { setOpenOnly(e.target.checked); setOffset(0); }} />
        확인 기록 끝난 항목 제외
      </label>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>조회 중</p>
      ) : page.items.length ? (
        <table>
          <thead>
            <tr>
              <th>예정일</th>
              <th>후속 항목</th>
              <th>원 회의</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.due}
                  {r.status !== "verified" && (r.due < today ? " · 기한 지남" : r.due === today ? " · 오늘" : "")}
                </td>
                <td>{r.source.action.task}</td>
                <td>{r.source.title}</td>
                <td>{labels[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>해당 후속조치 없음</p>
      )}
      <p>기한 표시는 이 기기의 날짜 기준입니다.</p>
      <button disabled={loading || !offset} onClick={() => setOffset((v) => v - 50)}>이전 50</button>
      <button disabled={loading || !page.hasMore} onClick={() => setOffset((v) => v + 50)}>다음 50</button>
    </section>
  );
}
