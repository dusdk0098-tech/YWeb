"""Synthetic-only fixture and ordinary converter contract checks."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile
from xml.sax.saxutils import escape
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('converter',Path(__file__).parents[2]/'scripts/convert-education-source.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
NS=c.NS['s']
def zipbytes(entries):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in entries:
            # Windows zipfile rewrites '\\' to '/' on write; keep the raw unsafe name.
            if '\\' in name:zi=zipfile.ZipInfo(name);zi.filename=name;z.writestr(zi,data)
            else:z.writestr(name,data)
    return out.getvalue()
def entries():
    cells=[]
    for code,row in c.EXPECTED:
        title=('긴 제목 '*60) if code in ('9','10','31') else '합성 제목 '+code
        body='  합성 내용 '+code+'\n둘째 줄 <text> & 끝  '
        for col,text in [('A',code),('B',title),('C',body)]:
            cells.append(f'<c r="{col}{row}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>')
    return [('xl/workbook.xml',f'<workbook xmlns="{NS}" xmlns:r="{c.REL}"><sheets><sheet name="DB" r:id="r1"/></sheets></workbook>'),('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'),('xl/sharedStrings.xml',f'<sst xmlns="{NS}"><si><t>&lt;개정 2025. 5. 30.&gt;</t></si></sst>'),('xl/worksheets/sheet1.xml',f'<worksheet xmlns="{NS}"><sheetData><row>'+''.join(cells)+'</row></sheetData></worksheet>'),('xl/vbaProject.bin',b'SYNTHETIC NEVER EXECUTED')]
def source(es=None):return zipbytes([('synthetic-2023.09.27.xlsm',zipbytes(entries() if es is None else es))])
def convert(data):return c.source_records(data,c.digest(data),'synthetic-2023.09.27.zip','2023.09.27','2025.05.30')
class Checks(unittest.TestCase):
 def test_complete(self):
    records,report=convert(source());parts=c.batches(records)
    self.assertEqual([len(json.loads(b)['records']) for b in parts],[20,20,10]);self.assertEqual(report['missingCodes'],['91']);self.assertTrue(report['revisionMismatch'])
    self.assertEqual([r['code'] for r in report['rows'] if r['displayTitleSubstituted']],['9','10','31'])
    self.assertIn('  합성 내용 50\n둘째 줄 <text> & 끝  ',records[0]['contents']);self.assertEqual(records[0]['objectives'],'')
 def test_identity_and_codes(self):
    data=source()
    with self.assertRaises(ValueError):c.source_records(data,'0'*64,'2023.09.27.zip','2023.09.27','2025.05.30')
    for old,new in [('>90<','>91<'),('>50<','>51<'),('2025. 5. 30.','2024. 5. 30.'),('<c r="C6"','<c r="C999"')]:
      es=[(n,v.replace(old,new) if isinstance(v,str) else v) for n,v in entries()]
      with self.assertRaises(ValueError):convert(source(es))
 def test_formula_and_xml(self):
    for payload in ['<f>1+1</f>','<!DOCTYPE x [<!ENTITY x SYSTEM "file:///not-read">]>']:
      es=entries();name,value=es[3];es[3]=(name,value.replace('<is>',payload+'<is>',1) if payload.startswith('<f>') else payload+value)
      with self.assertRaises(ValueError):convert(source(es))
    es=entries();es[3]=(es[3][0],b'\xff')
    with self.assertRaises(UnicodeError):convert(source(es))
 def test_external_relation_and_catalog_limit(self):
    es=entries();es[1]=(es[1][0],es[1][1].replace('Target=', 'TargetMode="External" Target='))
    with self.assertRaises(ValueError):convert(source(es))
    es=entries();es[3]=(es[3][0],es[3][1].replace('합성 내용 50', '한'*10001))
    with self.assertRaises(ValueError):convert(source(es))
 def test_archives_and_caps(self):
    for name in ['../x','/x','x\\y','x:bad','x//y','extra.zip']:
      with self.assertRaises(ValueError):c.archive(zipbytes(entries()+[(name,'x')]))
    with self.assertRaises(ValueError):c.archive(zipbytes([('same','x'),('same','y')]))
    with self.assertRaises(ValueError):c.archive(zipbytes([('a','x'*1000000)]))
    with self.assertRaises(ValueError):c.archive(zipbytes([(str(i),'x') for i in range(513)]))
    with self.assertRaises(ValueError):c.archive(zipbytes([('a.xlsm','x'),('b.xlsm','y')]),True)
    with self.assertRaises(ValueError):c.batches([{'contents':'한'*50000}])
    with self.assertRaises(ValueError):c.xml(zipfile.ZipFile(io.BytesIO(zipbytes([('big',b'x'*(c.MAX_XML+1))]))),'big')
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
      info=zipfile.ZipInfo('link');info.external_attr=(0o120777<<16);z.writestr(info,'target')
    with self.assertRaises(ValueError):c.archive(out.getvalue())
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='fixture':
    p=Path(sys.argv[2]);data=source();p.write_bytes(data);print(c.digest(data))
 else:unittest.main()
