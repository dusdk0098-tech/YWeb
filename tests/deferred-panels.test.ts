import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { createElement } from "react";
import { renderToPipeableStream, renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  deferredPanel,
  loadPanel,
  PanelLoadError,
  PanelLoadFailure,
  PanelLoadBoundary,
} from "../src/DeferredPanel.js";
test("lazy maintenance preserves App state/navigation/dirty/busy functions", () => {
  const before = readFileSync(
      new URL("./fixtures/phase31-main.tsx.txt", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n"),
    after = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8").replace(
      /\r\n/g,
      "\n",
    ),
    printer = ts.createPrinter();
  function bodies(text: string) {
    const file = ts.createSourceFile(
      "main.tsx",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    return file.statements
      .filter((s) => !ts.isImportDeclaration(s))
      .map((s) => printer.printNode(ts.EmitHint.Unspecified, s, file));
  }
  // Normalize checkout line endings before exact fixture substitutions; the
  // complete non-import AST comparison below still preserves the semantic guard.
  // Phase47 adds only the explicit current user and existing shared draft/busy
  // callbacks to MeetingEditor; keep the Phase31 fixture itself historical.
  assert.equal((before.match(/<MeetingEditor\n/g)||[]).length,1);
  let expected=before.replace("<MeetingEditor\n", "<MeetingEditor\n            user={user}\n            onDirtyChange={setAttendanceDirty}\n            onBusyChange={setAttendanceBusy}\n");
  // Phase67 adds one help entry/branch and replaces a stale display-only badge.
  // Preserve all remaining App state, existing callbacks and navigation guards.
  // Y웹 rename changes only the visible brand text.
  expected = expected.replace("<h1>PEDIT</h1>", "<h1>Y웹</h1>").replace("PEDIT<span>", "Y웹<span>");
  expected = expected.replace('LOCAL FOUNDATION · 0.23', '개발용 · 독립 검증 미완료')
    .replace('["home", "현장 홈"],', '["home", "현장 홈"],\n            ["help", "사용 도움말"],')
    .replace('        ) : tab === "home" ? (', `        ) : tab === "help" ? (
          <HelpPanel
            site={site}
            disabled={!!editor || attendanceBusy}
            onNavigate={(next) => {
              if (!helpDestinationAllowed(next, site?.role)) return;
              if (editor || !mayLeaveAttendance()) return;
              setTab(next);
              setError("");
            }}
          />
        ) : tab === "home" ? (`);
  // PC validation adds only the mobile menu state/control and closes it after
  // the existing navigation guard succeeds. Keep the historical fixture and
  // compare the entire remaining App AST, including dirty/busy guards.
  const mobileChanges: Array<[string, string]> = [
    [
      '    [tab, setTab] = useState("home"),',
      '    [tab, setTab] = useState("home"),\n    [mobileMenuOpen, setMobileMenuOpen] = useState(false),',
    ],
    [
      '        <nav aria-label="주 메뉴">',
      `        <button
          type="button"
          className="mobile-menu-toggle secondary"
          aria-expanded={mobileMenuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? "업무 메뉴 닫기" : "업무 메뉴 열기"}
        </button>
        <nav
          id="primary-navigation"
          aria-label="주 메뉴"
          className={mobileMenuOpen ? "mobile-menu-open" : ""}
        >`,
    ],
    [
      '                if (id !== tab && !mayLeaveAttendance()) return;\n                setTab(id);\n                setError("");',
      '                if (id !== tab && !mayLeaveAttendance()) return;\n                setTab(id);\n                setError("");\n                setMobileMenuOpen(false);',
    ],
  ];
  // 사진 보드(N) 1단계 adds one menu entry and panel branch, and drops it from the planned list.
  mobileChanges.push(
    ['            ["daily", "안전업무일지"],', '            ["daily", "안전업무일지"],\n            ["photoboard", "사진 보드"],'],
    ['            "사진대지 N",\n', ''],
    ['        ) : site && tab === "daily" ? (', '        ) : site && tab === "photoboard" ? (\n          <PhotoBoardPanel\n            key={site.id}\n            site={site}\n            onDirtyChange={setAttendanceDirty}\n            onBusyChange={setAttendanceBusy}\n          />\n        ) : site && tab === "daily" ? ('],
  );
  // 오프라인 초안: logout also clears this device's encrypted drafts.
  mobileChanges.push(['      await api("/logout", "POST");\n', '      await api("/logout", "POST");\n      await clearOfflineDrafts();\n']);
  // WEB-01 1단계 adds one menu entry and panel branch.
  mobileChanges.push(
    ['            ["daily", "안전업무일지"],\n            ["photoboard", "사진 보드"],', '            ["daily", "안전업무일지"],\n            ["photoboard", "사진 보드"],\n            ["library", "현장 자료실"],'],
    ['        ) : site && tab === "photoboard" ? (', '        ) : site && tab === "library" ? (\n          <LibraryPanel key={site.id} site={site} />\n        ) : site && tab === "photoboard" ? ('],
  );
  // MOB-01 1단계: the no-login /join page is chosen at the root render only.
  mobileChanges.push(['    <App />\n  </React.StrictMode>', '    {location.pathname === "/join" ? <JoinPage /> : <App />}\n  </React.StrictMode>']);
  // SC-04: AI wording settings menu entry and panel branch.
  mobileChanges.push(
    ['            ["account", "내 비밀번호 변경"],', '            ["account", "내 비밀번호 변경"],\n            ["ai", "AI 문구 설정"],'],
    ['        ) : tab === "account" ? (', '        ) : tab === "ai" ? (\n          <AiSettings />\n        ) : tab === "account" ? ('],
  );
  // Self-hosting settings menu entry and panel branch.
  mobileChanges.push(
    ['            ["ai", "AI 문구 설정"],', '            ["ai", "AI 문구 설정"],\n            ["public", "외부 접속 설정"],'],
    ['          <AiSettings />\n', '          <AiSettings />\n        ) : tab === "public" ? (\n          <PublicAccessSettings />\n'],
  );
  for (const [source, replacement] of mobileChanges) {
    assert.equal(expected.split(source).length, 2);
    expected = expected.replace(source, replacement);
  }
  assert.deepEqual(bodies(after), bodies(expected));
  const registry = readFileSync(
    new URL("../src/DomainPanels.tsx", import.meta.url),
    "utf8",
  );
  assert.equal((registry.match(/export const /g) || []).length, 18);
  assert.equal((registry.match(/\bimport\("\.\//g) || []).length, 36); // 18 type imports +18 dynamic expressions
});
test("panel download retry is explicit, props preserved, and business render errors are not hidden", async () => {
  let calls = 0;
  const Screen = ({ value }: { value: string }) =>
      createElement("p", null, value),
    loader = async () => {
      calls++;
      if (calls === 1) throw new Error("synthetic unavailable chunk");
      return { default: Screen };
    };
  await assert.rejects(loadPanel(loader), PanelLoadError);
  const recovered = await loadPanel(loader);
  assert.equal(calls, 2);
  assert.equal(
    renderToStaticMarkup(
      createElement(recovered.default, { value: "<synthetic>" }),
    ),
    "<p>&lt;synthetic&gt;</p>",
  );
  let retries = 0;
  const fallback = PanelLoadFailure({
    retry: () => {
      retries++;
    },
  });
  const button = fallback.props.children[1];
  button.props.onClick();
  assert.equal(retries, 1);
  const html = renderToStaticMarkup(fallback);
  assert.match(html, /현장\/메뉴 선택은 그대로/);
  assert.match(html, /저장 요청을 다시 보내는 동작이 아닙니다/);
  const boundary = new PanelLoadBoundary({
    retry: () => {},
    children: "loaded",
  });
  assert.equal(boundary.render(), "loaded");
  boundary.state = PanelLoadBoundary.getDerivedStateFromError(
    new PanelLoadError(),
  );
  assert.ok(boundary.render());
  const business = new Error("synthetic business rendering error");
  boundary.state = PanelLoadBoundary.getDerivedStateFromError(business);
  assert.throws(
    () => boundary.render(),
    (e) => e === business,
  );
});
test("deferred panel asynchronous server render forwards typed props without business API calls", async () => {
  const Screen = deferredPanel<{ siteId: string }>(async () => ({
    default: ({ siteId }) => createElement("p", null, "Selected " + siteId),
  }));
  const text = await new Promise<string>((resolve, reject) => {
    let output = "";
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    sink.on("finish", () => resolve(output));
    const stream = renderToPipeableStream(
      createElement(Screen, { siteId: "synthetic-site" }),
      {
        onAllReady() {
          stream.pipe(sink);
        },
        onError: reject,
      },
    );
  });
  assert.match(text, /Selected synthetic-site/);
});
