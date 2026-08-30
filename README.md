# brain

A live viewer for my own T1-weighted anatomical brain MRI, using the
[Papaya](https://github.com/rii-mango/Papaya) medical image viewer
(vendored `papaya.js` / `papaya.css`, "nodicom" build, BSD-licensed —
see [`LICENSE-PAPAYA.txt`](./LICENSE-PAPAYA.txt)).

**Live:** https://soichih.github.io/brain/

## Contents

- `index.html` — loads the Papaya viewer against `t1.nii.gz`
- `papaya.js`, `papaya.css` — vendored Papaya viewer (nodicom build)
- `t1.nii.gz` — my anatomical T1 MRI, NIfTI format

## Note

This is my own scan, shared publicly for fun/curiosity. It has been defaced
(brain-extracted) — the skull and face are removed, so no facial features are
visible in the volume. This is not a clinical tool ("THIS PRODUCT IS NOT FOR
CLINICAL USE" per the Papaya license).

More about me: [hayashi.in](https://hayashi.in)
