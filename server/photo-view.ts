// 사진 보드(N) 2단계: per-photo zoom ("확대") as a viewport over the rotated photo. Pure, no imports: the editor canvas,
// the PNG export and the server print all crop through these functions. Originals and circle coordinates are not changed —
// circles stay in the full rotated-photo frame and the view only decides which part is shown.
export type View = { zoom: number; cx: number; cy: number };
export const MAX_ZOOM = 4;
export const CIRCLE_COLORS = { red: "#e0312b", yellow: "#f2c200", blue: "#1f6fe0" } as const;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// The shown part of the rotated photo, normalized 0..1: 1/zoom of each side (same aspect as the photo), kept inside it.
export function cropRect(view?: View) {
  if (!view || view.zoom <= 1) return { x: 0, y: 0, w: 1, h: 1 };
  const s = 1 / clamp(view.zoom, 1, MAX_ZOOM);
  return { x: r3(clamp(view.cx - s / 2, 0, 1 - s)), y: r3(clamp(view.cy - s / 2, 0, 1 - s)), w: r3(s), h: r3(s) };
}
// Turning the photo 90° clockwise moves the view center with the content (same rule as circles).
export const rotateView = (v: View): View => ({ ...v, cx: r3(1 - v.cy), cy: r3(v.cx) });
// Pan by a fraction of the full photo; the center is clamped so the window stays inside.
export function panView(v: View, dx: number, dy: number): View {
  const half = 1 / clamp(v.zoom, 1, MAX_ZOOM) / 2;
  return { ...v, cx: r3(clamp(v.cx + dx, half, 1 - half)), cy: r3(clamp(v.cy + dy, half, 1 - half)) };
}
export function zoomView(v: View | undefined, zoom: number): View | undefined {
  const z = r3(clamp(zoom, 1, MAX_ZOOM));
  if (z <= 1) return undefined;
  return panView({ zoom: z, cx: v?.cx ?? 0.5, cy: v?.cy ?? 0.5 }, 0, 0);
}
