import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyMonthlyRecords } from "../src/DailyMonthlyRecords.js";
import { openDatabase } from "../server/db.js";
import { readMonthlyJournals } from "../server/daily-monthly-report.js";
test("monthly record initial SSR does not pretend unloaded history or current comparison is empty",()=>{
 const db=openDatabase(":memory:");try {
  db.prepare("INSERT INTO sites(id,name) VALUES('s','Synthetic site')").run();
  const report=readMonthlyJournals(db,"s","2026-10");
  const html=renderToStaticMarkup(createElement(DailyMonthlyRecords,{site:{id:"s",name:"Synthetic site",role:"manager",version:1},report,onDirtyChange:()=>{},onBusyChange:()=>{}}));
  assert.match(html,/고정 기록 목록 미조회/);assert.match(html,/월마감·승인·완결된 법정 보고가 아니며/);assert.match(html,/기존 기록은 덮어쓰지 않습니다/);assert.doesNotMatch(html,/iframe|<object|<embed/);
 }finally{db.close();}
});

test("daily panel SSR exposes real search fields and separate monthly entry without fabricated title",async()=>{
 const { DailyJournalPanel }=await import("../src/DailyJournalPanel.js");
 const html=renderToStaticMarkup(createElement(DailyJournalPanel,{site:{id:"s",name:"Synthetic site",role:"viewer",version:1},user:{id:"u",name:"Synthetic reader",email:"u@example.test"},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 assert.match(html,/일지 날짜 시작/);assert.match(html,/일지 날짜 끝/);assert.match(html,/작업 요약·장소·관찰 문자 검색/);assert.match(html,/월간 보관 일지 조회/);assert.match(html,/제목 필드는 없습니다/);assert.doesNotMatch(html,/새 안전업무일지/);
});
