"""Synthetic data only. Positions are hand-chosen on the user's blank form."""
from pathlib import Path
from io import BytesIO
import json
from reportlab.pdfgen import canvas
from pypdf import PdfReader,PdfWriter
from PIL import Image
import pypdfium2 as pdfium
out=Path('test/fixtures');source=Path(r'C:\Users\Anshuman\Downloads\cms_1500_sample.pdf')
W,H=720,864
cases=[
 dict(name='A',patient='MORGAN AVERY',dob='02 29 1988',insured='MORGAN AVERY',id='00123456789',address='24 MAPLE STREET',city='DENVER',state='CO',zip='802030012',tax='012345678',account='00001234',npi='1234567893',paid='50.00',total='200.75',balance='150.75',diagnoses=['250.00','401.9'],lines=[['01 02 26','01 02 26','11','99213','1','125.50','1'],['01 03 26','01 03 26','11','93000','2','75.25','1']],checks=['Medicare','Male','Self','Employment Yes','Auto No','Other No','Insured Male','Other plan No','Lab No','EIN','Assignment Yes']),
 dict(name='B',patient='PEREZ JORDAN',dob='11 23 1974',insured='PEREZ TAYLOR',id='AB00998877',address='803 OAK AVENUE',city='AUSTIN',state='TX',zip='787010099',tax='987654321',account='0000042',npi='1234567893',paid='199.95',total='199.95',balance='0.00',diagnoses=['V70.0','401.9'],lines=[['03 11 26','03 11 26','22','99214','1','150.00','2'],['03 12 26','03 12 26','22','93000','2','49.95','1']],checks=['Group health plan','Female','Spouse','Employment No','Auto Yes','Other Yes','Insured Female','Other plan Yes','Lab Yes','SSN','Assignment No'])
]
# Canvas positions use original PDF points; no extraction code is imported.
marks={'Medicare':(63.5,149),'Group health plan':(278,149),'Male':(357,173),'Female':(393,173),'Self':(293,197),'Spouse':(329,197),'Employment Yes':(307,293),'Employment No':(350,293),'Auto Yes':(307,317),'Auto No':(350,317),'Other Yes':(307,341),'Other No':(350,341),'Insured Male':(544,293),'Insured Female':(595,293),'Other plan Yes':(429,365),'Other plan No':(465,365),'Lab Yes':(430,485),'Lab No':(467,485),'SSN':(179,724),'EIN':(193,724),'Assignment Yes':(328,724),'Assignment No':(364,724)}
for c in cases:
 buf=BytesIO();cv=canvas.Canvas(buf,pagesize=(W,H))
 def write(x,y,text,size=9):
  cv.setFont('Courier-Bold',size);cv.drawString(x,H-y,text)
 write(40,28,'SYNTHETIC TEST DATA - NOT A REAL CLAIM',10)
 for x,y,v in [(60,175,c['patient']),(276,175,c['dob']),(413,151,c['id']),(412,175,c['insured']),(60,199,c['address']),(60,224,c['city']),(241,224,c['state']),(60,247,c['zip']),(60,723,c['tax']),(216,723,c['account']),(431,723,c['total']),(508,723,c['paid']),(576,723,c['balance']),(75,511,c['diagnoses'][0]),(75,534,c['diagnoses'][1]),(216,752,'SYNTHETIC CLINIC'),(216,763,'10 TEST ROAD'),(216,774,'DENVER CO 80203'),(219,787+0,'')]:
  if v:write(x,y,v,8 if len(v)>25 else 9)
 # NPI line stays below the facility address.
 write(226,789,c['npi'],8);write(416,789,c['npi'],8)
 for i,row in enumerate(c['lines']):
  y=584+i*24
  for x,v in zip([61,124,187,234,378,424,493],row):write(x,y,v,8)
 for mark in c['checks']:
  x,y=marks[mark];cv.setLineWidth(1.1);cv.line(x-3,H-y-3,x+3,H-y+3);cv.line(x-3,H-y+3,x+3,H-y-3)
 cv.save();overlay=PdfReader(BytesIO(buf.getvalue()))
 base=PdfReader(source).pages[0];base.merge_page(overlay.pages[0]);writer=PdfWriter();writer.add_page(base)
 path=out/('legacy-'+c['name']+'-digital.pdf');writer.write(path)
 pdf=pdfium.PdfDocument(path);bitmap=pdf[0].render(scale=3);image=bitmap.to_pil().convert('RGB');image.save(out/('legacy-'+c['name']+'-preview.png'))
 if c['name']=='B':
  image.resize((1440,1728)).save(out/'legacy-B-scan.pdf','PDF',resolution=144)
  skew=image.resize((1440,1728)).rotate(.8,resample=Image.Resampling.BICUBIC,expand=False,fillcolor='white')
  skew.save(out/'legacy-B-skew.pdf','PDF',resolution=144)
writer=PdfWriter();writer.add_page(PdfReader(source).pages[0]);writer.write(out/'legacy-blank.pdf')
(out/'expected.json').write_text(json.dumps(cases,indent=2))
