import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { decimalText, quantityUnits, unitPrice, lineAmount } from "./cost-money.js";
import { journalHash } from "./daily-journal-sources.js";
import type { CostExpense } from "./cost-model.js";
export const presetDefaults=z.object({description:z.string().trim().min(1).max(500),quantity:z.string().min(1).max(32),unitPriceWon:z.string().min(1).max(32)}).strict();
export const presetValues=z.object({name:z.string().trim().min(1).max(100),defaults:presetDefaults}).strict();
export const presetReference=z.object({id:z.uuid(),version:z.number().int().min(1).max(1001),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const presetChange=presetValues.extend({source:presetReference,reason:z.string().trim().min(1).max(1000)}).strict();
export const presetRetire=z.object({source:presetReference,reason:z.string().trim().min(1).max(1000),confirm:z.literal(true)}).strict();
export function normalizePresetDefaults(value:z.infer<typeof presetDefaults>){const v=presetDefaults.parse(value),quantity=decimalText(quantityUnits(v.quantity)),unitPriceWon=unitPrice(v.unitPriceWon).toString();lineAmount(quantity,unitPriceWon);return {description:v.description,quantity,unitPriceWon};}
export type PresetBody={schema:1;id:string;rootId:string;parentId:string|null;parentHash:string|null;version:number;status:"active"|"retired";name:string;defaults:ReturnType<typeof normalizePresetDefaults>;reason:string;actor:{id:string;name:string};at:string};
export function readCostPreset(db:Db,site:string,id:string){
 const row=db.prepare("SELECT * FROM cost_input_presets WHERE site_id=? AND id=?").get(site,id) as {id:string;root_id:string;parent_id:string|null;version:number;status:string;body:string;hash:string;created_at:string}|undefined;
 if(!row)throw new HttpError(404,"비용 입력 프리셋을 찾을 수 없습니다.");
 const body=JSON.parse(row.body) as PresetBody;
 if(body.schema!==1||body.id!==row.id||body.rootId!==row.root_id||body.parentId!==row.parent_id||body.version!==row.version||body.status!==row.status||body.at!==row.created_at||journalHash(body)!==row.hash||JSON.stringify(normalizePresetDefaults(body.defaults))!==JSON.stringify(body.defaults))throw new HttpError(409,"프리셋 원문/해시가 일치하지 않습니다.");
 if(body.parentId){const parent=db.prepare("SELECT hash FROM cost_input_presets WHERE id=? AND site_id=? AND root_id=? AND version=?").get(body.parentId,site,body.rootId,body.version-1) as {hash:string}|undefined;if(!parent||parent.hash!==body.parentHash)throw new HttpError(409,"프리셋 이전 버전 연결이 일치하지 않습니다.");}else if(body.rootId!==body.id||body.version!==1||body.parentHash!==null)throw new HttpError(409,"최초 프리셋 연결이 일치하지 않습니다.");
 const successor=db.prepare("SELECT id FROM cost_input_presets WHERE parent_id=? AND site_id=?").get(id,site) as {id:string}|undefined;
 return {body,hash:row.hash,successorId:successor?.id||null,current:!successor};
}
export function exactActivePreset(db:Db,site:string,ref:z.infer<typeof presetReference>){const record=readCostPreset(db,site,ref.id);if(record.body.version!==ref.version||record.hash!==ref.hash||!record.current||record.body.status!=="active")throw new HttpError(409,"선택 프리셋이 개정되거나 사용 중지되었습니다. 미저장 입력은 유지하고 프리셋을 다시 선택·검토하세요.");return record;}
export type PresetSource={schema:1;expenseId:string;periodId:string;siteId:string;preset:{id:string;rootId:string;version:number;hash:string;name:string;defaults:PresetBody["defaults"]};appliedAtCreation:PresetBody["defaults"];editedAtCreation:boolean;at:string};
export function saveExpensePresetSource(db:Db,site:string,expense:CostExpense,record:ReturnType<typeof exactActivePreset>,at:string){
 const appliedAtCreation={description:expense.description,quantity:expense.quantity,unitPriceWon:expense.unit_price_won};
 const body:PresetSource={schema:1,expenseId:expense.id,periodId:expense.period_id,siteId:site,preset:{id:record.body.id,rootId:record.body.rootId,version:record.body.version,hash:record.hash,name:record.body.name,defaults:record.body.defaults},appliedAtCreation,editedAtCreation:JSON.stringify(appliedAtCreation)!==JSON.stringify(record.body.defaults),at};
 db.prepare("INSERT INTO cost_expense_preset_sources VALUES(?,?,?,?,?,?)").run(expense.id,site,expense.period_id,record.body.id,JSON.stringify(body),journalHash(body));return {body,hash:journalHash(body)};
}
export function readExpensePresetSource(db:Db,site:string,period:string,expense:string){const row=db.prepare("SELECT preset_id,body,hash FROM cost_expense_preset_sources WHERE expense_id=? AND site_id=? AND period_id=?").get(expense,site,period) as {preset_id:string;body:string;hash:string}|undefined;if(!row)return null;const body=JSON.parse(row.body) as PresetSource,original=readCostPreset(db,site,row.preset_id);if(body.schema!==1||body.siteId!==site||body.periodId!==period||body.expenseId!==expense||body.preset.id!==original.body.id||body.preset.hash!==original.hash||body.preset.version!==original.body.version||journalHash(body)!==row.hash)throw new HttpError(409,"지출의 최초 프리셋 출처가 일치하지 않습니다.");return {body,hash:row.hash,currentPreset:original.current&&original.body.status==="active"};}
