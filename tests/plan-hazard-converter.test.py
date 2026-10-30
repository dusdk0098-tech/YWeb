import importlib.util,io,json,unittest,zipfile
from pathlib import Path
sp=importlib.util.spec_from_file_location('converter',Path(__file__).parents[1]/'scripts/convert-plan-hazard-source.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
missing={63,70,87,95,118,125,127,140,148,151}
def source(extra='',badmerge=False,partial=False):
 strings=[];cells=[];merges=[]
 def add(a,text):
  strings.append(text);cells.append(f'<c r="{a}" t="s"><v>{len(strings)-1}</v></c>')
 for start in range(1,154,8):
  add(f'A{start}',f'위험요인 / 안전대책(Synthetic {start})')
  for c,t in [('A','재해형태'),('B','위험요인'),('E','안전대책')]:add(f'{c}{start+1}',t)
  for row in range(start+2,start+8):
   add(f'A{row}','Synthetic category')
   if row not in missing:add(f'B{row}',' Synthetic hazard\n preserved ');add(f'E{row}','Synthetic control')
   elif partial and row==63:add('B63','Ambiguous')
   merges.extend([f'<mergeCell ref="B{row}:D{row}"/>',f'<mergeCell ref="E{row}:G{row}"/>'])
 if badmerge:merges.pop()
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
  z.writestr('xl/workbook.xml',f'<workbook xmlns="{NS}" xmlns:r="{m.safe.REL}"><sheets><sheet name="{m.SHEET}" r:id="r1"/></sheets></workbook>')
  z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
  z.writestr('xl/sharedStrings.xml',f'<sst xmlns="{NS}">'+''.join('<si><t>'+s+'</t></si>' for s in strings)+'</sst>')
  z.writestr('xl/worksheets/sheet1.xml',f'<worksheet xmlns="{NS}"><sheetData><row>'+''.join(cells)+extra+'</row></sheetData><mergeCells>'+''.join(merges)+'</mergeCells></worksheet>')
 return b.getvalue()
class Converter(unittest.TestCase):
 def test_all_rows(self):
  b=source();rows,report=m.convert(b,m.safe.digest(b));self.assertEqual(len(rows),110);self.assertEqual([x['row'] for x in report['omitted']],sorted(missing));self.assertEqual(rows[0]['hazard'],' Synthetic hazard\n preserved ');self.assertEqual(rows[0]['contentHash'],m.safe.digest(m.canonical(rows[0])))
 def test_no_guesses(self):
  for b in [source(badmerge=True),source(partial=True),source('<c r="F200" t="inlineStr"><is><t>Unexpected</t></is></c>'),source('<c r="G200"><f>1/0</f></c>')]:
   with self.assertRaises(ValueError):m.convert(b,m.safe.digest(b))
 def test_archive_xml_caps(self):
  with self.assertRaises(ValueError):m.convert(source(),'0'*64)
  for name,data in [('../bad','x'),('nested.zip','x'),('huge','0'*100000)]:
   b=io.BytesIO()
   with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:z.writestr(name,data)
   with self.assertRaises(ValueError):m.safe.archive(b.getvalue())
  b=io.BytesIO()
  with zipfile.ZipFile(b,'w') as z:z.writestr('x.xml','<!DOCTYPE x [<!ENTITY a SYSTEM "file:///no">]><x/>')
  with m.safe.archive(b.getvalue()) as z:
   with self.assertRaises(ValueError):m.safe.xml(z,'x.xml')
if __name__=='__main__':unittest.main()
