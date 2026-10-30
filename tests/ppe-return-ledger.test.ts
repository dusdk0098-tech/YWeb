import test from "node:test";
import assert from "node:assert/strict";
import {validateReturnEntries,type ReturnSnapshot} from "../server/ppe-return-ledger.js";
const entry=(id:string,kind:ReturnSnapshot["kind"],quantity:string,cancelsId:string|null=null):ReturnSnapshot=>({id,kind,quantity,cancelsId,issueId:"synthetic",sourceHash:"synthetic",movementId:id,effectiveDate:"2026-10-28",reason:"Synthetic policy test",actor:{id:"synthetic",name:"Synthetic"},at:"synthetic"});
test("three lifetime partials and their cancellations retain one exact final completion",()=>{
 const rows:ReturnSnapshot[]=[];
 for(let i=0;i<3;i++){rows.push(entry(`p${i}`,"partial","0.1"),entry(`c${i}`,"cancel","0.1",`p${i}`));}
 assert.equal(validateReturnEntries("0.3",rows).remainingQuantity,"0.3");
 assert.throws(()=>validateReturnEntries("0.3",[...rows,entry("fourth","partial","0.1")]));
 const done=validateReturnEntries("0.3",[...rows,entry("end","terminal","0.3")]);assert.equal(done.terminal,true);assert.equal(done.remainingQuantity,"0");
});
test("exact six decimal sums, wrong inverse amount and immutable terminal",()=>{
 const a=entry("a","partial","0.000001"),b=entry("b","partial","0.099999"),end=entry("end","terminal","0.2");
 assert.equal(validateReturnEntries("0.3",[a,b]).returnedQuantity,"0.1");
 assert.equal(validateReturnEntries("0.3",[a,b,end]).remainingQuantity,"0");
 for(const rows of [[a,entry("bad","cancel","0.1","a")],[a,entry("bad","terminal","0.3")],[a,b,end,entry("cancel","cancel","0.000001","a")],[entry("full","partial","0.3")],[a,entry("c","cancel","0.000001","a"),entry("c2","cancel","0.000001","a")]])assert.throws(()=>validateReturnEntries("0.3",rows));
});
