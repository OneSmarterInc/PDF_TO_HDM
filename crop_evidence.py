import cv2
import numpy as np

def optional_cell_blank(gray,scale_x,scale_y):
    """Conservative image evidence, used only alongside OCR for optional cells."""
    points=cv2.findNonZero((gray<160).astype(np.uint8))
    if points is not None:
        _,_,w,h=cv2.boundingRect(points)
        if w>=scale_x*2 or h>=scale_y*2:return False
    cc,labels,stats,_=cv2.connectedComponentsWithStats((gray<240).astype(np.uint8),8)
    for index,(x,y,w,h,area) in enumerate(stats[1:],1):
        edges=int(x==0)+int(y==0)+int(x+w>=gray.shape[1])+int(y+h>=gray.shape[0])
        background=edges>=2 and w>gray.shape[1]*.5 and h>gray.shape[0]*.5 and area>gray.size*.25
        # Line removal may split a pale watermark into a solid triangle.
        # Require geometric shape, no holes and no dark strokes; faint letters
        # and narrow strokes still count as possible entered content.
        mask=(labels==index).astype(np.uint8)
        contours,_=cv2.findContours(mask,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
        if len(contours)==1 and w>=scale_x*4 and h>=scale_y*4 and .4<area/(w*h)<.65 and gray[labels==index].min()>=160:
            polygon=cv2.approxPolyDP(contours[0],cv2.arcLength(contours[0],True)*.02,True)
            background=background or len(polygon)==3
        if not background and h>=scale_y*2:return False
    return True
