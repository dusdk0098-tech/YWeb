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
// One printed photo: an SVG over the display JPEG with rotation, optional zoom window and circles, clipped to the window so a
// wider slot never shows the cropped-out part. `label` must already be HTML-escaped; ids/numbers are generated here.
export type SvgCircle = { x: number; y: number; r: number; color: keyof typeof CIRCLE_COLORS };
export function photoSvg(o: { href: string; width: number; height: number; rotation: number; circles: SvgCircle[]; view?: View; label: string; clipId: string }) {
  const n = (x: number) => Math.round(x * 100) / 100, turned = o.rotation % 180 !== 0, iw = turned ? o.height : o.width, ih = turned ? o.width : o.height, c = cropRect(o.view);
  const circles = o.circles.map((k) => `<circle cx="${n(k.x * iw)}" cy="${n(k.y * ih)}" r="${n(k.r * Math.min(iw, ih))}" fill="none" stroke="${CIRCLE_COLORS[k.color]}" stroke-width="${n(Math.max(2, Math.min(c.w * iw, c.h * ih) * 0.012))}"/>`).join("");
  const box = `x="${n(c.x * iw)}" y="${n(c.y * ih)}" width="${n(c.w * iw)}" height="${n(c.h * ih)}"`;
  return `<svg viewBox="${n(c.x * iw)} ${n(c.y * ih)} ${n(c.w * iw)} ${n(c.h * ih)}" role="img" aria-label="${o.label}"><clipPath id="${o.clipId}"><rect ${box}/></clipPath><g clip-path="url(#${o.clipId})"><image href="${o.href}" x="${n((iw - o.width) / 2)}" y="${n((ih - o.height) / 2)}" width="${o.width}" height="${o.height}" transform="rotate(${o.rotation} ${n(iw / 2)} ${n(ih / 2)})"/>${circles}</g></svg>`;
}
