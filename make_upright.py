#!/usr/bin/env python3
"""Build atlas-aligned ("upright") volumes and meshes for the viewer.

recon-all handles oblique acquisitions fine (measured: ~2.4° roll, ~2.7°
pitch), but FreeBrowse's ACS slice views assume the volume axes are already
orthogonal to the anatomical planes — with a tilted acquisition, dragging in
one plane "sweeps" across the other two. FreeSurfer 8.2 does not write a
resampled talairach.mgz, so this script applies the run's own Talairach
registration, taken from mri/transforms/talairach.lta, which is stored as a
voxel-to-voxel mapping (nu.mgz -> atlas gca template) together with both
volumes' full geometry — no coordinate-convention guesswork.

Outputs (1mm, 256^3, axes = R/A/S, world = atlas RAS mm):
  t1-upright.nii.gz            trilinear-resampled conformed T1 (uint8)
  aparc+aseg-upright.nii.gz    nearest-neighbor label map (int16)
  {lh,rh}.{pial,white}-upright.mz3
      vertices moved to atlas space (topology preserved, so the aparc
      labels in data/{lh,rh}.labels.json.gz and region-picker.js apply
      unchanged)

Usage: python3 make_upright.py <recon-all-subject-dir> <output-dir>
"""
import gzip
import struct
import sys

import numpy as np
import nibabel as nib
from nibabel.freesurfer import read_geometry, read_annot

SHAPE = (256, 256, 256)


def read_lta(path):
    """Returns (M src_vox->dst_vox, nibabel affine of src, nibabel affine of dst)."""
    lines = open(path).read().splitlines()
    mi = [i for i, l in enumerate(lines) if l.strip().startswith("1 4 4")][0]
    M = np.array([[float(v) for v in lines[mi + 1 + j].split()] for j in range(4)])

    def geom(tag):
        idx = [i for i, l in enumerate(lines) if l.startswith(tag)][0]
        g = {}
        for l in lines[idx + 1:idx + 10]:
            if "=" not in l:
                break
            k, v = l.split("=", 1)
            g[k.strip()] = v.split("#")[0].strip()
        return g

    def nib_affine(g, center_mode):
        # FreeSurfer LTA voxel space treats the center voxel as dim/2 (128 for
        # 256^3); use that so the M matrix composes exactly. The 0.5 mm
        # difference vs nibabel's corner-origin convention is cosmetic here.
        A = np.eye(4)
        zoom = np.fromstring(g["voxelsize"], sep=" ")
        A[:3, 0] = np.fromstring(g["xras"], sep=" ") * zoom[0]
        A[:3, 1] = np.fromstring(g["yras"], sep=" ") * zoom[1]
        A[:3, 2] = np.fromstring(g["zras"], sep=" ") * zoom[2]
        dim = np.fromstring(g["volume"], sep=" ", dtype=float)
        center = dim / 2.0 if center_mode else (dim - 1) / 2.0
        A[:3, 3] = np.fromstring(g["cras"], sep=" ") - A[:3, :3] @ center
        return A

    return (M,
            nib_affine(geom("src volume info"), True),
            nib_affine(geom("dst volume info"), True))


def set_affine(img, A):
    """Write with an explicit affine and verify it survives the NIfTI qform/sform
    round-trip (left-handed LIA matrices do not; hence the atlas output below is
    given a plain positive-determinant voxel->world affine instead)."""
    img.set_sform(A, code=1)
    img.set_qform(np.eye(4), code=0)
    return img


OUT_AFF = np.eye(4)
OUT_AFF[:3, 3] = -np.array(SHAPE) / 2  # upright world = voxel - 128 (R/A/S axes)


