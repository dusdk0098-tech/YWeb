import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {RiskJsonDownload} from "../src/RiskJsonDownload.js";
test("JSON download initial markup describes source/current summary and exclusions",()=>{
 const html=renderToStaticMarkup(createElement(RiskJsonDownload,{siteId:"site",assessmentId:"doc",fingerprint:"a".repeat(64)}));
 assert.match(html,/export.json\?expectedFingerprint=/);assert.match(html,/별도 현재 문서 상태/);assert.match(html,/계정확인 목록/);assert.match(html,/가져오기는 지원하지 않습니다/);assert.match(html,/일부를 잘라내지 않습니다/);
});
