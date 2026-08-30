# brain

A live viewer for my own T1-weighted anatomical brain MRI, using the
[Papaya](https://github.com/rii-mango/Papaya) medical image viewer
(vendored `papaya.js` / `papaya.css`, "nodicom" build, BSD-licensed —
see [`LICENSE-PAPAYA.txt`](./LICENSE-PAPAYA.txt)).

**Live:** https://soichih.github.io/brain/

## Contents

- `index.html` — loads the Papaya viewer with `t1.nii.gz` and the FreeSurfer segmentation overlay
- `papaya.js`, `papaya.css` — vendored Papaya viewer (nodicom build)
- `t1.nii.gz` — my anatomical T1 MRI, NIfTI format
- `aparc+aseg.nii.gz` — FreeSurfer `aparc+aseg` label volume (int16 label ids), NIfTI
- `aparc+aseg.rgb.nii.gz` — the same labels, colorized with the FreeSurfer LUT into an
  RGB NIfTI that Papaya renders directly as the overlay in `index.html`
- `FreeSurferColorLUT.txt` — label index → structure name / color, from FreeSurfer 8.2.0
- `convert_freesurfer.py` — the script that produced the two `aparc+aseg` NIfTIs
  (reads a FreeSurfer subject's `mri/aparc+aseg.mgz`)

The segmentation was produced with [FreeSurfer](https://surfer.nmr.mgh.harvard.edu/)
8.2.0 via `recon-all -all` on the T1 above (run in Docker on my home server).

## Note

This is my own scan, shared publicly for fun/curiosity. It has been defaced
(brain-extracted) — the skull and face are removed, so no facial features are
visible in the volume. This is not a clinical tool ("THIS PRODUCT IS NOT FOR
CLINICAL USE" per the Papaya license).

More about me: [hayashi.in](https://hayashi.in)
