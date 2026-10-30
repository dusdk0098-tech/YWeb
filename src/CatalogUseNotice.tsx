import type {catalogUseStatus} from "../server/education-catalog-use-model";
export type CatalogUseStatus=ReturnType<typeof catalogUseStatus>;
export function CatalogUseNotice({state}:{state:CatalogUseStatus}){
 return <aside aria-label="현재 교육내용 사용 상태"><h3>현재 조회한 사용 상태 · 과거 원문과 별도</h3>
 <p>ID {state.catalogId} · v{state.version} · {state.sourceHash}</p>
 {state.useStopped?<><strong>이 게시본의 신규 일지 생성이 중지되었습니다.</strong><p>사유: {state.stop?.reason}</p><p>기록 계정 {state.stop?.actor.name} · {state.stop?.at}</p></>:<p>현재 신규사용 중지 기록 없음 · 교육내용의 적합성/이수를 보증하지 않습니다.</p>}
 {state.publishedSuccessor&&<p>후속 게시본 있음: {state.publishedSuccessor.id} v{state.publishedSuccessor.version}. 현재 선택본을 자동으로 대체하지 않습니다.</p>}
 <p>사용중지는 이 버전에서 해제할 수 없습니다. 기존 일지·참여·보관 원문은 바뀌지 않습니다. 필요하면 관리자가 개정 초안→별도 게시 후 사람이 새 게시본을 직접 선택합니다. 법적 무효/수료 판정이 아닙니다.</p>
 </aside>;
}
