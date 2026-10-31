import { z } from "zod";
// P-02 장비 계산 (사용자 결정 2026-10-31: 오류 고친 식 · 근거 없는 계수는 기본값+직접 입력 · 경고는 앱 화면에만).
// Pure and dependency-free apart from zod so the editor previews the same numbers the server prints.
// Sources: KOSHA GUIDE C-99-2015 (이동식크레인 양중작업의 안정성 검토 지침) — crawler 방법 1, truck crane 방법 2, work-load ratios;
// 산업안전보건기준에 관한 규칙 제163조 (sling safety factors); tension factor 1/cos(θ/2) is plain statics.
// NOT reviewed by a licensed engineer: every result carries warnings that the editor shows and print omits.
export const CALC_FORMULA_VERSION = "P02-2026.10.1";
export const G = 9.80665;
const pos = (max: number) => z.number().finite().positive().max(max);
const nonneg = (max: number) => z.number().finite().min(0).max(max);
export const OUTRIGGER_EQUIPMENT = ["truck_crane", "aerial_platform", "telehandler", "ladder_truck"] as const;
export const GROUND_EQUIPMENT = [...OUTRIGGER_EQUIPMENT, "crawler_crane", "pile_driver"] as const;
export const EQUIPMENT_LABEL: Record<(typeof GROUND_EQUIPMENT)[number] | "excavator", string> = {
  truck_crane: "트럭(하이드로)크레인", aerial_platform: "고소작업차", telehandler: "붐형지게차", ladder_truck: "사다리차",
  crawler_crane: "크롤러크레인", pile_driver: "항타기", excavator: "굴착기",
};
const ground = z.object({
  equipment: z.enum(GROUND_EQUIPMENT),
  equipmentWeightT: pos(2000), liftLoadT: nonneg(2000), extraLoadT: nonneg(2000),
  impactFactor: pos(5),
  // outrigger types (KOSHA 방법 2): 0.85 × {(W+W1)×1.3} × 0.5 × 1.5, or the manufacturer's maximum outrigger reaction
  frontFactor: pos(1), rotationShare: pos(1), rotationIncrease: pos(3), manufacturerReactionKn: nonneg(100000),
  padLengthM: nonneg(20), padWidthM: nonneg(20),
  // crawler (KOSHA 방법 1): A = one track's contact area = width × (tumbler distance + height × k)
  trackWidthM: nonneg(5), tumblerDistanceM: nonneg(30), trackHeightM: nonneg(5), heightFactor: nonneg(1),
  allowableKpa: pos(100000), allowableNote: z.string().trim().max(200),
}).strict();
const lifting = z.object({
  kind: z.enum(["truck_crane", "crawler_crane", "excavator"]),
  ratedCapacityT: pos(2000), workRatioPercent: pos(100),
}).strict();
export const SLING_TYPES = { wire: "와이어로프 슬링", chain: "체인 슬링", belt: "벨트 슬링", round: "라운드 슬링" } as const;
// 제163조: 화물을 직접 지지하는 달기와이어로프·달기체인 5 이상, 그 밖 4 이상. Fiber slings default to 7 (common manufacturer rating).
export const SLING_MIN_SF = { wire: 5, chain: 5, belt: 4, round: 4 } as const;
export const SLING_DEFAULT_SF = { wire: 5, chain: 5, belt: 7, round: 7 } as const;
export const HITCH = { vertical: ["1자걸이", 1], choker: ["초크걸이", 0.8], basket: ["U자형걸이", 2] } as const;
const sling = z.object({
  type: z.enum(["wire", "chain", "belt", "round"]), breakingLoadT: pos(5000), legs: z.number().int().min(1).max(4),
  hitch: z.enum(["vertical", "choker", "basket"]), modeFactor: pos(2), efficiencyPercent: pos(100),
  safetyFactor: pos(20), includedAngleDeg: nonneg(120),
}).strict().superRefine((s, ctx) => {
  if (s.safetyFactor < SLING_MIN_SF[s.type]) ctx.addIssue({ code: "custom", path: ["safetyFactor"], message: `${SLING_TYPES[s.type]} 안전계수는 ${SLING_MIN_SF[s.type]} 이상이어야 합니다(산업안전보건기준에 관한 규칙 제163조).` });
  if (s.legs === 1 && s.includedAngleDeg !== 0) ctx.addIssue({ code: "custom", path: ["includedAngleDeg"], message: "1줄걸이는 끼인각이 0°입니다." });
});
const shackle = z.object({ wllT: pos(1000), count: z.number().int().min(1).max(8) }).strict();
export const calcBody = z.object({
  loadT: nonneg(2000), hookT: nonneg(200), otherT: nonneg(200),
  ground: ground.nullable(), lifting: lifting.nullable(),
  slings: z.array(sling).max(6), shackles: z.array(shackle).max(6),
}).strict();
export type CalcBody = z.infer<typeof calcBody>;
export type GroundInput = z.infer<typeof ground>;
export const groundDefaults = (equipment: GroundInput["equipment"]): GroundInput => ({
  equipment, equipmentWeightT: 0, liftLoadT: 0, extraLoadT: 0, impactFactor: equipment === "pile_driver" ? 1.4 : 1.3,
  frontFactor: 0.85, rotationShare: 0.5, rotationIncrease: 1.5, manufacturerReactionKn: 0, padLengthM: 0, padWidthM: 0,
  trackWidthM: 0, tumblerDistanceM: 0, trackHeightM: 0, heightFactor: 0.35, allowableKpa: 100, allowableNote: "",
});
export const WORK_RATIO_DEFAULT = { truck_crane: 85, crawler_crane: 75, excavator: 60 } as const;
// 건축물의 구조기준 등에 관한 규칙 별표 8 (장기 허용지내력, 단기는 1.5배) — fallback when no ground survey/plate load test exists.
export const BEARING_TABLE: [string, number][] = [
  ["경암반(화강암·석록암·편마암·안산암 등)", 4000], ["연암반(판암·편암 등 수성암)", 2000], ["연암반(혈암·토단반 등)", 1000],
  ["자갈", 300], ["자갈과 모래의 혼합물", 200], ["모래 섞인 점토 또는 롬토", 150], ["모래 또는 점토", 100],
];
const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
export type Line = { label: string; formula: string; value: number; unit: string };
export type Check = { title: string; lines: Line[]; ok: boolean | null; verdict: string; warnings: string[] };
export function tensionFactor(includedAngleDeg: number) { return 1 / Math.cos((includedAngleDeg / 2) * Math.PI / 180); }
export function evaluateGround(g: GroundInput): Check {
  const label = EQUIPMENT_LABEL[g.equipment], w = (g.equipmentWeightT + g.liftLoadT + g.extraLoadT) * G, warnings: string[] = [];
  const lines: Line[] = [{ label: "W+W1", formula: `(${g.equipmentWeightT}+${g.liftLoadT}+${g.extraLoadT}) t × ${G}`, value: r(w), unit: "kN" }];
  let q: number | null = null;
  if (g.equipment === "crawler_crane") {
    const a = g.trackWidthM * (g.tumblerDistanceM + g.trackHeightM * g.heightFactor);
    lines.push({ label: "A (한쪽 궤도 접지면적)", formula: `${g.trackWidthM} × (${g.tumblerDistanceM} + ${g.trackHeightM} × ${g.heightFactor})`, value: r(a), unit: "㎡" });
    if (a > 0) {
      const q0 = g.impactFactor * w / (2 * a), q1 = g.impactFactor * w / (0.6 * a), q3 = g.impactFactor * w * 0.7 * 2 / (0.9 * a);
      lines.push({ label: "q0 주행", formula: `${g.impactFactor}×(W+W1)/(2×A)`, value: r(q0), unit: "kN/㎡" },
        { label: "q1 붐 직교", formula: `${g.impactFactor}×(W+W1)/(0.6×A)`, value: r(q1), unit: "kN/㎡" },
        { label: "q3 붐 45°", formula: `${g.impactFactor}×(W+W1)×0.7×2/(0.9×A)`, value: r(q3), unit: "kN/㎡" });
      q = Math.max(q0, q1, q3);
    }
    if (g.heightFactor > 0) warnings.push(`궤도 접지길이의 "높이 × ${g.heightFactor}" 항은 원본 엑셀 값이며 KOSHA C-99-2015에 없는 근거 미확인 값입니다. 제작사 접지면적·접지압 자료가 있으면 그 값을 쓰세요.`);
  } else {
    const area = g.padLengthM * g.padWidthM;
    let p: number;
    if (g.equipment === "pile_driver") {
      p = w * g.impactFactor;
      lines.push({ label: "Pmax", formula: `(W+W1) × ${g.impactFactor}`, value: r(p), unit: "kN" });
      warnings.push(`항타기 충격하중계수 ${g.impactFactor}(원본 기본 1.4)는 근거를 찾지 못한 값입니다(원본 시트가 인용한 KOSHA C-99-2015에는 1.3만 있음). 하중 전부를 받침판 1장이 받는다고 가정합니다.`);
    } else if (g.manufacturerReactionKn > 0) {
      p = g.manufacturerReactionKn;
      lines.push({ label: "Pmax (제작사 최대 반력)", formula: "직접 입력", value: r(p), unit: "kN" });
    } else {
      p = g.frontFactor * w * g.impactFactor * g.rotationShare * g.rotationIncrease;
      lines.push({ label: "Pmax", formula: `${g.frontFactor} × {(W+W1) × ${g.impactFactor}} × ${g.rotationShare} × ${g.rotationIncrease}`, value: r(p), unit: "kN" });
      warnings.push("KOSHA C-99-2015 [방법 2] 식입니다. 같은 지침 본문(붐 45° 방향 아웃트리거 1개에 70%, 회전 고려 50% 증가)대로 계산하면 약 1.65배 큽니다. 제작사 최대 아웃트리거 반력이 있으면 그 값을 입력하세요.");
      if (g.equipment !== "truck_crane") warnings.push(`${label}에 이동식크레인 아웃트리거 식을 그대로 쓴 값입니다. 이 장비에 같은 하중배분을 쓸 근거를 찾지 못했습니다.`);
    }
    lines.push({ label: "받침 면적", formula: `${g.padLengthM} × ${g.padWidthM}`, value: r(area), unit: "㎡" });
    if (area > 0) { q = p / area; lines.push({ label: "최대 접지압 q", formula: "Pmax / 받침 면적", value: r(q), unit: "kN/㎡" }); }
  }
  if (g.equipment !== "pile_driver" && g.impactFactor !== 1.3) warnings.push(`충격하중계수를 ${g.impactFactor}로 바꿨습니다(KOSHA 기본 1.3).`);
  lines.push({ label: "허용지내력", formula: g.allowableNote || "직접 입력", value: g.allowableKpa, unit: "kN/㎡" });
  const ok = q === null ? null : q <= g.allowableKpa;
  return { title: `지반 지내력 (${label})`, lines, ok, verdict: ok === null ? "면적을 입력하세요" : ok ? "적합 (q ≤ 허용지내력)" : "부적합 (q > 허용지내력)", warnings };
}
export function evaluateCalc(b: CalcBody): { checks: Check[]; warnings: string[] } {
  const checks: Check[] = [], below = b.loadT + b.otherT, total = below + b.hookT;
  if (b.ground) checks.push(evaluateGround(b.ground));
  if (b.lifting) {
    const l = b.lifting, allowed = l.ratedCapacityT * l.workRatioPercent / 100, ok = total <= allowed, warnings: string[] = [];
    if (l.kind === "excavator") warnings.push(`굴착기 작업하중 비율 ${l.workRatioPercent}%(원본 기본 60%)는 근거를 찾지 못한 값입니다. 제작사 인양능력표를 확인하세요.`);
    else if (l.workRatioPercent > WORK_RATIO_DEFAULT[l.kind]) warnings.push(`KOSHA C-99-2015 기준(${EQUIPMENT_LABEL[l.kind]} 임계하중의 ${WORK_RATIO_DEFAULT[l.kind]}% 이내)보다 높은 비율입니다.`);
    checks.push({ title: `인양 능력 (${EQUIPMENT_LABEL[l.kind]})`, ok, verdict: ok ? "적합 (총하중 ≤ 작업하중)" : "부적합 (총하중 > 작업하중)", warnings, lines: [
      { label: "총하중", formula: `화물 ${b.loadT} + 훅 ${b.hookT} + 기타 ${b.otherT}`, value: r(total), unit: "t" },
      { label: "작업하중", formula: `정격 ${l.ratedCapacityT} × ${l.workRatioPercent}%`, value: r(allowed), unit: "t" },
    ] });
  }
  b.slings.forEach((s, i) => {
    const k = tensionFactor(s.includedAngleDeg), safe = s.breakingLoadT * s.legs * s.modeFactor * (s.efficiencyPercent / 100) / s.safetyFactor / k, ok = below <= safe, warnings: string[] = [];
    if (s.legs >= 3) warnings.push("3~4줄걸이는 하중이 고르게 나뉘지 않을 수 있어 2줄만 유효로 보는 경우가 많습니다. 줄 수를 그대로 곱한 값입니다.");
    if (s.modeFactor !== HITCH[s.hitch][1]) warnings.push(`모드계수를 ${s.modeFactor}로 바꿨습니다(${HITCH[s.hitch][0]} 기본 ${HITCH[s.hitch][1]}).`);
    warnings.push("파단하중·단말이음효율은 제작사 시험성적서 값을 넣어야 합니다(원본의 지름 근사식은 쓰지 않음).");
    checks.push({ title: `줄걸이 ${i + 1} (${SLING_TYPES[s.type]} · ${HITCH[s.hitch][0]} · ${s.legs}줄)`, ok, verdict: ok ? "적합 (달기 하중 ≤ 안전하중)" : "부적합 (달기 하중 > 안전하중)", warnings, lines: [
      { label: "장력계수", formula: `1 / cos(${s.includedAngleDeg}° / 2)`, value: r(k), unit: "" },
      { label: "안전하중", formula: `${s.breakingLoadT} × ${s.legs}줄 × ${s.modeFactor} × ${s.efficiencyPercent}% ÷ ${s.safetyFactor} ÷ ${r(k)}`, value: r(safe), unit: "t" },
      { label: "달기 하중", formula: `화물 ${b.loadT} + 기타 ${b.otherT}`, value: r(below), unit: "t" },
    ] });
  });
  b.shackles.forEach((s, i) => {
    const cap = s.wllT * s.count, ok = below <= cap;
    checks.push({ title: `샤클·달기구 ${i + 1}`, ok, verdict: ok ? "적합 (달기 하중 ≤ 사용하중 합)" : "부적합 (달기 하중 > 사용하중 합)",
      warnings: ["사용하중을 개수만큼 더한 값입니다. 줄걸이 각도로 늘어나는 장력과 하중 분담은 반영하지 않았습니다."], lines: [
        { label: "사용하중 합", formula: `${s.wllT} × ${s.count}개`, value: r(cap), unit: "t" },
        { label: "달기 하중", formula: `화물 ${b.loadT} + 기타 ${b.otherT}`, value: r(below), unit: "t" },
      ] });
  });
  return { checks, warnings: checks.flatMap((c) => c.warnings.map((w) => `${c.title}: ${w}`)) };
}
