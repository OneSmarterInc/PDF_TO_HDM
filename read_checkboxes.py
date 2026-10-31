"""Read marks inside located checkbox borders; page text never determines selection."""
import json,sys,pathlib
import cv2
import numpy as np

def classify_inner(inner):
    ink=(inner<160).astype(np.uint8)
    density=float(ink.mean())
    if density<.045:return 'unselected',density
    h,w=ink.shape
    lines=cv2.HoughLinesP(ink*255,1,np.pi/180,threshold=max(4,int(min(h,w)*.22)),minLineLength=max(5,int(min(h,w)*.42)),maxLineGap=3)
    slopes=[]
    for x0,y0,x1,y1 in (lines.reshape(-1,4) if lines is not None else []):
        dx=int(x1)-int(x0);dy=int(y1)-int(y0)
        if abs(dx)>2 and .35<abs(dy/dx)<3:slopes.append(dy/dx)
    crossed=any(s>0 for s in slopes) and any(s<0 for s in slopes)
    return ('selected' if crossed and density>.10 else 'uncertain'),density

def read_options(image,requests):
    height,width=image.shape
    ink=cv2.threshold(image,160,255,cv2.THRESH_BINARY_INV)[1]
    contours,_=cv2.findContours(ink,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
    boxes=[]
    for c in contours:
        x,y,w,h=cv2.boundingRect(c)
        if .012*width<w<.035*width and .008*height<h<.026*height and .7<w/h<1.4:boxes.append((x,y,w,h))
    output=[]
    for request in requests:
        options=[]
        for option in request['options']:
            b=option['bbox'];cx=(b['x0']+b['x1'])/2;cy=(b['y0']+b['y1'])/2
            near=[r for r in boxes if abs(r[0]+r[2]/2-cx)<width*.012 and abs(r[1]+r[3]/2-cy)<height*.009]
            if not near:
                options.append({**option,'state':'uncertain','density':None});continue
            x,y,w,h=min(near,key=lambda r:abs(r[0]+r[2]/2-cx)+abs(r[1]+r[3]/2-cy)-.04*r[2])
            inset=max(4,round(min(w,h)*.20))
            state,density=classify_inner(image[y+inset:y+h-inset,x+inset:x+w-inset])
            options.append({**option,'bbox':{'x0':x,'y0':y,'x1':x+w,'y1':y+h},'state':state,'density':round(density,4)})
        output.append({**request,'options':options})
    return output

if __name__=='__main__':
    folder=pathlib.Path(sys.argv[1]);jobs=json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'));result=[]
    for page in sorted(set(j['page'] for j in jobs)):
        image=cv2.imread(str(folder/f'page-{page}.png'),cv2.IMREAD_GRAYSCALE)
        result.extend(read_options(image,[j for j in jobs if j['page']==page]))
    pathlib.Path(sys.argv[3]).write_text(json.dumps(result),encoding='utf-8')
