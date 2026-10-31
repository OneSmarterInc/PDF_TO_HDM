import sys,pathlib,unittest
import cv2,numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from crop_evidence import optional_cell_blank
class BlankEvidenceTests(unittest.TestCase):
 def test_blank_and_small_print_remnant(self):
  image=np.full((80,500),255,np.uint8)
  self.assertTrue(optional_cell_blank(image,8,8))
  image[40:43,100:103]=0
  self.assertTrue(optional_cell_blank(image,8,8))
 def test_entered_text_even_faint_is_not_blank(self):
  for shade in [0,180,225]:
   image=np.full((80,500),255,np.uint8);cv2.putText(image,'401.9',(30,55),cv2.FONT_HERSHEY_SIMPLEX,1.5,shade,2)
   self.assertFalse(optional_cell_blank(image,8,8))
 def test_faint_stroke_touching_edges_is_not_background(self):
  image=np.full((80,500),255,np.uint8);image[:,50:53]=220
  self.assertFalse(optional_cell_blank(image,8,8))
 def test_broad_gray_background_is_not_entered_text(self):
  image=np.full((80,500),220,np.uint8)
  self.assertTrue(optional_cell_blank(image,8,8))
 def test_pale_triangle_remnant_but_not_faint_letter(self):
  image=np.full((92,636),255,np.uint8);cv2.fillPoly(image,[np.array([[100,49],[100,89],[140,89]])],200)
  self.assertTrue(optional_cell_blank(image,7.63,7.63))
  for text in ['A','4','7','V70.0']:
   image=np.full((92,636),255,np.uint8);cv2.putText(image,text,(100,75),cv2.FONT_HERSHEY_SIMPLEX,1.5,200,3)
   self.assertFalse(optional_cell_blank(image,7.63,7.63))
