import sys, pathlib, unittest
import numpy as np, cv2
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from read_checkboxes import classify_inner,read_options
class CheckboxTests(unittest.TestCase):
 def test_blank_and_cross(self):
  blank=np.full((40,40),255,np.uint8)
  self.assertEqual(classify_inner(blank)[0],'unselected')
  crossed=blank.copy()
  cv2.line(crossed,(6,6),(34,34),0,3);cv2.line(crossed,(6,34),(34,6),0,3)
  self.assertEqual(classify_inner(crossed)[0],'selected')
 def test_single_stray_stroke_needs_review(self):
  im=np.full((40,40),255,np.uint8);cv2.line(im,(5,5),(35,35),0,3)
  self.assertEqual(classify_inner(im)[0],'uncertain')
 def test_printed_cross_outside_empty_box_does_not_select(self):
  im=np.full((1000,1000),255,np.uint8);cv2.rectangle(im,(200,200),(223,223),0,2)
  cv2.putText(im,'X',(245,223),cv2.FONT_HERSHEY_SIMPLEX,1,0,2)
  job={'page':1,'label':'Test','options':[{'label':'A','bbox':{'x0':200,'y0':200,'x1':223,'y1':223}}]}
  self.assertEqual(read_options(im,[job])[0]['options'][0]['state'],'unselected')
 def test_missing_border_is_not_a_blank_box(self):
  im=np.full((1000,1000),255,np.uint8)
  job={'page':1,'label':'Test','options':[{'label':'A','bbox':{'x0':200,'y0':200,'x1':223,'y1':223}}]}
  self.assertEqual(read_options(im,[job])[0]['options'][0]['state'],'uncertain')
if __name__=='__main__':unittest.main()
