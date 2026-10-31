import sys, json, pathlib
import pypdfium2 as pdfium
import cv2
import numpy as np
from PIL import Image

def straighten(image):
    gray=np.array(image.convert('L'))
    lines=cv2.HoughLinesP(cv2.Canny(gray,80,180),1,np.pi/1800,threshold=100,minLineLength=gray.shape[1]*.35,maxLineGap=20)
    angles=[]
    for x0,y0,x1,y1 in (lines.reshape(-1,4) if lines is not None else []):
        if x1==x0:continue
        angle=float(np.degrees(np.arctan((int(y1)-int(y0))/(int(x1)-int(x0)))))
        if abs(angle)<3:angles.append(angle)
    angle=float(np.median(angles)) if len(angles)>=4 else 0
    if .35<abs(angle)<3:return image.rotate(angle,resample=Image.Resampling.BICUBIC,expand=False,fillcolor='white'),angle
    return image,0

source, destination = sys.argv[1:3]
folder = pathlib.Path(destination)
pdf = pdfium.PdfDocument(source)
if len(pdf) == 0:
    raise ValueError('The PDF has no pages.')
if len(pdf) > 30:
    raise ValueError('Please upload a PDF with 30 pages or fewer.')
pages = []
for index in range(len(pdf)):
    page = pdf[index]
    width, height = page.get_size()
    scale = min(4.0, 3300 / max(width, height))
    bitmap = page.render(scale=scale)
    image = bitmap.to_pil()
    image,rotation=straighten(image)
    image.save(folder / f'page-{index + 1}.png')
    textpage = page.get_textpage()
    text = textpage.get_text_range()
    pages.append({'number': index + 1, 'width': image.width, 'height': image.height, 'embeddedText': text,'rotationDegrees':rotation})
    textpage.close()
    bitmap.close()
    page.close()
pdf.close()
(folder / 'pages.json').write_text(json.dumps(pages), encoding='utf-8')
