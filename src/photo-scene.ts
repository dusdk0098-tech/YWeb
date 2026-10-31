// 사진 보드 scene geometry shared by the editor preview and the PNG output (same drawing for both).
export type Circle = { x: number; y: number; r: number; color: "red" | "yellow" | "blue" };
export type SceneItem = { photoId: string; included: boolean; rotation: 0 | 90 | 180 | 270; caption: string; circles: Circle[] };
export type Scene = { layoutVersion: 1; items: SceneItem[] };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 1000) / 1000));
// Circles are stored in the rotated (displayed) frame; turning the photo 90° clockwise keeps them on the same content.
export function rotateItem(item: SceneItem): SceneItem {
  return { ...item, rotation: ((item.rotation + 90) % 360) as SceneItem["rotation"], circles: item.circles.map((c) => ({ ...c, x: clamp(1 - c.y, 0, 1), y: clamp(c.x, 0, 1) })) };
}
export function moveCircle(c: Circle, dx: number, dy: number): Circle {
  return { ...c, x: clamp(c.x + dx, 0, 1), y: clamp(c.y + dy, 0, 1) };
}
export function resizeCircle(c: Circle, dr: number): Circle {
  return { ...c, r: clamp(c.r + dr, 0.01, 0.5) };
}
export function moveItem(items: SceneItem[], index: number, delta: -1 | 1) {
  const to = index + delta;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
const COLORS = { red: "#e0312b", yellow: "#f2c200", blue: "#1f6fe0" };
// Draws one photo (rotated) fitted inside the box, plus its circles; returns the drawn image rectangle.
export function drawItem(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, item: SceneItem, box: { x: number; y: number; w: number; h: number }) {
  const turned = item.rotation % 180 !== 0, iw = turned ? img.height : img.width, ih = turned ? img.width : img.height,
    scale = Math.min(box.w / iw, box.h / ih), w = iw * scale, h = ih * scale, x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((item.rotation * Math.PI) / 180);
  ctx.drawImage(img, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale);
  ctx.restore();
  for (const c of item.circles) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.012);
    ctx.strokeStyle = COLORS[c.color];
    ctx.arc(x + c.x * w, y + c.y * h, c.r * Math.min(w, h), 0, Math.PI * 2);
    ctx.stroke();
  }
  return { x, y, w, h };
}
