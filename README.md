# brain

A self-contained report on my own brain MRI: an in-browser viewer for the scan
(overlayed with the FreeSurfer segmentation), plus charts, tables, and notes
computed from the [FreeSurfer](https://surfer.nmr.mgh.harvard.edu/) `recon-all`
analysis of the same volume.

**Live:** https://soichih.github.io/brain/

## Contents

- `index.html` — the report page: stat tiles, brain-composition bar, left/right
  subcortical volumes, a 34-region cortical-thickness butterfly chart, a full
  parcellation table, and the embedded viewer
- `freebrowse.html` — [FreeBrowse](https://freesurfer.github.io/freebrowse/)
  v2.4.7, the FreeSurfer project's web viewer (single-file serverless build,
  vendored — the page loads no external resources)
- `mri-view.nvd` — the FreeBrowse document shown in the viewer: `t1.nii.gz`
  with `aparc+aseg.nii.gz` colorized by NiiVue's `freesurfer` colormap, plus
  the parcellated `lh/rh.{pial,white}.mz3` surface meshes (hidden by default;
  volume layers and mesh layers toggle via FreeBrowse's panel tabs)
- `convert_surfaces.py` — regenerates the `.mz3` meshes from a recon-all
  subject's `surf/` and `label/` files (per-vertex parcellation colors baked
  into the MZ3 format)
- `t1.nii.gz` — my anatomical T1 MRI, NIfTI format (defaced; see Note)
- `aparc+aseg.nii.gz` — FreeSurfer `aparc+aseg` label volume (int16 label ids), NIfTI
- `aparc+aseg.rgb.nii.gz` — the same labels colorized into an RGB NIfTI
  (precomputed alternative; not currently referenced by the page)
- `FreeSurferColorLUT.txt` — label index → structure name / color, FreeSurfer 8.2.0
- `data/brain-data.js` — all statistics on the page, generated from FreeSurfer stats
- `analyze_freesurfer.py` — regenerates `data/brain-data.js` from a recon-all
  subject's `stats/` files
- `data/brain-norms.js` — population reference data: centile curves and the
  percentile of each measure against the lifespan brain-charts normative models
  (Bethlehem et al. 2022, Nature), stratified for age 48 / male
- `analyze_norms.R` — regenerates `data/brain-norms.js` from the
  [brainchart/lifespan](https://github.com/brainchart/lifespan) fitted GAMLSS
  models (see usage notes at the top of the script)
- `charts.js` — vanilla-JS/SVG renderer for the page's charts (no dependencies)
- `papaya.js`, `papaya.css` — vendored [Papaya](https://github.com/rii-mango/Papaya)
  viewer, the original viewer of this page; kept for reference, not currently loaded

## Reproducing

```
python3 analyze_freesurfer.py ~/freesurfer-subjects/output/brain data/brain-data.js
```

The segmentation was produced with FreeSurfer 8.2.0 `recon-all -all` (official
Docker image) on the T1 above, on a home server. The page is fully static —
every chart is drawn client-side from `data/brain-data.js`.

## Note

This is my own scan, shared publicly for fun/curiosity. It has been defaced
(brain-extracted) — the skull and face are removed, so no facial features are
visible in the volume. This is not a clinical tool ("THIS PRODUCT IS NOT FOR
CLINICAL USE" per the Papaya license).

More about me: [hayashi.in](https://hayashi.in)