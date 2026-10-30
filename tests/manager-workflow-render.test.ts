import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManagerOverview } from "../src/ManagerOverview.js";
import { openDatabase } from "../server/db.js";
import { readManagerOverview, overviewQuery } from "../server/manager-overview.js";
import { printManagerOverview } from "../server/manager-overview-print.js";
import { managerWorkflowLines } from "../server/manager-overview-text.js";
test("manager overview SSR makes cost explicitly optional without new roles or automatic filters",()=>{
 const html=renderToStaticMarkup(createElement(ManagerOverview,{sites:[{id:"s",name:"Synthetic",role:"manager",version:1}],onOpen:()=>{}}));
 assert.match(html,/비용 조회 월/);assert.match(html,/선택하지 않으면 비용 조회 없음/);assert.match(html,/비용 월 선택 해제/);assert.match(html,/현재 관리자 권한/);assert.doesNotMatch(html,/PRIVATE|<iframe|<object/);
});
test("overview printable summary escapes site and makes unavailable or unselected costs distinct",()=>{
 const db=openDatabase(":memory:");try {
  db.exec("INSERT INTO users VALUES('u','u@example.test','PRIVATE PERSON','hash');INSERT INTO sites(id,name) VALUES('s','Site <script>');INSERT INTO memberships VALUES('s','u','manager');");
  const noCost=readManagerOverview(db,"u",overviewQuery.parse({asOfDate:"2026-10-28"}));assert.match(managerWorkflowLines(noCost.sites[0]).join("\n"),/비용 월 미선택/);
  db.exec("ALTER TABLE cost_periods RENAME TO synthetic_missing_cost_periods");
  const r=readManagerOverview(db,"u",overviewQuery.parse({asOfDate:"2026-10-28",costMonth:"2026-10"}));
  const html=printManagerOverview(r);assert.match(html,/비용 조회 월 2026-10/);assert.match(html,/비용 조회 불가 — 0원이 아닙니다/);assert.match(html,/Site &lt;script&gt;/);assert.doesNotMatch(html,/PRIVATE PERSON|<script>/);assert.match(html,/현장 간 합산하지 않습니다/);
 }finally{db.close();}
});
