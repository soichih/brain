#!/usr/bin/env python3
"""Convert FreeSurfer recon-all outputs into browser-friendly NIfTI files.

Reads  mri/aparc+aseg.mgz  from a FreeSurfer subject directory and writes:
  - aparc+aseg.nii.gz        plain int16 label volume
  - aparc+aseg.rgb.nii.gz    RGB volume colored with the FreeSurfer LUT
                             (Papaya renders this natively as an overlay)

Run with a python image that has nibabel + numpy, e.g.:
  docker run --rm -v <subject home>:/fs -v $(pwd):/out python:3.12 sh -c \
    "pip -q install nibabel numpy && python /out/convert_freesurfer.py"
"""

import os

import nibabel as nib
import numpy as np

FS_SUBJECT_DIR = os.environ.get("FS_SUBJECT_DIR", "/fs/output/brain")
OUT_DIR = os.environ.get("OUT_DIR", "/out")
SUBJ = os.environ.get("FS_SUBJECT", "brain")


def parse_lut(path):
    colors = {}
    with open(path) as f:
        for line in f:
            line = line[: line.find("#")] if "#" in line else line
            parts = line.split()
            if len(parts) >= 5:
                try:
                    colors[int(parts[0])] = (int(parts[2]), int(parts[3]), int(parts[4]))
                except ValueError:
                    continue
    return colors


def main():
    img = nib.load(os.path.join(FS_SUBJECT_DIR, "mri", "aparc+aseg.mgz"))
    labels = np.rint(np.asarray(img.dataobj)).astype(np.int16).squeeze()

    plain = nib.Nifti1Image(labels, img.affine)
    plain.header.set_zooms(img.header.get_zooms()[:3])
    nib.save(plain, os.path.join(OUT_DIR, "aparc+aseg.nii.gz"))

    lut = parse_lut("FreeSurferColorLUT.txt" if os.path.exists("FreeSurferColorLUT.txt")
                    else f"{OUT_DIR}/FreeSurferColorLUT.txt")

    max_label = max(max(lut.keys()), int(labels.max()))
    table = np.zeros((max_label + 1, 3), dtype=np.uint8)
    for label, color in lut.items():
        table[label] = color
    rgb = table[labels]
    # unknown/background (0) stays black so it is invisible in the overlay
    rgb[labels == 0] = 0

    colored = nib.Nifti1Image(rgb, img.affine)
    nib.save(colored, os.path.join(OUT_DIR, "aparc+aseg.rgb.nii.gz"))

    n = len(np.unique(labels)) - 1
    print(f"{SUBJ}: {labels.shape} label volume, {n} labeled structures converted")


if __name__ == "__main__":
    main()