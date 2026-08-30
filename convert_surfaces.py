#!/usr/bin/env python3
"""Convert FreeSurfer white/pial surfaces + aparc parcellation to MZ3 meshes.

The page's FreeBrowse viewer (NiiVue) reads MZ3 natively; per-vertex RGBA from
the aparc.annot color table is baked into the file so no colormap data is needed.

Usage:
  python3 convert_surfaces.py <recon-all-subject-dir> <output-dir>

Writes <lh|rh>.<pial|white>.mz3 (gzip-compressed; the MZ3 reader inflates it).
"""
import gzip
import struct
import sys

import numpy as np
from nibabel.freesurfer import read_annot, read_geometry

ATTR_FACE, ATTR_VERT, ATTR_RGBA = 1, 2, 4


def write_mz3(path, verts, faces, rgba):
    """verts float32 (n,3) mm, faces uint32 (m,3) 0-based, rgba uint8 (n,4)."""
    nvert, nface = len(verts), len(faces)
    attr = ATTR_FACE | ATTR_VERT | ATTR_RGBA
    header = struct.pack("<HHIII", 23117, attr, nface, nvert, 0)  # magic, attrib, nface, nvert, skip
    with gzip.open(path, "wb") as f:
        f.write(header)
        f.write(np.ascontiguousarray(faces, dtype=np.uint32).tobytes())
        f.write(np.ascontiguousarray(verts, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(rgba, dtype=np.uint8).tobytes())
    print("wrote", path)


def build(subject_dir, out_dir, hemi, surf):
    surf_path = f"{subject_dir}/surf/{hemi}.{surf}"
    verts, faces = read_geometry(surf_path)
    verts = np.asarray(verts, dtype=np.float32)
    labels, ctab, names = read_annot(f"{subject_dir}/label/{hemi}.aparc.annot")
    ctab = ctab[:, :4]  # some annot color tables carry a 5th (id) column

    rgba = ctab[labels]  # (n,4) uint8
    # unknown (label 0) -> light gray, keep some visibility
    rgba[labels == 0] = np.array([150, 150, 150, 255], dtype=np.uint8)

    write_mz3(f"{out_dir}/{hemi}.{surf}.mz3", verts, faces.astype(np.uint32), rgba)
    n_unknown = (labels == 0).sum()
    if n_unknown:
        print(f"  note: {n_unknown} vertices labeled 'unknown' in {hemi}")


def main(src, out_dir):
    for hemi in ("lh", "rh"):
        for surf in ("pial", "white"):
            build(src, out_dir, hemi, surf)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])