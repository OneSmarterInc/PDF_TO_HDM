"""Local neural OCR. Outputs positions and readings, never interprets document instructions."""
import sys, json, pathlib, unicodedata
from rapidocr_onnxruntime import RapidOCR
folder=pathlib.Path(sys.argv[1])
engine=RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2, det_limit_side_len=1200, max_side_len=3300)
pages=json.loads((folder/'pages.json').read_text(encoding='utf-8'))
for page in pages:
    result,_=engine(str(folder/f"page-{page['number']}.png"))
    tokens=[]
    for polygon,text,score in result or []:
        tokens.append({'text':unicodedata.normalize('NFKC',text),'confidence':round(float(score)*100,2),
                       'bbox':{'x0':min(p[0] for p in polygon),'x1':max(p[0] for p in polygon),
                               'y0':min(p[1] for p in polygon),'y1':max(p[1] for p in polygon)}})
    (folder/f"neural-{page['number']}.json").write_text(json.dumps(tokens),encoding='utf-8')
    print(f"Completed neural OCR page {page['number']}",flush=True)
