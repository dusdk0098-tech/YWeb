import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeetingEditor } from "../src/MeetingEditor.js";
import { MinutesFollowupsPanel } from "../src/MinutesFollowupsPanel.js";
import type { Meeting } from "../src/api.js";
const site={id:"site",name:"Synthetic",role:"manager" as const,version:1},user={id:"user",name:"Synthetic",email:"synthetic@example.test"},noop=()=>{};
test("minutes initial UI distinguishes editable draft and fixed record without certification claims",()=>{
 const html=renderToStaticMarkup(createElement(MeetingEditor,{site,user,initial:null,onClose:noop,onSaved:noop,onDirtyChange:noop,onBusyChange:noop}));assert.match(html,/새 회의록/);assert.match(html,/관리자 확정은 기록 보관/);assert.match(html,/첨부는 미검사 원본 다운로드만 지원하며 전자서명은 지원하지 않습니다/);
});
test("minutes followup initial UI separates old manual completion from independent tracking",()=>{
 const meeting:Meeting={id:"meeting",version:2,status:"finalized",title:"Synthetic <meeting>",type:"안전보건협의체",date:"2026-10-28",time:"09:00",location:"Synthetic",attendees:"Synthetic",agenda:"Synthetic",discussion:"Synthetic",decisions:"Synthetic",actions:[{task:"Synthetic task",owner:"Free text",due:"2026-11-01",status:"완료"}]};
 const html=renderToStaticMarkup(createElement(MinutesFollowupsPanel,{site,user,meeting,onClose:noop,onDirtyChange:noop,onBusyChange:noop}));assert.match(html,/Synthetic &lt;meeting&gt;/);assert.match(html,/고정 후속항목의 추적 시작/);assert.match(html,/원문·인쇄가 바뀌지 않습니다/);
});
