import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup,DatabaseSync } from 'node:sqlite';
import { educationAttachmentFixture } from './fixtures/education-attachment-fixture.js';
import { openDatabase } from '../server/db.js';
import { CURRENT_SCHEMA_VERSION } from '../server/schema-version.js';
import { createBackup,restoreBackup } from '../scripts/local-backup.js';
import { fixedEducationAttachments } from '../server/education-attachment-model.js';
import { fullEducationRecord } from '../server/education-record.js';
import { printEducation } from '../server/education-print.js';
import type { EducationRow } from '../server/education.js';
const remove49='DROP TABLE education_archive_attachments; DROP TABLE education_attachment_events; DROP TABLE education_attachments; PRAGMA user_version=48;';
test('48 to49 preserves education original snapshot receipt and HTML; missing vs explicit empty sidecar',async()=>{
 const f=await educationAttachmentFixture(),dir=await mkdtemp(join(tmpdir(),'education-attachment-migration-'));try{
  const ready=await f.ready(),r=await f.send(f.url+'/archive',{version:ready.version});assert.equal(r.status,200,r.text);
  const empty=fixedEducationAttachments(f.db,f.site,f.id);assert.equal(empty.recorded,true);if(empty.recorded)assert.deepEqual(empty.manifest.items,[]);
  const tables=['education_sessions','education_participants','education_snapshots','education_catalog_links','idempotency','audit'];const original=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));const html=(await f.agent.get(f.siteBase+f.url+'/print')).text;
  const path=join(dir,'legacy.sqlite');await backup(f.db,path);const old=new DatabaseSync(path);old.exec(remove49);
  // Explicit historical48 fixture; collision proves additive migration rolls back atomically.
  const collision=join(dir,'collision.sqlite');await backup(old,collision);old.close();const bad=new DatabaseSync(collision);bad.exec('CREATE TABLE education_attachment_events(synthetic TEXT)');bad.close();assert.throws(()=>openDatabase(collision));const checked=new DatabaseSync(collision);assert.equal(checked.prepare('PRAGMA user_version').get()!.user_version,48);assert.equal(checked.prepare("SELECT count(*) n FROM sqlite_master WHERE name='education_attachments'").get()!.n,0);checked.close();
  const migrated=openDatabase(path);try{
   assert.equal(migrated.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(migrated.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),original[t]);
   const row=migrated.prepare('SELECT * FROM education_sessions WHERE id=?').get(f.id) as EducationRow;const full=fullEducationRecord(migrated,row);
   assert.equal(printEducation({id:f.id,site:'합성 현장',details:full.body,participants:full.participants,version:full.version,catalogSource:full.catalogSource},full.snapshot),html);
   assert.equal(fixedEducationAttachments(migrated,f.site,f.id).recorded,false);assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{migrated.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
test('schema49 backup keeps new education BLOB events and exact snapshot sidecar',async()=>{
 const f=await educationAttachmentFixture(),dir=await mkdtemp(join(tmpdir(),'education-original-backup-'));try{
  const up=await f.upload();assert.equal(up.status,200,up.text);const ready=await f.ready();assert.equal((await f.send(f.url+'/archive',{version:ready.version})).status,200);
  const tables=['education_sessions','education_participants','education_snapshots','education_attachments','education_attachment_events','education_archive_attachments','idempotency'];const before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
  const file=join(dir,'current.sqlite');await backup(f.db,file);const manifest=await createBackup(file,join(dir,'bundle'));assert.equal(manifest.schemaVersion,CURRENT_SCHEMA_VERSION);
  const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restored')),db=new DatabaseSync(restored.databasePath);try{
   for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);assert.equal(fixedEducationAttachments(db,f.site,f.id).recorded,true);const raw=db.prepare('SELECT bytes,sha256 FROM education_attachments').get()!;assert.equal(createHash('sha256').update(raw.bytes as Uint8Array).digest('hex'),raw.sha256);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
