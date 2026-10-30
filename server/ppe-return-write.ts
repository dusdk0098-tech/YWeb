import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import type { StockMovement } from "./stock-model.js";
import { ppeReturnQuota, returnHash, validateReturnEntries, type ReturnKind, type ReturnSnapshot } from "./ppe-return-ledger.js";
export type PpeReturnIntent={issueId:string;kind:ReturnKind;cancelsId:string|null};
export function checkPpeReturnIntent(db:Db,itemId:string,movements:StockMovement[],quantity:string,kind:StockMovement["kind"],direction:1|-1,reverses:string|null,intent:PpeReturnIntent){
 const quota=ppeReturnQuota(db,itemId,movements);
 const source=db.prepare("SELECT * FROM ppe_issues WHERE id=? AND item_id=?").get(intent.issueId,itemId) as {original:string;original_hash:string;status:string;return_movement_id:string|null}|undefined;
 if(!source||source.status!=="issued"||source.return_movement_id!==null||returnHash(source.original)!==source.original_hash)throw new HttpError(409,"종결되었거나 다른 품목의 지급입니다.");
 const entries=quota.returnRows.filter(r=>r.issue_id===intent.issueId).map(r=>JSON.parse(r.snapshot) as ReturnSnapshot);
 const original=JSON.parse(source.original) as {quantity:string};
 const proposed:ReturnSnapshot={id:randomUUID(),issueId:intent.issueId,sourceHash:source.original_hash,movementId:"pending",kind:intent.kind,quantity,cancelsId:intent.cancelsId,effectiveDate:"",reason:"",actor:{id:"",name:""},at:""};
 validateReturnEntries(original.quantity,[...entries,proposed]);
 if(intent.kind==="cancel"){
  const target=quota.returnRows.find(r=>r.id===intent.cancelsId&&r.issue_id===intent.issueId&&r.kind==="partial");
  if(!target||kind!=="reversal"||direction!==-1||reverses!==target.movement_id)throw new HttpError(409,"부분 반납 전체 취소만 가능합니다.");
 }else if(kind!=="adjust_in"||direction!==1||reverses!==null)throw new HttpError(409,"반납 이동 종류가 일치하지 않습니다.");
 return proposed;
}
export function bindPpeReturn(db:Db,proposed:ReturnSnapshot,movement:StockMovement){
 const snapshot:ReturnSnapshot={...proposed,movementId:movement.id,effectiveDate:movement.effective_date,reason:movement.reason,actor:{id:movement.actor_id,name:movement.actor_name},at:movement.recorded_at};
 const json=JSON.stringify(snapshot);
 db.prepare("INSERT INTO ppe_return_entries VALUES(?,?,?,?,?,?,?,?)").run(snapshot.id,snapshot.issueId,movement.item_id,movement.id,snapshot.kind,snapshot.cancelsId,json,returnHash(json));
}
