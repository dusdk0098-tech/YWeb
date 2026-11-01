import test from "node:test";
import assert from "node:assert/strict";
import { createElement, isValidElement, type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpPanel } from "../src/HelpPanel.js";
import { helpTopics, helpDestinationAllowed, type HelpDestination } from "../src/help-topics.js";
import type { Site } from "../src/api.js";
import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
const site:Site={id:'synthetic',name:'<합성 현장>',version:1,role:'manager'};
function buttons(node:ReactNode):ReactElement<{onClick:()=>void;disabled:boolean;children:ReactNode}>[]{
 if(Array.isArray(node))return node.flatMap(buttons);
 if(!isValidElement<{children?:ReactNode}>(node))return [];
 return node.type==='button'?[node as ReactElement<{onClick:()=>void;disabled:boolean;children:ReactNode}>]:buttons(node.props.children);
}
test("help has eight bounded topics, explicit limitations and no pretend backup/link execution",()=>{
 assert.equal(helpTopics.length,8);assert.equal(new Set(helpTopics.map(t=>t.id)).size,8);
 const html=renderToStaticMarkup(createElement(HelpPanel,{site,onNavigate:()=>{}}));
 assert.equal((html.match(/<h2>/g)||[]).length,8);assert.match(html,/&lt;합성 현장&gt;/);assert.match(html,new RegExp(`지원 DB 버전: ${CURRENT_SCHEMA_VERSION}`));
 assert.match(html,/npm run backup:local -- --help/);assert.match(html,/실행하지 않음/);assert.match(html,/열람자도 게시 대상자로/);assert.match(html,/독립 보안/);assert.match(html,/미검사 다운로드 전용/);
 assert.doesNotMatch(html,/<a |<form|<iframe|<script|백업 실행|열람자는 읽기만/);
});
test("without selected site only account/site guide and callbacks are exposed",()=>{
 const opened:HelpDestination[]=[];const element=HelpPanel({onNavigate:d=>opened.push(d)});
 const html=renderToStaticMarkup(element);assert.equal((html.match(/<h2>/g)||[]).length,1);assert.match(html,/현장이 선택되지 않았습니다/);assert.doesNotMatch(html,/백업 · 운영자|산업안전보건관리비|TBM 기록/);
 for(const b of buttons(element))b.props.onClick();assert.deepEqual(opened,['sites','account']);
 assert.equal(helpDestinationAllowed('costs'),false);assert.equal(helpDestinationAllowed('daily'),false);
});
test("shortcuts dispatch real typed tabs, manager targets filtered by current site role",()=>{
 for(const role of ['manager','editor','viewer'] as const){
  const opened:HelpDestination[]=[];const element=HelpPanel({site:{...site,role},onNavigate:d=>opened.push(d)});
  for(const b of buttons(element))b.props.onClick();
  assert.equal(opened.includes('costs'),role==='manager');assert.equal(opened.includes('stock'),role==='manager');
  assert.ok(opened.includes('riskcore'));assert.ok(opened.includes('companyppe'));assert.ok(opened.includes('inspections'));
  assert.equal(helpDestinationAllowed('costs',role),role==='manager');assert.equal(helpDestinationAllowed('stock',role),role==='manager');
 }
});
test("help busy state disables every navigation control without changing content",()=>{
 const element=HelpPanel({site,disabled:true,onNavigate:()=>assert.fail('not invoked during render')});
 assert.ok(buttons(element).length>0);assert.ok(buttons(element).every(b=>b.props.disabled));
});
