import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase, type Db } from "../server/db.js";
import { createApp } from "../server/app.js";
import { minimumInput } from "../server/stock-minimum-routes.js";
import { createStockMinimumTables } from "../server/stock-minimum-schema.js";
import { minimumComparison, minimumPage, type StockMinimumSnapshot } from "../server/stock-minimum-model.js";
import { stockItem, movementHash, type StockMovement } from "../server/stock-model.js";
import { journalHash } from "../server/daily-journal-sources.js";
import { stockText, stockUnits } from "../server/stock-quantity.js";
function seed(db: Db) {
  const site = randomUUID(), user = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(user, `${user}@example.test`, "합성 기록자", "not-login");
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site,"합성 현장");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site,user,"manager");
  return {site,user};
}
function item(db: Db, site: string, user: string, name = "합성 품목") {
  const id = randomUUID();
  db.prepare("INSERT INTO stock_items VALUES(?,?,?,?,1,?,?,?)").run(id,site,name,"개",user,"2026-10-28T00:00:00Z","2026-10-28T00:00:00Z");
  return stockItem(db,site,id);
}
function setting(db: Db, r: ReturnType<typeof stockItem>, user: string, minimum = "1", version = 1) {
  const s: StockMinimumSnapshot = {schemaVersion:1,id:randomUUID(),version,item:{id:r.id,siteId:r.site_id,name:r.name,unit:r.unit,version:r.version},enabled:true,minimum,reason:"합성 관리자 기준",actor:{id:user,name:"합성 기록자"},at:"2026-10-28T00:00:00Z"};
  db.prepare("INSERT INTO stock_minimum_events VALUES(?,?,?,?,?)").run(s.id,r.id,version,JSON.stringify(s),journalHash(s));return s;
}
function setupTables(db: Db) { if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='stock_minimum_events'").get()) createStockMinimumTables(db); }
test("minimum exact six-place comparisons and explicit unavailable unit/hash policy", () => {
  const db=openDatabase(":memory:");setupTables(db); const {site,user}=seed(db), r=item(db,site,user);
  assert.equal(minimumComparison(db,r).status,"unset"); setting(db,r,user,"0");
  assert.equal(minimumComparison(db,r).status,"equal");
  setting(db,r,user,"0.000001",2);assert.equal(minimumComparison(db,r).shortfall,"0.000001");
  db.prepare("UPDATE stock_items SET unit='상자',version=2 WHERE id=?").run(r.id);
  assert.equal(minimumComparison(db,stockItem(db,site,r.id)).status,"unavailable");
  assert.equal(minimumComparison(db,stockItem(db,site,r.id)).balance,null);
  setting(db,stockItem(db,site,r.id),user,"0",3);assert.equal(minimumComparison(db,stockItem(db,site,r.id)).status,"equal");
  assert.throws(()=>db.prepare("UPDATE stock_minimum_events SET version=9").run());
  assert.throws(()=>db.prepare("DELETE FROM stock_minimum_events").run());
  for(const n of ["-1","1e3","01",".1","1,000","0.0000001","1000000000.000001"]) assert.throws(()=>stockUnits(n,true));
  assert.equal(stockText(stockUnits("1000000000.000000",true)),"1000000000");
  assert.throws(()=>minimumInput.parse({enabled:false,minimum:"0",expectedConfigVersion:0,expectedItemVersion:1,reason:"x",confirm:true}));
  db.close();
});
test("minimum real app setting receipts do not change stock history; disable, unit reset, versions and rollback", async () => {
  const db=openDatabase(":memory:");setupTables(db);const {site,user}=seed(db), password=randomUUID(), origin="http://127.0.0.1:3000";
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(await argon2.hash(password),user);
  const app=await createApp(db,{origin,secret:"s".repeat(48)});
  const agent=request.agent(app);let response=await agent.get("/api/session");
  response=await agent.post("/api/login").set("Origin",origin).set("x-csrf-token",response.body.csrf).send({email:`${user}@example.test`,password});
  assert.equal(response.status,200,response.text);const csrf=response.body.csrf;
  const post=(path:string,body:object,key=randomUUID())=>agent.post(path).set("Origin",origin).set("x-csrf-token",csrf).set("idempotency-key",key).send(body);
  const base=`/api/sites/${site}/stock-items`;
  response=await post(base,{name:"합성 장갑",unit:"켤레"});assert.equal(response.status,200,response.text);const id=response.body.id;
  response=await post(`${base}/${id}/movements`,{version:1,kind:"opening",quantity:"0.3",effectiveDate:"2026-10-28",reason:"합성 실제 이동"});assert.equal(response.status,200,response.text);
  const frozen=JSON.stringify(db.prepare("SELECT * FROM stock_events").all()), movements=JSON.stringify(db.prepare("SELECT * FROM stock_movements").all());
  const body={expectedConfigVersion:0,expectedItemVersion:2,enabled:true,minimum:"0.300000",reason:"자체 기준",confirm:true}, key=randomUUID(), url=`${base}/${id}/minimum`;
  response=await post(url,body,key);assert.equal(response.status,200,response.text);const stored=response.text;
  assert.equal(response.body.snapshot.minimum,"0.3");assert.equal((await post(url,body,key)).text,stored);
  assert.equal((await agent.get(url)).body.status,"equal");
  assert.equal((await post(url,body)).status,409);
  response=await post(url,{...body,expectedConfigVersion:1,minimum:"0.2"});assert.equal(response.status,200,response.text);
  assert.equal((await agent.get(url)).body.status,"above");
  response=await post(url,{expectedConfigVersion:2,expectedItemVersion:2,enabled:false,reason:"명시 해제",confirm:true});assert.equal(response.status,200,response.text);
  assert.equal((await agent.get(url)).body.status,"disabled");
  db.exec("CREATE TRIGGER synthetic_minimum_fail BEFORE INSERT ON audit WHEN NEW.event='stock.minimum' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
  response=await post(url,{...body,expectedConfigVersion:3});assert.equal(response.status,500,response.text);
  assert.equal((await agent.get(url)).body.configVersion,3);
  db.exec("DROP TRIGGER synthetic_minimum_fail");
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM stock_events").all()),frozen);
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM stock_movements").all()),movements);
  assert.equal((await agent.get(url+"/history")).body.items.length,3);
  db.prepare("UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?").run(site,user);
  assert.equal((await post(url,body,key)).status,403);
  assert.equal((await agent.get(url)).status,403);db.close();
});
test("minimum configured register remains usable beyond200 with page-only counts and literal order", () => {
 const db=openDatabase(":memory:");setupTables(db);const {site,user}=seed(db);
 for(let i=0;i<211;i++)setting(db,item(db,site,user,String(i).padStart(3,"0")),user,i%2?"1":"0");
 const first=minimumPage(db,site,0), last=minimumPage(db,site,210);
 assert.equal(first.items.length,10);assert.equal(first.pageCounts.below,5);assert.equal(first.pageCounts.equal,5);assert.equal(first.totalConfiguredItems,211);
 assert.equal(last.items.length,1);assert.equal(last.hasMore,false);assert.equal(last.items[0].item.name,"210");
 assert.equal(minimumPage(db,site,200).hasMore,true);assert.equal(minimumPage(db,site,999).items.length,0);db.close();
});
test("minimum page bounds ten9000 histories; invalid quotas never become zero or normal", t => {
 const db=openDatabase(":memory:");setupTables(db);const {site,user}=seed(db);
 const insert=db.prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
 db.exec("BEGIN");
 for(let k=0;k<10;k++){
  const r=item(db,site,user,`large${k}`);setting(db,r,user,"1");
  for(let i=1;i<=9000;i++){
   const body:Omit<StockMovement,"hash">={id:randomUUID(),item_id:r.id,sequence:i,kind:"receipt",quantity:"1",direction:1,effective_date:"2026-10-28",reason:"합성 검증 비용 경계, quota-invalid",reverses_id:null,actor_id:user,actor_name:"합성 기록자",recorded_at:"2026-10-28T00:00:00Z",item_snapshot:JSON.stringify({id:r.id,siteId:site,name:r.name,unit:r.unit}),balance_after:String(i)};
   insert.run(...Object.values(body),movementHash(body));
  }
 }
 db.exec("COMMIT");const start=performance.now(), page=minimumPage(db,site,0);
 t.diagnostic(`ten x9000 hash/sum then invalid quota rejection: ${Math.round(performance.now()-start)}ms; not valid9000 quota acceptance or production load evidence`);
 assert.equal(page.items.length,10);assert.equal(page.pageCounts.unavailable,10);assert.ok(page.items.every(r=>r.balance===null&&r.shortfall===null));db.close();
});
