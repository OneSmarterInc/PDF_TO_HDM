"""Re-read disputed value cells from padded, border-cleaned crops."""

import sys,json,pathlib,unicodedata

import cv2

import numpy as np

import pypdfium2 as pdfium

from PIL import Image

from rapidocr_onnxruntime import RapidOCR
from crop_evidence import optional_cell_blank

folder=pathlib.Path(sys.argv[1]); jobs=json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))

engine=RapidOCR(intra_op_num_threads=2,inter_op_num_threads=2)

out=[]; cache={}

pdf=pdfium.PdfDocument(folder/'input.pdf')

pages=json.loads((folder/'pages.json').read_text(encoding='utf-8'))

for job in jobs:

    number=job['page']

    if number not in cache:

        cache.clear()  # Keep only one enlarged page in memory.

        page=pdf[number-1]

        page_width,page_height=page.get_size()

        bitmap=page.render(scale=min(8.0,6600/max(page.get_size())))

        rendered=bitmap.to_pil().convert('RGB')

        angle=pages[number-1].get('rotationDegrees',0)

        if angle:rendered=rendered.rotate(angle,resample=Image.Resampling.BICUBIC,expand=False,fillcolor='white')

        cache[number]=cv2.cvtColor(np.array(rendered),cv2.COLOR_RGB2BGR)

        bitmap.close();page.close()

    image=cache[number];b=job['bbox'];height,width=image.shape[:2]

    original=pages[number-1]

    x0,y0,x1,y1=[int(round(b[k]*(width/original['width'] if k.startswith('x') else height/original['height']))) for k in ['x0','y0','x1','y1']]

    crop=image[max(0,y0):min(height,y1),max(0,x0):min(width,x1)].copy()

    if crop.size==0:continue

    gray=cv2.cvtColor(crop,cv2.COLOR_BGR2GRAY)

    original_gray=gray.copy()

    ink=cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)[1]

    # Bridge small scan gaps in rules, then remove only long line segments.

    h_closed=cv2.morphologyEx(ink,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_RECT,(9,1)))

    v_closed=cv2.morphologyEx(ink,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_RECT,(1,9)))

    horizontal=cv2.morphologyEx(h_closed,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(80,int(crop.shape[1]*.5)),1)))

    vertical=cv2.morphologyEx(ink,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,max(60,int(crop.shape[0]*.95)))))

    gray[cv2.dilate(horizontal|vertical,np.ones((3,3),np.uint8))>0]=255

    # Thin printed vertical separators can be broken or shorter than the crop.

    # Limit by stroke width so digit stems are not treated as table rules.

    thin=cv2.morphologyEx(ink,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,max(30,int(crop.shape[0]*.55)))))

    cc,ll,ss,_=cv2.connectedComponentsWithStats(thin,8)

    for k in range(1,cc):

        if any(t in job['label'].lower() for t in ['charge','amount','balance','date of birth','days / units']) and ss[k,cv2.CC_STAT_WIDTH]<=max(2,round(width/page_width*.5)):

            gray[cv2.dilate((ll==k).astype(np.uint8),np.ones((1,3),np.uint8))>0]=255

    count,labels,stats,_=cv2.connectedComponentsWithStats((gray<160).astype(np.uint8),8)

    for i in range(1,count):

        if stats[i,cv2.CC_STAT_AREA]<9:gray[labels==i]=255

    points=cv2.findNonZero((gray<160).astype(np.uint8))

    blank_evidence=optional_cell_blank(gray,width/page_width,height/page_height)
    if points is not None:

        x,y,w,h=cv2.boundingRect(points);gray=gray[y:y+h,x:x+w]

    single=not any(word in job['label'].lower() for word in ['provider','facility','address','plan']) or 'NPI' in job['label']

    variants=[]

    for variant in [original_gray,gray]:

        padded=cv2.copyMakeBorder(variant,20,20,20,20,cv2.BORDER_CONSTANT,value=255)

        result,_=engine(padded,use_det=not single,use_cls=False)

        readings=[(r[0],r[1]) if single else (r[1],r[2]) for r in result or []]

        variants.append({'text':unicodedata.normalize('NFKC',' '.join(r[0] for r in readings)),

                         'confidence':min([float(r[1])*100 for r in readings],default=0)})

    crop_file=f"zoom-{number}-{job['index']}.png"

    cv2.imwrite(str(folder/crop_file),cv2.copyMakeBorder(gray,20,20,20,20,cv2.BORDER_CONSTANT,value=255))

    reading={'page':number,'index':job['index'],**variants[1],'variants':variants,'cropFile':crop_file,'single':single,'blankEvidence':bool(blank_evidence)}

    small_file='small-'+crop_file
    padded_gray=cv2.copyMakeBorder(gray,20,20,20,20,cv2.BORDER_CONSTANT,value=255)
    cv2.imwrite(str(folder/small_file),cv2.resize(padded_gray,None,fx=.5,fy=.5,interpolation=cv2.INTER_AREA))
    reading['smallCropFile']=small_file
    out.append(reading)

    print('FIELD_RESULT:'+json.dumps(reading),flush=True)

pdf.close()

pathlib.Path(sys.argv[3]).write_text(json.dumps(out),encoding='utf-8')
