export function RiskJsonDownload({siteId,assessmentId,fingerprint}:{siteId:string;assessmentId:string;fingerprint:string}) {
 return <section><h4>고정 제출 원문 JSON 다운로드</h4>
   <p>UTF-8 JSON 형식version1. 고정 제출본·당시 기준·재사용 출처 전체와 별도 현재 문서 상태·기록 개수 요약입니다. 현재 현장 이름은 당시 이름이 아닙니다.</p>
   <p>조치/재평가 세부내용·전체 변경이력·비공개 의견·게시 대상/계정확인 목록·첨부 원본은 제외합니다. 전체 업무 백업·Excel·PDF·서명·안전 허가가 아니며 가져오기는 지원하지 않습니다.</p>
   <a href={`/api/sites/${encodeURIComponent(siteId)}/risk-assessments/${encodeURIComponent(assessmentId)}/export.json?expectedFingerprint=${encodeURIComponent(fingerprint)}`}>준비한 조회의 JSON 다운로드</a>
   <p>조회 정보가 바뀌면409,256KiB 한도 초과 시 전체 중단합니다. 일부를 잘라내지 않습니다. 다운로드한 파일은 원격 갱신/회수되지 않으므로 보관·공유 범위를 확인하세요.</p>
 </section>;
}
