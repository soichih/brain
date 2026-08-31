#!/usr/bin/env python3
"""Compare recon-all subjects against the published population averages.

Reads mean cortical thickness, per-region thickness (Desikan), and subcortical
volumes from each subject's stats/ directory, and places every value into the
age-48 centile bands stored in data/brain-norms.js (2.5/25/50/75/97.5th anchors
with linear interpolation — an approximation of the exact GAMLSS percentile,
fine for seeing where a whole distribution sits).

Usage:
  python3 compare_norms.py <subject-dir> [<subject-dir> ...]
  python3 compare_norms.py ~/freesurfer-subjects/output/brain ~/freesurfer-subjects/output/brain-fs6
"""
import json
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BAND = [("lo", 2.5), ("lin", 25), ("median", 50), ("hiin", 75), ("hi", 97.5)]


def band_pct(v, b):
    """Interpolated percentile of v against the band's age-48 anchors."""
    def at(key):
        x = b.get(key)
        return x[28] if isinstance(x, list) else x  # 28 = age 48 in the 20..80 grid
    pts = sorted({(at(k), p) for k, p in BAND})
    if v <= pts[0][0]:
        return max(0.0, 2.5 * v / pts[0][0] if pts[0][0] > 0 else 0.0)
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        if x0 <= v <= x1 and x1 > x0:
            return y0 + (y1 - y0) * (v - x0) / (x1 - x0)
    return 97.7


def parse_aparc(path):
    """(region -> ThickAvg mm, mean cortical thickness) from an aparc.stats file."""
    thick, mean_ct = {}, None
    cols = []
    with open(path) as f:
        for line in f:
            if line.startswith("# Measure Cortex, MeanThickness"):
                mean_ct = float(line.split(",")[3])
            elif line.startswith("# ColHeaders"):
                cols = line.replace("# ColHeaders ", "").split()
            elif line.startswith("#"):
                continue
            elif cols and len(line.split()) == len(cols):
                c = line.split()
                thick[c[0]] = float(c[cols.index("ThickAvg")])
    return thick, mean_ct


def parse_aseg(path):
    """Structure ('Left-Thalamus', …) -> volume (mm³) from aseg.stats table rows."""
    out = {}
    with open(path) as f:
        for line in f:
            m = re.match(r"^\s*\d+\s+\d+\s+\d+\s+(\d+\.?\d*)\s+(Left|Right)-(\S+)\s", line)
            if m:
                name = m.group(3)
                if name.endswith("-Proper"):
                    name = name[: -len("-Proper")]
                out["%s-%s" % (m.group(2), name)] = float(m.group(1))
    return out


def load(subj_dir):
    st = os.path.join(subj_dir, "stats")
    regions, mean_ct = {}, []
    for hemi in ("lh", "rh"):
        t, mc = parse_aparc(os.path.join(st, hemi + ".aparc.stats"))
        for r, v in t.items():
            regions.setdefault(r, {})[hemi] = v
        mean_ct.append(mc)
    label = os.path.basename(os.path.normpath(subj_dir))
    return label, regions, sum(mean_ct) / 2, parse_aseg(os.path.join(st, "aseg.stats"))


def main(subj_dirs):
    src = open(os.path.join(HERE, "data", "brain-norms.js")).read()
    N = json.loads(src.replace("window.BRAIN_NORMS = ", "").rstrip().rstrip(";"))
    meta = N["meta"]
    print("reference: %s — age %d, %s" % (meta["source"], meta["age"], meta["sex"]))
    print("pct~ = linear interpolation onto the published age-48 band\n")

    subjects = [load(d) for d in subj_dirs]
    fs8_label = subjects[0][0]  # first dir = the subject already in data/ (exact model percentiles)

    g = N["global"]["meanCT"]
    print("== mean cortical thickness (mm): published median %.2f ==" % (g["median"] * 1e4))
    for lab, _, mc, _ in subjects:
        print("  %-12s %6.3f%s" % (lab, mc, "  (exact model pct: %.1f)" % g["pct"] if lab == fs8_label else ""))
    print()

    # ---- per-region thickness ----
    fs8_label = subjects[0][0]
    nx = N.get("cortex", {})
    print("== cortical thickness, %d Desikan regions (mm) ==" % len(nx))
    print("  %-24s" % "region" + "".join("%14s" % s[0] for s in subjects) + "%10s" % "med@48")
    deltas = {s[0]: [] for s in subjects}
    for region, b in nx.items():
        cells, exact = [], ""
        for lab, regions, _, _ in subjects:
            v = regions.get(region, {}).get("lh") or regions.get(region, {}).get("rh")
            if v is None:
                cells.append("%14s" % "n/a")
            else:
                cells.append("%8.3f (%3.0f%%)" % (v, band_pct(v, b)))
                deltas[lab].append(v - b["median"])
        print("  %-24s" % region + "".join(cells) + "%10.2f" % b["median"])
    for lab, ds in deltas.items():
        note = " (= exact %s)" % fs8_label if lab == fs8_label else ""
        print("  --- median offset from published median, %-12s %+.3f mm%s" % (lab, statistics.median(ds), note))

    # ---- subcortical volumes ----
    ns = N.get("subcortical", {})
    pairs = [("Thalamus", "Thalamus"), ("Caudate", "Caudate"), ("Putamen", "Putamen"),
             ("Pallidum", "Pallidum"), ("Hippocampus", "Hippocampus"), ("Amygdala", "Amygdala"),
             ("Accumbens-area", "Accumbens area"), ("VentralDC", "VentralDC")]
    print("\n== subcortical volumes, per hemisphere (cm³) ==")
    print("  %-22s" % "structure" + "".join("%16s" % s[0] for s in subjects) + "%10s" % "med@48")
    for side, key in pairs:
        b = ns.get(key)
        if not b:
            continue
        for prefix, hemi in (("Left", "lh"), ("Right", "rh")):
            cells = []
            for lab, _, _, vol in subjects:
                v = vol.get("%s-%s" % (prefix, side))
                cells.append("%6.2f (%3.0f%%)" % (v / 1000, band_pct(v / 1000, b)) if v else "%16s" % "n/a")
            print("  %-16s (%s)" % (key, hemi) + "".join(cells) + "%10.2f" % b["median"])


if __name__ == "__main__":
    main(sys.argv[1:])