# Third-party assets

## English Tesseract model

`models/eng.traineddata` is the unmodified decompressed English `4.0.0_best_int` model distributed by `@tesseract.js-data/eng@1.0.0`. Its SHA-256 was compared with that package before the repository handoff:

`5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747`

Source and model documentation: https://github.com/naptha/tessdata (gh-pages branch). Upstream distributes this trained data under Apache License 2.0; its license is included in [TESSDATA_LICENSE.txt](TESSDATA_LICENSE.txt). The npm wrapper metadata separately reports MIT. The underlying model has not been retrained or modified by this project.

## Icons and installed dependencies

Lucide icon licensing is retained in `public/icons/LICENSE`. JavaScript/Python dependencies retain their respective upstream licenses and notices in their installed distributions. This notice does not assign an open-source license to the portal's own code.
