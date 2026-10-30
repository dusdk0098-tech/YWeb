import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {RiskRegister} from "../src/RiskRegister.js";
test("register initial filters label date, literal match and no fictional company filter",()=>{
 const html=renderToStaticMarkup(createElement(RiskRegister,{site:{id:"synthetic",name:"Synthetic",role:"viewer",version:1},onOpen:()=>{}}));
 assert.match(html,/평가 문서 목록/);assert.match(html,/평가일 시작/);assert.match(html,/모든 방법/);assert.match(html,/모든 상태/);assert.match(html,/후속 있는 이전 문서/);assert.match(html,/문자 그대로 부분 일치/);assert.match(html,/업체 필터는 없습니다/);assert.match(html,/조건 적용/);
});
