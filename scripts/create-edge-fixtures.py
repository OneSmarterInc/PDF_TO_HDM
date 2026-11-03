"""Generate synthetic failure inputs only; never read private documents."""
from pathlib import Path
from pypdf import PdfWriter, PdfReader

out=Path('tmp/edge-fixtures')
out.mkdir(parents=True,exist_ok=True)
for name,count,password in [('too-many-pages',31,None),('encrypted',1,'SyntheticOnly42'),('empty',0,None)]:
    writer=PdfWriter()
    for _ in range(count): writer.add_blank_page(width=612,height=792)
    if password: writer.encrypt(password)
    writer.write(out/(name+'.pdf'))
(out/'corrupt.pdf').write_bytes(b'%PDF-1.7\nthis is not a complete PDF')
print('Created encrypted, 31-page, zero-page, and corrupt synthetic PDF fixtures.')
writer=PdfWriter()
for name in ('legacy-A-digital.pdf','legacy-B-digital.pdf'):
    for page in PdfReader(Path('test/fixtures')/name).pages: writer.add_page(page)
writer.write(out/'multi-page.pdf')
