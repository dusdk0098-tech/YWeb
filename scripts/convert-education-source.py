#!/usr/bin/env python3
"""Local, read-only OOXML text conversion. Never imports into the application DB."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import xml.etree.ElementTree as ET
import zipfile

MAX_INPUT = 32 * 1024 * 1024
MAX_XML = 4 * 1024 * 1024
MAX_JSON = 120 * 1024
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
EXPECTED = [('50',6),('51',8),('52',9),('53',10)] + [(str(i),i+11) for i in range(1,40)] + [('60',53),('61',56),('62',57),('70',64),('71',65),('80',70),('90',73)]

def require(ok, message):
    if not ok:
        raise ValueError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def jslen(text):
    return len(text.encode('utf-16-le')) // 2

def archive(data, outer=False):
    require(len(data) <= MAX_INPUT, 'ZIP/XLSM compressed input exceeds 32MiB')
    z = zipfile.ZipFile(io.BytesIO(data))
    infos = z.infolist()
    require(0 < len(infos) <= (1 if outer else 512), 'Unexpected archive entry count')
    names = set()
    total = 0
    for item in infos:
        # ZipInfo normalizes backslashes on Windows and truncates NULs on all
        # platforms. Validate the actual archive name, not its sanitized alias.
        name = item.orig_filename
        require(name == item.filename, 'Normalized archive paths are unsupported')
        require(name and name not in names and '\\' not in name and '\x00' not in name and ':' not in name, 'Duplicate or unsafe archive path')
        require(not name.startswith('/') and all(p not in ('','.', '..') for p in name.split('/')), 'Unsafe archive path')
        require(not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16), 'Directories/symlinks are unsupported')
        require(not item.flag_bits & 1 and item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), 'Encrypted/unsupported ZIP entry')
        require(item.file_size <= (MAX_INPUT if outer else 16*1024*1024) and item.file_size <= max(1,item.compress_size)*200, 'Entry size/compression ratio exceeds limit')
        total += item.file_size
        require(total <= (MAX_INPUT if outer else 64*1024*1024), 'Expanded archive total exceeds limit')
        if outer:
            require(len(PurePosixPath(name).parts)==1 and name.lower().endswith('.xlsm'), 'Outer ZIP must contain one root XLSM')
        else:
            require(not name.lower().endswith(('.zip','.xlsx','.xlsm','.xlsb','.7z','.rar')), 'Additional nested archive is unsupported')
        names.add(name)
    return z

def read_entry(z, name, cap=MAX_XML):
    require(name in z.namelist(), 'Required OOXML entry missing')
    info = z.getinfo(name)
    require(info.file_size <= cap, 'Required entry exceeds read limit')
    with z.open(info) as stream:
        data = stream.read(cap+1)
    require(len(data) == info.file_size and len(data) <= cap, 'Entry size mismatch')
    return data

def xml(z, name):
    data = read_entry(z,name)
    text = data.decode('utf-8',errors='strict')
    require('\x00' not in text and '<!DOCTYPE' not in text.upper() and '<!ENTITY' not in text.upper(), 'DTD/entities are unsupported')
    encoding = re.search(r'<\?xml[^>]*encoding=["\']([^"\']+)',text,re.I)
    require(not encoding or encoding.group(1).lower() in ('utf-8','utf8'), 'Only UTF-8 OOXML is supported')
    return ET.fromstring(text)

def source_records(data, expected_sha, filename, filename_version, internal_version):
    require(re.fullmatch('[a-f0-9]{64}',expected_sha) and digest(data)==expected_sha, 'Source SHA-256 mismatch')
    require(filename_version in filename, 'Expected filename revision not found')
    with archive(data,True) as outer:
        member=outer.namelist()[0]
        require(filename_version in member, 'Expected XLSM filename revision not found')
        workbook_bytes=read_entry(outer,member,MAX_INPUT)
    with archive(workbook_bytes) as book:
        workbook=xml(book,'xl/workbook.xml')
        relationships=xml(book,'xl/_rels/workbook.xml.rels')
        rels={}
        for rel in relationships:
            require(rel.get('Id') not in rels, 'Duplicate workbook relationship')
            require(rel.get('TargetMode')!='External', 'External workbook relationship unsupported')
            rels[rel.get('Id')]=rel.get('Target','')
        sheets=[s for s in workbook.findall('s:sheets/s:sheet',NS) if s.get('name')=='DB']
        require(len(sheets)==1,'Exactly one DB sheet required')
        target=rels.get(sheets[0].get('{'+REL+'}id'),'')
        require(re.fullmatch(r'worksheets/sheet\d+\.xml',target) is not None,'Unsupported DB sheet relationship target')
        strings_root=xml(book,'xl/sharedStrings.xml')
        strings=[''.join(t.text or '' for t in si.findall('.//s:t',NS)) for si in strings_root.findall('s:si',NS)]
        require(len(strings)<=100000,'Too many shared strings')
        versions=set()
        for text in strings:
            for a,b,c in re.findall(r'<개정\s+(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.',text):
                versions.add(f'{a}.{int(b):02d}.{int(c):02d}')
        require(versions=={internal_version},'Internal revision missing, changed or ambiguous')
        sheet=xml(book,'xl/'+target)
        cells={}
        for cell in sheet.findall('.//s:c',NS):
            address=cell.get('r')
            require(address not in cells,'Duplicate DB cell')
            cells[address]=cell
        def value(address):
            require(address in cells,'Required DB cell missing: '+address)
            cell=cells[address]
            require(cell.find('s:f',NS) is None and cell.get('t')!='e','Formula/error in selected source cell')
            typ=cell.get('t','n');v=cell.find('s:v',NS)
            if typ=='s':
                require(v is not None and v.text and v.text.isdigit() and int(v.text)<len(strings),'Invalid shared string reference')
                return strings[int(v.text)]
            if typ=='inlineStr':
                return ''.join(t.text or '' for t in cell.findall('s:is//s:t',NS))
            require(typ=='n' and v is not None,'Unsupported source cell type')
            return v.text or ''
        observed=[]
        for address in cells:
            if re.fullmatch(r'A\d+',address) and int(address[1:])>=6 and (cells[address].find('s:v',NS) is not None or cells[address].find('s:is',NS) is not None):
                text=value(address)
                if text.strip().isdigit(): observed.append(text.strip())
        require(len(observed)==50 and set(observed)=={c for c,_ in EXPECTED},'Expected 50 codes; missing/extra/duplicate code (91 remains absent)')
        records=[];report=[]
        for code,row in EXPECTED:
            require(value('A'+str(row)).strip()==code,'Code/location mismatch')
            title=value('B'+str(row));body=value('C'+str(row))
            require(title.strip() and body.strip(),'Empty source title/content')
            long=jslen(title)>200
            display=f'사용자 제공 교육 코드 {code} — 전체 제목은 본문' if long else title
            contents='원자료 제목\n'+title+'\n\n원자료 내용\n'+body
            require(jslen(display.strip())<=200 and jslen(contents.strip())<=10000,'Record exceeds existing catalog limits; no truncation')
            records.append({'title':display,'categoryLabel':f'사용자 제공 자료 · 코드 {code}','objectives':'','contents':contents})
            report.append({'code':code,'titleCell':f'DB!B{row}','contentCell':f'DB!C{row}','sourceTitleSha256':digest(title.encode()),'sourceContentSha256':digest(body.encode()),'titleCharactersUtf16':jslen(title),'contentCharactersUtf16':jslen(body),'displayTitleSubstituted':long,'originalTextIncludedInContents':True})
        require(len(records)==50,'Incomplete conversion')
        return records,{'sourceSha256':expected_sha,'workbookSha256':digest(workbook_bytes),'filenameRevision':filename_version,'internalRevision':internal_version,'revisionMismatch':filename_version!=internal_version,'count':50,'missingCodes':['91'],'rows':report,'warning':'Private user data; rights/current legal validity unverified. No macros, formulas, images, attendance or signatures imported. Empty objectives need human review. App normalization trims outer whitespace; source text hashes refer to extracted OOXML strings, not formatted workbook bytes.'}

def json_bytes(value):
    return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf-8')

def batches(records):
    parts=[];part=[]
    def payload(rows):return {'format':'pedit-own-education-content','schemaVersion':1,'records':rows}
    for record in records:
        require(len(json_bytes(payload([record])))<=MAX_JSON,'One record exceeds transfer byte limit')
        if part and (len(part)==20 or len(json_bytes(payload(part+[record])))>MAX_JSON):
            parts.append(json_bytes(payload(part)));part=[]
        part.append(record)
    if part:parts.append(json_bytes(payload(part)))
    return parts

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--expected-sha256',required=True)
    parser.add_argument('--filename-revision',required=True)
    parser.add_argument('--internal-revision',required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1];out=args.output_dir.resolve()
    require(not out.is_relative_to(root),'Private output must be outside app/source package tree')
    require(not out.exists() and out.parent.is_dir(),'Output must be a new directory under an existing private parent')
    require(args.source.is_file() and args.source.stat().st_size<=MAX_INPUT,'Source missing or exceeds 32MiB')
    with args.source.open('rb') as stream:data=stream.read(MAX_INPUT+1)
    records,report=source_records(data,args.expected_sha256,args.source.name,args.filename_revision,args.internal_revision)
    parts=batches(records);report['files']=[];index=0
    temp=Path(tempfile.mkdtemp(prefix='.education-convert-',dir=out.parent))
    try:
        for n,part in enumerate(parts,1):
            name=f'education-content-{n:02d}.json';p=temp/name;p.write_bytes(part);p.chmod(0o600)
            count=len(json.loads(part)['records']);report['files'].append({'name':name,'sha256':digest(part),'bytes':len(part),'count':count})
            for local in range(count):report['rows'][index+local].update({'file':name,'index':local})
            index+=count
        require(index==50,'Batch completeness mismatch')
        p=temp/'conversion-report.json';p.write_bytes(json_bytes(report));p.chmod(0o600)
        require(not out.exists(),'Output appeared while converting')
        temp.rename(out)
    except BaseException:
        shutil.rmtree(temp,ignore_errors=True);raise
    print(json.dumps({'outputDirectory':str(out),'count':50,'missingCodes':['91'],'revisionMismatch':report['revisionMismatch'],'substitutedTitles':[r['code'] for r in report['rows'] if r['displayTitleSubstituted']],'files':report['files']},ensure_ascii=False))

if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,zipfile.BadZipFile,ET.ParseError,UnicodeError,OSError) as error:
        raise SystemExit('Conversion stopped; no partial output published: '+str(error))
