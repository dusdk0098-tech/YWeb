/** Local file preparation only: no HTTP, database, catalog publication or attendance. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { contentExport, previewEducationContent, EDUCATION_TRANSFER_BYTES } from '../server/education-transfer-model.js';
const sourceSchema = z.object({
 itemNumber:z.literal(91), title:z.string().trim().min(1).max(200), language:z.literal('ko-KR'),
 status:z.literal('research_draft_not_imported'), retrievedAt:z.iso.datetime(), contentFormat:z.literal('markdown'),
 content:z.string().min(1).max(10000), note:z.string().max(2000),
}).strict();
const reviewNotice='[미게시 검토용 초안] 교육91은 기존 사용자 제공 50개 원자료에 포함되지 않은 별도 조사 원고입니다. 현장 적용·최신 기준·사용권을 사람이 검토한 후 별도로 게시하세요. 법정교육시간 인정·이수·의학적 적합성 인증이 아닙니다.\n\n';
const sha=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
export function prepareEducation91Review(sourceText:string, markdown:string) {
 if(Buffer.byteLength(sourceText,'utf8')>EDUCATION_TRANSFER_BYTES || Buffer.byteLength(markdown,'utf8')>EDUCATION_TRANSFER_BYTES)throw new Error('검토 원자료는 각 UTF-8 120KiB 이하이어야 합니다.');
 const source=sourceSchema.parse(JSON.parse(sourceText));
 if(source.content!==markdown)throw new Error('JSON 본문과 Markdown 원고가 다릅니다. 자동 선택/합치기하지 않습니다.');
 const objectiveMatch=/^## 교육목표\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(markdown);
 if(!objectiveMatch?.[1].trim())throw new Error('교육목표 구간을 확인할 수 없습니다. 원고를 검토하세요.');
 const text=contentExport([{title:source.title,categoryLabel:'별도 조사 교육91 · 미게시 검토용',objectives:objectiveMatch[1].trim(),contents:reviewNotice+markdown+'\n\n[검토안 끝 — 별도 게시 전 사람 검토 필요]'}]);
 const preview=previewEducationContent({text});
 return {text,report:{itemNumber:91,status:'review_file_only_not_imported',sourceSha256:sha(sourceText),markdownSha256:sha(markdown),outputSha256:preview.digest,outputBytes:preview.bytes,records:preview.rows.length,retrievedAt:source.retrievedAt,bodyPreserved:true,dbImport:false,published:false,warning:'원고 검토상태는 v1 전용 metadata가 아닌 본문 안내입니다. source hash/조사보고서는 별도 보관하며 권리·현행성 인증이 아닙니다.'}};
}
async function main() {
 const [sourcePath,markdownPath,outputDir,...extra]=process.argv.slice(2);
 if(!sourcePath||!markdownPath||!outputDir||extra.length)throw new Error('사용법: node --import tsx scripts/prepare-education91-review.ts source.json source.md NEW_PRIVATE_OUTPUT_DIR');
 for(const file of [sourcePath,markdownPath])if((await stat(file)).size>EDUCATION_TRANSFER_BYTES)throw new Error('입력 파일이 120KiB를 초과합니다.');
 const decode=(bytes:Uint8Array)=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 const result=prepareEducation91Review(decode(await readFile(sourcePath)),decode(await readFile(markdownPath)));
 // New directory only; never overwrite the research source or a previous result.
 await mkdir(outputDir,{mode:0o700});
 await writeFile(join(outputDir,'education91-review-v1.json'),result.text,{flag:'wx',mode:0o600});
 await writeFile(join(outputDir,'preparation-report.json'),JSON.stringify(result.report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result.report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
