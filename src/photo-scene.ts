// 사진 보드 scene geometry shared by the editor preview and the PNG output (same drawing for both).
import { CIRCLE_COLORS, cropRect, rotateView, type View } from "../server/photo-view";
export type Circle = { x: number; y: number; r: number; color: "red" | "yellow" | "blue" };
export type SceneItem = { photoId: string; included: boolean; rotation: 0 | 90 | 180 | 270; caption: string; circles: Circle[]; view?: View };
export type Scene = { layoutVersion: 1; items: SceneItem[] };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 1000) / 1000));
// Circles (and the zoom view) are stored in the rotated (displayed) frame; turning the photo 90° clockwise keeps them on the same content.
export function rotateItem(item: SceneItem): SceneItem {
  const turned: SceneItem = { ...item, rotation: ((item.rotation + 90) % 360) as SceneItem["rotation"], circles: item.circles.map((c) => ({ ...c, x: clamp(1 - c.y, 0, 1), y: clamp(c.x, 0, 1) })) };
  if (item.view) turned.view = rotateView(item.view);
  return turned;
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
// Draws one photo (rotated, cropped to its zoom view) fitted inside the box, plus its circles. Returns the drawn rectangle and
// the full rotated photo's placement (ox, oy, fw, fh) so a pointer position maps back to full-frame coordinates.
export function drawItem(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, item: SceneItem, box: { x: number; y: number; w: number; h: number }) {
  const turned = item.rotation % 180 !== 0, iw = turned ? img.height : img.width, ih = turned ? img.width : img.height, crop = cropRect(item.view),
    scale = Math.min(box.w / (iw * crop.w), box.h / (ih * crop.h)), w = iw * crop.w * scale, h = ih * crop.h * scale,
    x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2, fw = iw * scale, fh = ih * scale, ox = x - crop.x * fw, oy = y - crop.y * fh;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.save();
  ctx.translate(ox + fw / 2, oy + fh / 2);
  ctx.rotate((item.rotation * Math.PI) / 180);
  ctx.drawImage(img, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale);
  ctx.restore();
  for (const c of item.circles) {
    ctx.beginPath();
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.012);
    ctx.strokeStyle = CIRCLE_COLORS[c.color];
    ctx.arc(ox + c.x * fw, oy + c.y * fh, c.r * Math.min(fw, fh), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  return { x, y, w, h, ox, oy, fw, fh };
}
// The circle under a full-frame point (topmost first), measured in drawn pixels (fw × fh) the way drawItem draws it.
export function circleAt(item: SceneItem, px: number, py: number, fw: number, fh: number) {
  for (let i = item.circles.length - 1; i >= 0; i--) {
    const c = item.circles[i];
    if (Math.hypot((px - c.x) * fw, (py - c.y) * fh) <= c.r * Math.min(fw, fh)) return i;
  }
  return -1;
}
// 사진 정보표 (원본 N과 같은 방식): tab-separated, every cell quoted and prefixed with ' so spreadsheets never run it as a formula.
export function photoInfoTsv(rows: string[][]) {
  return "﻿" + rows.map((row) => row.map((cell) => `"${cell === "" ? "" : "'" + cell.replace(/"/g, '""')}"`).join("\t")).join("\r\n");
}
