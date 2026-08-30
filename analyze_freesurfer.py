#!/usr/bin/env python3
"""Parse FreeSurfer recon-all statistics into data for the brain viewer page.

Reads the standard stats files of a recon-all subject and writes a self-contained
JavaScript data file (data/brain-data.js) consumed by index.html. No
dependencies beyond the Python standard library.

Usage:
  python3 analyze_freesurfer.py <subject_dir> [output.js]
  (subject_dir is e.g. ~/freesurfer-subjects/output/brain, containing stats/)
"""

import json
import os
import re
import sys
from datetime import datetime, timezone


def parse_measure_lines(text):
    """Return dict shortname -> (value, units) from '# Measure a, b, c, v, u' lines."""
    measures = {}
    for m in re.finditer(r"^# Measure ([^,\n]+), ([^,\n]+), ([^,\n]+),\s*([^,\n]+),\s*([^\n]+)$",
                         text, re.MULTILINE):
        _, key, _, value, units = m.groups()
        try:
            measures[key.strip()] = {"value": float(value), "units": units.strip()}
        except ValueError:
            pass
    return measures


def parse_seg_table(text):
    """Parse the '# ColHeaders ...' aligned table at the end of a .stats file."""
    rows = []
    headers = None
    for line in text.splitlines():
        if line.startswith("# ColHeaders"):
            headers = line.split()[2:]
            continue
        if headers and line.strip() and not line.startswith("#"):
            parts = line.split()
            rows.append(dict(zip(headers, parts)))
    return rows


def num(s):
    return float(s) if s not in (None, "NA") else None


def main():
    subj = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    stats = os.path.join(subj, "stats")
    out = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else "data/brain-data.js")

    def read(name):
        with open(os.path.join(stats, name)) as f:
            return f.read()

    aseg_t = read("aseg.stats")
    lh_t = read("lh.aparc.stats")
    rh_t = read("rh.aparc.stats")
    brainvol_t = read("brainvol.stats")

    global_measures = {**parse_measure_lines(brainvol_t), **parse_measure_lines(aseg_t)}

    # hemi-level totals (white surface area, mean thickness, vertex count)
    hemis = {}
    for key, text in (("lh", lh_t), ("rh", rh_t)):
        m = parse_measure_lines(text)
        hemis[key] = {
            "numVert": (m.get("NumVert") or {}).get("value"),
            "whiteSurfArea": (m.get("WhiteSurfArea") or {}).get("value"),
            "meanThickness": (m.get("MeanThickness") or {}).get("value"),
            "pialSurfArea": None,
        }
        pial = os.path.join(stats, f"{key}.aparc.pial.stats")
        if os.path.exists(pial):
            with open(pial) as f:
                pm = parse_measure_lines(f.read())
            if "PialSurfArea" in pm:
                hemis[key]["pialSurfArea"] = pm["PialSurfArea"]["value"]

    # subcortical segmentation table
    segs = parse_seg_table(aseg_t)
    pairs, singletons = [], []
    pair_prefixes = ["Left-", "Right-"]
    skip = {"Left-vessel", "Right-vessel", "Left-choroid-plexus", "Right-choroid-plexus",
            "5th-Ventricle", "Left-WM-hypointensities", "Right-WM-hypointensities",
            "WM-hypointensities", "non-WM-hypointensities", "Left-non-WM-hypointensities",
            "Right-non-WM-hypointensities", "Optic-Chiasm", "Left-Inf-Lat-Vent",
            "Right-Inf-Lat-Vent", "CSF"}
    by_name = {r["StructName"]: num(r["Volume_mm3"]) for r in segs}
    matched = set()
    for r in segs:
        name = r["StructName"]
        if name in skip or name in matched:
            continue
        base = None
        for p in pair_prefixes:
            if name.startswith(p):
                cand = name[len(p):]
                other = ("Right-" if p == "Left-" else "Left-") + cand
                if other in by_name:
                    base = cand
                    matched.update((name, other))
                    pairs.append({
                        "structure": cand.replace("-", " "),
                        "lh": by_name[name],
                        "rh": by_name[other],
                    })
                break
        if base is None:
            singletons.append({"structure": name.replace("-", " ").replace("WM", "white matter"),
                               "volume": by_name[name]})

    # cortical parcellation tables
    def parse_aparc(text):
        rows = []
        headers = None
        for line in text.splitlines():
            if line.startswith("# ColHeaders"):
                headers = line.split()[2:]
                continue
            if headers and line.strip() and not line.startswith("#"):
                d = dict(zip(headers, line.split()))
                rows.append({
                    "region": d["StructName"],
                    "surfArea": num(d["SurfArea"]),
                    "grayVol": num(d["GrayVol"]),
                    "thickAvg": num(d["ThickAvg"]),
                    "thickStd": num(d["ThickStd"]),
                })
        return rows

    lh_cortex, rh_cortex = parse_aparc(lh_t), parse_aparc(rh_t)
    regions = []
    rh_by_name = {r["region"]: r for r in rh_cortex}
    for r in lh_cortex:
        m = rh_by_name[r["region"]]
        regions.append({
            "region": r["region"],
            "lh": r, "rh": m,
            "meanThick": (r["thickAvg"] + m["thickAvg"]) / 2.0,
        })
    regions.sort(key=lambda r: -r["meanThick"])

    data = {
        "meta": {
            "subject": os.path.basename(subj),
            "tool": "FreeSurfer recon-all 8.2.0",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "source": [f"stats/{n}" for n in
                       sorted(os.listdir(stats)) if n.endswith(".stats")][:8],
        },
        "global": global_measures,
        "hemis": hemis,
        "subcorticalPairs": pairs,
        "subcorticalSingletons": singletons,
        "cortex": regions,
    }

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write("// Generated by analyze_freesurfer.py from FreeSurfer recon-all stats.\n")
        f.write("window.BRAIN_DATA = ")
        f.write(json.dumps(data, indent=1))
        f.write(";\n")
    print(f"wrote {out}: {len(pairs)} paired subcortical structures, "
          f"{len(singletons)} singletons, {len(regions)} cortical regions")


if __name__ == "__main__":
    main()