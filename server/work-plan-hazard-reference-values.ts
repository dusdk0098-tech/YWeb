export type HazardReference={formatVersion:1;sourceFileSha256:string;sheet:string;sectionCell:string;row:number;section:string;category:string;hazard:string;control:string;contentHash:string};
export type PlanHazardReferences={schemaVersion:1;rows:{source:HazardReference;applicationNote:string}[]};
export const hazardReferenceKey=(v:HazardReference)=>`${v.sourceFileSha256}:${v.sheet}:${v.row}`;
export const hazardReferenceCanonical=(v:HazardReference)=>JSON.stringify([v.formatVersion,v.sourceFileSha256,v.sheet,v.sectionCell,v.row,v.section,v.category,v.hazard,v.control]);
export function parseHazardReference(v:unknown):HazardReference{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('참고 항목 형식 오류');const x=v as Record<string,unknown>,keys=['formatVersion','sourceFileSha256','sheet','sectionCell','row','section','category','hazard','control','contentHash'];if(Object.keys(x).length!==keys.length||keys.some(k=>!(k in x)))throw Error('참고 항목 필드 오류');
 if(x.formatVersion!==1||!Number.isInteger(x.row)||Number(x.row)<1||Number(x.row)>10000)throw Error('참고 버전/행 오류');
 for(const [k,max] of [['sheet',200],['sectionCell',20],['section',300],['category',100],['hazard',5000],['control',5000]] as const)if(typeof x[k]!=='string'||!(x[k] as string).trim()||(x[k] as string).length>max)throw Error('참고 원문 한도 오류');
 if(!/^[A-Z]+[1-9][0-9]*$/.test(x.sectionCell as string)||!['sourceFileSha256','contentHash'].every(k=>typeof x[k]==='string'&&/^[a-f0-9]{64}$/.test(x[k] as string)))throw Error('참고 출처/해시 오류');return x as HazardReference;
}
export function parseHazardTransfer(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw Error('JSON 객체가 필요합니다.');const v=value as Record<string,unknown>;if(Object.keys(v).sort().join(',')!=='format,records,schemaVersion'||v.format!=='pedit-user-plan-hazard-reference'||v.schemaVersion!==1||!Array.isArray(v.records)||v.records.length<1||v.records.length>20)throw Error('참고 파일은 형식v1/1~20항목만 지원합니다.');const rows=v.records.map(parseHazardReference);if(new Set(rows.map(hazardReferenceKey)).size!==rows.length)throw Error('같은 출처 행 중복');return rows;}
