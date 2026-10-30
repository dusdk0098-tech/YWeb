import { createHash } from "node:crypto";
import { z } from "zod";
import { catalogBody } from "./education-catalog-model.js";
import { HttpError } from "./site-operations.js";
export const EDUCATION_TRANSFER_BYTES=120*1024;
export const educationContentRecord=catalogBody.pick({title:true,categoryLabel:true,objectives:true,contents:true}).strict();
export const educationContentFile=z.object({format:z.literal('pedit-own-education-content'),schemaVersion:z.literal(1),records:z.array(educationContentRecord).min(1).max(20)}).strict();
export type EducationContentFile=z.infer<typeof educationContentFile>;
export const educationPreviewInput=z.object({text:z.string().min(1).max(EDUCATION_TRANSFER_BYTES).refine(text=>Buffer.byteLength(text,'utf8')<=EDUCATION_TRANSFER_BYTES,'JSON 원문은 UTF-8 120KiB 이하입니다.')}).strict();
export const educationImportInput=educationPreviewInput.extend({previewDigest:z.string().regex(/^[a-f0-9]{64}$/),selectedIndexes:z.array(z.number().int().min(0).max(19)).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,'선택 행 중복은 허용하지 않습니다.'),declareRights:z.literal(true)}).strict();
export const educationExportInput=z.object({selections:z.array(z.object({id:z.uuid(),version:z.number().int().positive()}).strict()).min(1).max(20).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'같은 ID를 중복 선택하지 마세요.'),declareRights:z.literal(true)}).strict();
export function previewEducationContent(input:z.infer<typeof educationPreviewInput>) {
  const {text}=educationPreviewInput.parse(input);
  let raw:unknown;try{raw=JSON.parse(text);}catch{throw new HttpError(400,'유효한 JSON 문서가 아닙니다. 일부 행만 가져오지 않았습니다.');}
  const file=educationContentFile.parse(raw),keys=file.records.map(r=>JSON.stringify(r));
  return {schemaVersion:1 as const,digest:createHash('sha256').update(text,'utf8').digest('hex'),bytes:Buffer.byteLength(text,'utf8'),rows:file.records.map((body,index)=>({index,body,duplicateIndexes:keys.flatMap((key,i)=>i!==index&&key===keys[index]?[i]:[])})),warning:'새 미게시 초안만 생성합니다. 권리 선언은 사용자 진술이며 검증이 아닙니다. 제목/내용 중복을 자동 제거하거나 기존 내용을 덮어쓰지 않습니다.'};
}
export function contentExport(records:z.infer<typeof educationContentRecord>[]) {
 const file=educationContentFile.parse({format:'pedit-own-education-content',schemaVersion:1,records}),text=JSON.stringify(file,null,2);
 if(Buffer.byteLength(text,'utf8')>EDUCATION_TRANSFER_BYTES)throw new HttpError(400,'내보내기 JSON이 UTF-8 120KiB를 초과합니다. 더 적은 항목을 명시 선택하세요.');
 return text;
}
