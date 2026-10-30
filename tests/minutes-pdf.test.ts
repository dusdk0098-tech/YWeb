import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { Request } from 'express';
import { checkRawPdfHeader, checkRawImageHeader, rawAttachmentMetadata } from '../server/raw-attachment.js';
import { migrateMinutesAttachments } from '../server/minutes-attachment-schema.js';
import { migrateMinutesPdf } from '../server/minutes-pdf-schema.js';

test('meeting PDF header acceptance is identification only, old image default remains', () => {
 for (const v of ['1.0','1.1','1.2','1.3','1.4','1.5','1.6','1.7','2.0']) for (const end of ['\r','\n','\r\n']) checkRawPdfHeader(Buffer.from(`%PDF-${v}${end}`));
 // Deliberately invalid body accepted: no claim of structural validity or scanning.
 checkRawPdfHeader(Buffer.from('%PDF-1.7\nNOT A PDF BODY'));
 for (const s of ['', '%PDF-', '%PDF-1.7', '%PDF-1.7x', '%PDF-1.8\n', '%PDF-2.1\n', ' %PDF-1.7\n', '\ufeff%PDF-1.7\n', '%pdf-1.7\n']) assert.throws(()=>checkRawPdfHeader(Buffer.from(s)));
 const headers:Record<string,string>={'content-type':'application/octet-stream','x-minutes-version':'1','idempotency-key':'11111111-1111-4111-8111-111111111111','x-file-name':'synthetic.PDF','x-file-type':'application/pdf'};
 const req={get:(s:string)=>headers[s]} as Request;
 assert.throws(()=>rawAttachmentMetadata(req,'x-minutes-version'));
 assert.deepEqual(rawAttachmentMetadata(req,'x-minutes-version',true),{version:1,format:'application/pdf',filename:'synthetic.PDF'});
 headers['x-file-name']='synthetic.jpg';assert.throws(()=>rawAttachmentMetadata(req,'x-minutes-version',true));
 headers['x-file-type']='image/jpeg';assert.equal(JSON.stringify(rawAttachmentMetadata(req,'x-minutes-version')),JSON.stringify(rawAttachmentMetadata(req,'x-minutes-version',true)));
 assert.throws(()=>checkRawImageHeader(Buffer.from('%PDF-1.7\n'),'image/jpeg'));
});
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE sites(id TEXT PRIMARY KEY);
 CREATE TABLE minutes(id TEXT PRIMARY KEY,site_id TEXT);CREATE TABLE minutes_records(minutes_id TEXT,status TEXT);
 INSERT INTO users VALUES('u');INSERT INTO sites VALUES('s');INSERT INTO minutes VALUES('m','s');
 `);migrateMinutesAttachments(db);db.exec("PRAGMA user_version=41");
 db.prepare('INSERT INTO minutes_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('a','s','m','old.png','image/png',3,'oldhash',Buffer.from([0,1,255]),1,'u','2026-10-28T00:00:00Z');
 return db;
}
test('41 to42 preserves finalized originals/events and rolls back copy mismatch atomically with FK always on',()=>{
 const db=fixture();try{
 db.prepare('INSERT INTO minutes_attachment_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(7,'m',2,'attachment_added','a','u','old name','old time','old reason','{"fixed":"raw bytes"}');
 db.exec("INSERT INTO minutes_records VALUES('m','finalized')");
 const before={originals:db.prepare('SELECT * FROM minutes_attachments').all(),events:db.prepare('SELECT * FROM minutes_attachment_events').all()};
 const faulty={exec:db.exec.bind(db),prepare:(sql:string)=>sql.includes(' EXCEPT ')?{get:()=>({injectedMismatch:true})}:db.prepare(sql)} as unknown as DatabaseSync;
 assert.throws(()=>migrateMinutesPdf(faulty),/mismatch/);
 assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,41);
 assert.deepEqual(db.prepare('SELECT * FROM minutes_attachments').all(),before.originals);
 assert.throws(()=>db.exec("UPDATE minutes_attachments SET filename='changed'"));
 migrateMinutesPdf(db);
 assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,42);
 assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys,1);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.deepEqual(db.prepare('SELECT * FROM minutes_attachments').all(),before.originals);
 assert.deepEqual(db.prepare('SELECT * FROM minutes_attachment_events').all(),before.events);
 assert.throws(()=>db.exec('DELETE FROM minutes_attachments'));
 assert.throws(()=>db.exec('UPDATE minutes_attachments SET attached=0'));
 assert.throws(()=>db.exec("UPDATE minutes_attachment_events SET reason='change'"));
 db.exec("INSERT INTO minutes VALUES('new','s')");
 const insert=db.prepare('INSERT INTO minutes_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 insert.run('pdf','s','new','file.pdf','application/pdf',9,'hash',Buffer.from('%PDF-1.7\n'),1,'u','now');
 assert.throws(()=>insert.run('html','s','new','file.html','text/html',1,'hash',Buffer.from('x'),1,'u','now'));
 }finally{db.close();}
});
