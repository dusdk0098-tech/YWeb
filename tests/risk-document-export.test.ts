import test from "node:test";
import assert from "node:assert/strict";
import { riskExportValue,serializeRiskExport } from "../server/risk-document-export.js";
import { RISK_REPORT_MAX_BYTES,type RiskDocumentReport } from "../server/risk-document-report.js";
function report(method:string) {
 return {generatedAt:"2026-10-28T00:00:00.000Z",fingerprint:"f".repeat(64),site:{id:"site",name:"현재 현장"},document:{id:"id",status:"accepted",submissionHash:"h".repeat(64)},submission:{body:{method,title:"한글 <표제> =1+1",hazards:[]},criteria:{body:{method,name:"당시 기준"}}},reuseSource:{sourceId:"original",reason:"생성 당시"},counts:{hazards:0,actions:1,latestResiduals:1,allResidualHistoryRecords:4},actions:[{privateText:"ACTION DETAIL MUST NOT EXPORT"}],residuals:[{basis:"RESIDUAL DETAIL MUST NOT EXPORT"}],opinions:["PRIVATE OPINION"],recipients:["RECIPIENT LIST"]} as unknown as RiskDocumentReport;
}
test("explicit JSON export preserves four fixed methods and separates summary without private or detail arrays",()=>{
 for(const method of ["product","three_level","checklist","narrative"]){
  const r=report(method),before=JSON.stringify(r),value=riskExportValue(r),json=serializeRiskExport(value),parsed=JSON.parse(json);
  assert.equal(parsed.schemaVersion,1);assert.deepEqual(parsed.fixedSource.submission,r.submission);assert.deepEqual(parsed.fixedSource.reuseProvenance,r.reuseSource);
  assert.equal(parsed.currentSummary.counts.allResidualHistoryRecords,4);assert.equal(parsed.currentSummary.site.name,"현재 현장");
  assert.equal(parsed.fixedSource.submission.body.title,"한글 <표제> =1+1");assert.equal(parsed.scope.completeWithinDeclaredScope,true);
  for(const marker of ["ACTION DETAIL MUST NOT EXPORT","RESIDUAL DETAIL MUST NOT EXPORT","PRIVATE OPINION","RECIPIENT LIST"])assert.equal(json.includes(marker),false);
  assert.equal(JSON.stringify(r),before);assert.deepEqual(Object.keys(parsed),["format","schemaVersion","exportedAt","readFingerprint","scope","fixedSource","currentSummary"]);
 }
});
test("UTF8 final JSON bound includes envelope and newline, rejects rather than truncates",()=>{
 const value=riskExportValue(report("product"));value.currentSummary.site.name="";
 const base=Buffer.byteLength(serializeRiskExport(value));value.currentSummary.site.name="a".repeat(RISK_REPORT_MAX_BYTES-base);
 assert.equal(Buffer.byteLength(serializeRiskExport(value)),RISK_REPORT_MAX_BYTES);
 value.currentSummary.site.name+="a";assert.throws(()=>serializeRiskExport(value),/전체 중단/);
 value.currentSummary.site.name=value.currentSummary.site.name.slice(0,-1)+"가";assert.throws(()=>serializeRiskExport(value),/전체 중단/);
});
