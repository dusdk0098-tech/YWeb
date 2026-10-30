import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {stockState,type StockItem} from "../server/stock-model.js";
test("stock read fails whole before interpretation above conservative9000 bound",()=>{
 const db=new DatabaseSync(":memory:");try{
 db.exec("CREATE TABLE stock_movements(item_id TEXT,sequence INTEGER); BEGIN");
 const insert=db.prepare("INSERT INTO stock_movements VALUES('synthetic',?)");for(let i=1;i<=9001;i++)insert.run(i);db.exec("COMMIT");
 const item={id:"synthetic"} as StockItem;
 assert.throws(()=>stockState(db,item),/9000/);
 }finally{db.close();}
});
