import { imageSize, PHOTO_DISPLAY_MAX_BYTES, PHOTO_DISPLAY_MAX_SIDE, PHOTO_ORIGINAL_MAX_PIXELS } from "../server/image-size";
// 사진대지 정책안 A: decode in this browser, apply EXIF orientation, re-encode as JPEG (drops EXIF/GPS).
export async function makePhotoDisplay(original: Blob): Promise<Blob> {
  const size = imageSize(new Uint8Array(await original.slice(0, 512 * 1024).arrayBuffer()));
  if (!size || !size.width || !size.height) throw new Error("사진 크기를 읽을 수 없습니다. 손상되었거나 지원하지 않는 사진입니다. 원본은 그대로 보존됩니다.");
  if (size.width * size.height > PHOTO_ORIGINAL_MAX_PIXELS) throw new Error("너무 큰 사진(5천만 화소 초과)이라 표시본을 만들지 않습니다. 원본은 그대로 보존됩니다.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(original, { imageOrientation: "from-image" }); }
  catch { throw new Error("사진을 열 수 없습니다(손상 또는 미지원). 원본은 그대로 보존됩니다."); }
  const scale = Math.min(1, PHOTO_DISPLAY_MAX_SIDE / Math.max(bitmap.width, bitmap.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // PNG transparency prints as white
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", quality));
    if (blob && blob.size <= PHOTO_DISPLAY_MAX_BYTES) return blob;
  }
  throw new Error("표시본을 1MB 이하로 줄이지 못했습니다. 원본은 그대로 보존됩니다.");
}
// EXIF DateTimeOriginal (or IFD0 DateTime) as YYYY-MM-DD, only to prefill 촬영일; never GPS. Null when absent/invalid.
export function exifTakenDate(bytes: Uint8Array): string | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1], len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(i + 4, i + 10)) === "Exif\0\0") return tiffDate(bytes.subarray(i + 10, i + 2 + len));
    i += 2 + len;
  }
  return null;
}
function tiffDate(t: Uint8Array): string | null {
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]),
    u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 2 ** 24 : t[o] * 2 ** 24 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]));
  const entries = (ifd: number) => {
    if (ifd + 2 > t.length) return [];
    return Array.from({ length: u16(ifd) }, (_, n) => ifd + 2 + n * 12).filter((o) => o + 12 <= t.length).map((o) => ({ tag: u16(o), value: u32(o + 8), count: u32(o + 4) }));
  };
  const text = (e: { value: number; count: number }) => String.fromCharCode(...t.subarray(e.value, e.value + Math.min(e.count, 20)));
  const ifd0 = entries(u32(4)), exif = ifd0.find((e) => e.tag === 0x8769),
    found = (exif ? entries(exif.value).find((e) => e.tag === 0x9003) : undefined) ?? ifd0.find((e) => e.tag === 0x0132);
  const m = found && /^(\d{4}):(\d{2}):(\d{2})/.exec(text(found));
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`, d = new Date(date + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().startsWith(date) ? date : null;
}