def convert_volumes(subject_dir, out_dir, M, A_src, A_dst):
    # sanity: the lta's source geometry must match the volumes we resample
    assert np.allclose(A_src, nib.load(f"{subject_dir}/mri/orig.mgz").affine, atol=0.6), \
        "lta src geometry does not match orig.mgz"
    from scipy.ndimage import map_coordinates
    # The atlas gca is an LIA grid (axis0 = Left, axis1 = Inferior, axis2 =
    # Anterior per its xras/yras/zras), NOT R/A/S — every mapping must go
    # through the lta's dst geometry A_dst (dst_vox -> atlas RAS mm):
    #   world = A_dst @ (M @ src_vox) = OUT_AFF @ d
    # so src_vox = inv(M) @ inv(A_dst) @ OUT_AFF @ d. Skipping inv(A_dst)
    # renders the axial plane with coronal anatomy and vice versa.
    W = np.linalg.inv(M) @ np.linalg.inv(A_dst) @ OUT_AFF
    idx = np.indices(SHAPE, dtype=np.float64).reshape(3, -1)
    src_vox = W[:3, :3] @ idx + W[:3, 3][:, None]
    for rel, out, order in (("mri/orig.mgz", "t1-upright.nii.gz", 1),
                            ("mri/aparc+aseg.mgz", "aparc+aseg-upright.nii.gz", 0)):
        src = np.asarray(nib.load(f"{subject_dir}/{rel}").dataobj)
        data = map_coordinates(src, src_vox, order=order, mode="constant", cval=0)
        if order == 1:
            data = np.clip(np.rint(data), 0, 255).astype(np.uint8)
        else:
            data = np.rint(data).astype(np.int16)
        nib.save(set_affine(nib.Nifti1Image(data.reshape(SHAPE), OUT_AFF), OUT_AFF),
                 f"{out_dir}/{out}")
        assert np.allclose(nib.load(f"{out_dir}/{out}").affine, OUT_AFF, atol=1e-4), \
            f"affine did not round-trip for {out}"
        print("wrote", out)


def convert_meshes(subject_dir, out_dir, M, A_src, A_dst):
    # surface tkrRAS +cras -> scanner RAS -> orig voxel (orig.mgz's own affine,
    # ground-truth-verified against aparc+aseg labels) -> atlas voxel (lta M)
    # -> atlas RAS mm (the dst geometry), which is the upright volume's world
    A_orig = nib.load(f"{subject_dir}/mri/orig.mgz").affine
    T = A_dst @ M @ np.linalg.inv(A_orig)
    for hemi in ("lh", "rh"):
        labels, ctab, _ = read_annot(f"{subject_dir}/label/{hemi}.aparc.annot")
        ctab = ctab[:, :4]
        # the annot carries -1 (medial wall vertices): clip before indexing so
        # numpy's negative wrap doesn't paint them with ctab[-1]'s color
        rgba = ctab[np.clip(labels, 0, None)]
        rgba[labels <= 0] = np.array([150, 150, 150, 255], dtype=np.uint8)
        for surf in ("pial", "white"):
            verts, faces, meta = read_geometry(
                f"{subject_dir}/surf/{hemi}.{surf}", read_metadata=True)
            pts = np.asarray(verts, float) + np.asarray(meta["cras"], float)
            xyz = nib.affines.apply_affine(T, pts)
            path = f"{out_dir}/{hemi}.{surf}-upright.mz3"
            write_mz3(path, xyz.astype(np.float32), faces.astype(np.uint32), rgba)
            print("wrote", path, f"({len(xyz)} verts)")


def write_mz3(path, verts, faces, rgba):
    ATTR_FACE, ATTR_VERT, ATTR_RGBA = 1, 2, 4
    attr = ATTR_FACE | ATTR_VERT | ATTR_RGBA
    header = struct.pack("<HHIII", 23117, attr, len(faces), len(verts), 0)
    with gzip.open(path, "wb") as f:
        f.write(header)
        f.write(np.ascontiguousarray(faces, dtype=np.uint32).tobytes())
        f.write(np.ascontiguousarray(verts, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(rgba, dtype=np.uint8).tobytes())


def main(subject_dir, out_dir):
    M, A_src, A_dst = read_lta(f"{subject_dir}/mri/transforms/talairach.lta")
    print("lta (nu vox -> atlas vox):\n", np.round(M, 4))
    convert_volumes(subject_dir, out_dir, M, A_src, A_dst)
    convert_meshes(subject_dir, out_dir, M, A_src, A_dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])