#!/usr/bin/env python3
"""Private text-only source conversion. No DB writes, formula/image execution or publication."""
import argparse,importlib.util,json,os,re,sys,tempfile,shutil
from pathlib import Path
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('bounded_ooxml',Path(__file__).with_name('convert-education-source.py'))
safe=importlib.util.module_from_spec(spec);spec.loader.exec_module(safe)
require=safe.require
SHEET='참고1.위험요인및안전대책_작성안함'
def canonical(r):return json.dumps([r[k] for k in ['formatVersion','sourceFileSha256','sheet','sectionCell','row','section','category','hazard','control']],ensure_ascii=False,separators=(',',':')).encode()
def convert(data,expected):
 require(safe.digest(data)==expected and re.fullmatch('[a-f0-9]{64}',expected),'Source SHA mismatch')
 with safe.archive(data) as z:
  wb=safe.xml(z,'xl/workbook.xml');rels={}
  for rel in safe.xml(z,'xl/_rels/workbook.xml.rels'):
   require(rel.get('Id') not in rels and rel.get('TargetMode')!='External','Duplicate/external workbook relationship');rels[rel.get('Id')]=rel.get('Target','')
  sheets=[s for s in wb.findall('s:sheets/s:sheet',safe.NS) if s.get('name')==SHEET];require(len(sheets)==1,'Exactly one reference sheet required')
  target=rels.get(sheets[0].get('{'+safe.REL+'}id'),'');require(re.fullmatch(r'worksheets/sheet\d+\.xml',target),'Unsupported sheet relationship')
  ss=[''.join(t.text or '' for t in si.findall('.//s:t',safe.NS)) for si in safe.xml(z,'xl/sharedStrings.xml').findall('s:si',safe.NS)];require(len(ss)<=100000,'Shared string cap')
  sheet=safe.xml(z,'xl/'+target);require(not sheet.findall('.//s:f',safe.NS),'Reference formulas unsupported');cells={}
  for c in sheet.findall('.//s:c',safe.NS):
   a=c.get('r');require(a not in cells and re.fullmatch('[A-Z]+[1-9][0-9]*',a or ''),'Duplicate/invalid cell');v=c.find('s:v',safe.NS);typ=c.get('t','n')
   if typ=='s':require(v is not None and (v.text or '').isdigit() and int(v.text)<len(ss),'Bad shared string');value=ss[int(v.text)]
   elif typ=='inlineStr':value=''.join(t.text or '' for t in c.findall('s:is//s:t',safe.NS))
   else:require(typ=='n' and (v is None or not v.text),'Non-text reference cell');value=''
   cells[a]=value
  merges={x.get('ref') for x in sheet.findall('s:mergeCells/s:mergeCell',safe.NS)};records=[];omitted=[];used=set()
  for start in range(1,154,8):
   section=cells.get('A'+str(start),'');require(section.startswith('위험요인 / 안전대책(') and section.endswith(')'),'Section layout changed');used.add('A'+str(start))
   header=start+1
   require([cells.get(c+str(header),'') for c in ['A','B','E']]==['재해형태','위험요인','안전대책'],'Header layout changed');used.update(c+str(header) for c in ['A','B','E'])
   for row in range(start+2,start+8):
    require(f'B{row}:D{row}' in merges and f'E{row}:G{row}' in merges,'Merge anchor changed')
    category,hazard,control=[cells.get(c+str(row),'') for c in ['A','B','E']];used.update(c+str(row) for c in ['A','B','E']);require(category.strip(),'Category missing')
    if not hazard.strip() or not control.strip():
     require(not hazard.strip() and not control.strip(),'Ambiguous partial row; no guessing');omitted.append({'row':row,'reason':'Both hazard/control empty; not inherited','cells':[f'B{row}',f'E{row}']});continue
    record={'formatVersion':1,'sourceFileSha256':expected,'sheet':SHEET,'sectionCell':'A'+str(start),'row':row,'section':section,'category':category,'hazard':hazard,'control':control}
    for key,cap in [('section',300),('category',100),('hazard',5000),('control',5000)]:require(0<safe.jslen(record[key])<=cap,'Text cap; no truncation')
    record['contentHash']=safe.digest(canonical(record));records.append(record)
  require(not [a for a,v in cells.items() if v.strip() and a not in used],'Unmapped nonempty cells; whole conversion stopped')
  require(len(records)==110 and [x['row'] for x in omitted]==[63,70,87,95,118,125,127,140,148,151],'Expected source completeness changed; review required')
  return records,{'sourceFileSha256':expected,'formatVersion':1,'sheet':SHEET,'sections':20,'candidateRows':120,'converted':110,'omitted':omitted,'warning':'Private user material. Rights/current applicability unverified. No formula/image/engineering interpretation. Text strings preserved without trimming; blank rows not filled.'}
def write_private(source,expected,out):
 require(source.stat().st_size<=safe.MAX_INPUT,'Input cap');records,report=convert(source.read_bytes(),expected);out=out.resolve();app=Path(__file__).resolve().parent.parent
 require(not out.exists() and not out.is_relative_to(app),'Output must be new private directory outside app');out.parent.mkdir(parents=True,exist_ok=True);tmp=Path(tempfile.mkdtemp(prefix='.hazard-private-',dir=out.parent));os.chmod(tmp,0o700)
 try:
  report['files']=[]
  for offset in range(0,len(records),20):
   rows=records[offset:offset+20];payload={'format':'pedit-user-plan-hazard-reference','schemaVersion':1,'records':rows};data=safe.json_bytes(payload);require(len(data)<=120*1024,'Transfer cap; whole conversion stopped');name=f'plan-hazard-reference-{offset//20+1:02d}.json';(tmp/name).write_bytes(data);os.chmod(tmp/name,0o600);report['files'].append({'name':name,'count':len(rows),'sha256':safe.digest(data),'bytes':len(data),'rows':[r['row'] for r in rows]})
  report['itemHashes']=[{'row':r['row'],'hash':r['contentHash']} for r in records];(tmp/'conversion-report.json').write_bytes(safe.json_bytes(report));os.chmod(tmp/'conversion-report.json',0o600);tmp.rename(out)
 except Exception:shutil.rmtree(tmp,ignore_errors=True);raise
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--source-sha256',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 try:r=write_private(a.input,a.source_sha256,a.output);print(json.dumps({'converted':r['converted'],'omitted':len(r['omitted']),'files':r['files']},ensure_ascii=False))
 except (ValueError,OSError,KeyError,IndexError) as e:raise SystemExit(str(e))
