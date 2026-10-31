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
