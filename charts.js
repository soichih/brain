/* Renders the FreeSurfer report charts on index.html from window.BRAIN_DATA.
   Vanilla JS + inline SVG, no dependencies (the page must stay self-contained). */

(function () {
  "use strict";
  var D = window.BRAIN_DATA;
  var NS = "http://www.w3.org/2000/svg";
  var CSS = getComputedStyle(document.documentElement);

  function cssVar(name, fallback) {
    var v = CSS.getPropertyValue(name).trim();
    return v || fallback;
  }
  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function fmt(n, digits) {
    return n.toLocaleString("en-US", { maximumFractionDigits: digits == null ? 1 : digits });
  }
  function percentiles(p) {
    if (p == null) return { ord: null, label: "" };
    var o = p < 2.5 ? 0 : p < 25 ? 1 : p <= 75 ? 2 : p <= 97.5 ? 3 : 4;
    var r = p < 2.5 ? "below the 2.5th centile" :
            p <= 97.5 ? ordinal(Math.round(p)) + " centile" : "above the 97.5th centile";
    return { ord: o, label: r };
  }
  function niceTicks(min, max, n) {
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / n) / Math.LN10));
    var err = span / n / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var out = [];
    for (var t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) out.push(t);
    return out;
  }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function pctlLabel(p) {
    if (p == null) return "";
    var v = Math.round(p);
    if (p < 2.5) return "<2.5th pct";
    if (p > 97.5) return ">97.5th pct";
    return ordinal(v) + " pct";
  }

  /* Bar with a 4px rounded data-end, square at the baseline. dir = 1 (grows right) | -1 (grows left) */
  function bar(x, y, w, h, fill, dir, title) {
    var r = Math.min(4, w);
    var x0 = dir === 1 ? x : x - w;
    var d;
    if (dir === 1) {
      d = "M" + x0 + " " + y + " h" + (w - r) +
        " a" + r + " " + r + " 0 0 1 " + r + " " + r +
        " v" + (h - 2 * r) +
        " a" + r + " " + r + " 0 0 1 -" + r + " " + r +
        " h-" + (w - r) + " z";
    } else {
      d = "M" + (x0 + w) + " " + y + " h-" + (w - r) +
        " a" + r + " " + r + " 0 0 0 -" + r + " " + r +
        " v" + (h - 2 * r) +
        " a" + r + " " + r + " 0 0 0 " + r + " " + r +
        " h" + (w - r) + " z";
    }
    var p = svg("path", { d: d, fill: fill, class: "bar" });
    if (title) {
      var t = svg("title", {});
      t.textContent = title;
      p.appendChild(t);
    }
    return p;
  }

  function text(x, y, str, cls, anchor) {
    var t = svg("text", { x: x, y: y, class: cls, "text-anchor": anchor || "start" });
    t.textContent = str;
    return t;
  }

  function luminance(hex) {
    var c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map(function (x) { return x + x; }).join("");
    var n = parseInt(c, 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  }

  function addLegend(id, entries) {
    var lg = document.getElementById(id);
    entries.forEach(function (e) {
      var k = document.createElement("span");
      k.className = "key";
      k.innerHTML = '<span class="swatch" style="background:' + e[1] + '"></span>' + e[0];
      lg.appendChild(k);
    });
  }

  /* ---------------- meta date ---------------- */
  document.getElementById("meta-date").textContent = D.meta.generated;

  /* ---------------- KPI tiles ---------------- */
  (function kpis() {
    var g = D.global, h = D.hemis;
    var etiv = (g.eTIV || g.EstimatedTotalIntraCranialVol).value;
    var meanThick = (h.lh.meanThickness + h.rh.meanThickness) / 2;
    var pial = h.lh.pialSurfArea + h.rh.pialSurfArea;
    var tiles = [
      { label: "Intracranial volume", value: fmt(etiv / 1000, 2), unit: "L", note: "estimated (eTIV)" },
      { label: "Brain volume", value: fmt(g.BrainSegVolNotVent.value / 1000, 2), unit: "L", note: "excluding ventricles" },
      { label: "Cortical gray matter", value: fmt(g.CortexVol.value / 1000, 1), unit: "cm³", note: "both hemispheres" },
      { label: "Cerebral white matter", value: fmt(g.CerebralWhiteMatterVol.value / 1000, 1), unit: "cm³", note: "includes corpus callosum" },
      { label: "Mean cortical thickness", value: meanThick.toFixed(2), unit: "mm", note: "mean of lh/rh region means" },
      { label: "Cortical surface area", value: fmt(pial / 100, 0), unit: "cm²", note: "pial surface, folded" },
    ];
    var el = document.getElementById("kpis");
    tiles.forEach(function (t) {
      var d = document.createElement("div");
      d.className = "tile";
      d.innerHTML = '<div class="label">' + t.label + "</div>" +
        '<div class="value">' + t.value + '<span class="unit">' + t.unit + "</span></div>" +
        '<div class="note">' + t.note + "</div>";
      el.appendChild(d);
    });
  })();

  /* ---------------- composition stacked bar ---------------- */
  (function composition() {
    var g = D.global;
    function vol(name) {
      var p = D.subcorticalPairs.find(function (r) { return r.structure === name; });
      return p ? p.lh + p.rh : 0;
    }
    var sub = ["Thalamus", "Caudate", "Putamen", "Pallidum", "Hippocampus",
               "Amygdala", "Accumbens area", "VentralDC"]
      .reduce(function (a, n) { return a + vol(n); }, 0);
    var brainstem = D.subcorticalSingletons
      .filter(function (s) { return s.structure === "Brain Stem"; })
      .reduce(function (a, s) { return a + s.volume; }, 0);

    var parts = [
      { name: "Cortical gray", v: g.CortexVol.value, c: cssVar("--s1", "#2a78d6") },
      { name: "Cerebral white matter", v: g.CerebralWhiteMatterVol.value, c: cssVar("--s2", "#eb6834") },
      { name: "Cerebellum", v: vol("Cerebellum Cortex") + vol("Cerebellum White Matter"), c: cssVar("--s3", "#1baf7a") },
      { name: "Subcortical gray", v: sub, c: cssVar("--s4", "#eda100") },
      { name: "Brainstem", v: brainstem, c: cssVar("--s5", "#e87ba4") },
    ];
    var total = parts.reduce(function (a, p) { return a + p.v; }, 0);

    var W = 900, H = 64, barY = 18, barH = 26, gap = 2;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });
    var xx = 10;
    parts.forEach(function (p) {
      var w = (p.v / total) * (W - 20);
      var show = Math.round((p.v / total) * 100) + "%";
      if (w > 76) {
        var t = text(xx + (w - gap) / 2, barY + barH / 2 + 4, show, "seg-label", "middle");
        t.setAttribute("fill", luminance(p.c) > 0.5 ? "#0b0b0b" : "#ffffff");
        s.appendChild(t);
      } else if (w > 34) {
        s.appendChild(text(xx + (w - gap) / 2, barY - 3, show, "val", "middle"));
      }
      s.appendChild(bar(xx, barY, Math.max(w - gap, 2), barH, p.c, 1, p.name + ": " + fmt(p.v / 1000, 1) + " cm³ (" + Math.round((p.v / total) * 100) + "%)"));
      xx += w;
    });
    document.getElementById("chart-composition").appendChild(s);

    addLegend("legend-composition", parts.map(function (p) {
      return [p.name + " · " + fmt(p.v / 1000, 1) + " cm³", p.c];
    }));
  })();

  /* ---------------- subcortical grouped bars ---------------- */
  (function subcortical() {
    var WANT = ["Thalamus", "Caudate", "Putamen", "Pallidum", "Hippocampus",
                "Amygdala", "Accumbens area", "VentralDC"];
    var NICE = { VentralDC: "Ventral diencephalon", "Accumbens area": "Nucleus accumbens" };
    var rows = D.subcorticalPairs
      .filter(function (p) { return WANT.indexOf(p.structure) >= 0; })
      .map(function (p) { return { structure: p.structure, lh: p.lh / 1000, rh: p.rh / 1000 }; });
    var max = 0;
    rows.forEach(function (r) { max = Math.max(max, r.lh, r.rh); });
    max = Math.ceil(max * 1.1); // cm³, rounded up

    var L = 150, R = 20, plot = 900 - L - R;
    var rowH = 32, barH = 10, top = 26, bottom = 26;
    var W = 900, H = top + rows.length * rowH + bottom;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });

    var nTicks = 4;
    for (var i = 1; i <= nTicks; i++) {
      var v = (max / nTicks) * i, x = L + (v / max) * plot;
      s.appendChild(svg("line", { x1: x, y1: top - 8, x2: x, y2: H - bottom + 4, stroke: cssVar("--grid", "#e1e0d9"), "stroke-width": 1 }));
      s.appendChild(text(x, top - 12, fmt(v, 0), "axis", "middle"));
    }
    s.appendChild(text(L - 10, top - 12, "cm³", "axis", "end"));

    rows.forEach(function (r, i) {
      var yc = top + i * rowH + (rowH - 2 * barH) / 2;
      var norm = window.BRAIN_NORMS && window.BRAIN_NORMS.subcortical &&
                 window.BRAIN_NORMS.subcortical[r.structure];
      s.appendChild(text(L - 10, yc + barH + 2, NICE[r.structure] || r.structure, "rowlabel", "end"));
      s.appendChild(bar(L - 1, yc, Math.max((r.lh / max) * plot, 1), barH, cssVar("--s1", "#2a78d6"), 1,
        r.structure + " · left: " + fmt(r.lh, 2) + " cm³" +
        (norm ? " — " + pctlLabel(norm.l.pct) : "")));
      s.appendChild(bar(L - 1, yc + barH + 1, Math.max((r.rh / max) * plot, 1), barH, cssVar("--s2", "#eb6834"), 1,
        r.structure + " · right: " + fmt(r.rh, 2) + " cm³" +
        (norm ? " — " + pctlLabel(norm.r.pct) : "")));
      if (norm) {
        // percentile badge to the right of the row
        s.appendChild(text(L + plot - 6, yc + barH, "L " + pctlLabel(norm.l.pct), "axis", "end"));
        s.appendChild(text(L + plot - 6, yc + 2 * barH + 6, "R " + pctlLabel(norm.r.pct), "axis", "end"));
      }
    });
    s.appendChild(svg("line", { x1: L - 1, y1: top - 6, x2: L - 1, y2: top + rows.length * rowH, stroke: cssVar("--baseline", "#c3c2b7"), "stroke-width": 1 }));
    document.getElementById("chart-subcortical").appendChild(s);

    addLegend("legend-subcortical", [
      ["left hemisphere", cssVar("--s1", "#2a78d6")],
      ["right hemisphere", cssVar("--s2", "#eb6834")],
    ]);
  })();

  /* ---------------- butterfly chart: cortical thickness ---------------- */
  var REGION_NAMES = {
    bankssts: "Banks of sup. temporal sulcus", caudalanteriorcingulate: "Caudal ant. cingulate",
    caudalmiddlefrontal: "Caudal mid. frontal", cuneus: "Cuneus", entorhinal: "Entorhinal",
    fusiform: "Fusiform", inferiorparietal: "Inferior parietal", inferiortemporal: "Inferior temporal",
    insula: "Insula", isthmuscingulate: "Isthmus cingulate", lateraloccipital: "Lateral occipital",
    lateralorbitofrontal: "Lateral orbitofrontal", lingual: "Lingual",
    medialorbitofrontal: "Medial orbitofrontal", middletemporal: "Middle temporal",
    parahippocampal: "Parahippocampal", paracentral: "Paracentral",
    parsopercularis: "Pars opercularis", parsorbitalis: "Pars orbitalis",
    parstriangularis: "Pars triangularis", pericalcarine: "Pericalcarine",
    postcentral: "Postcentral", posteriorcingulate: "Posterior cingulate",
    precentral: "Precentral", precuneus: "Precuneus",
    rostralanteriorcingulate: "Rostral ant. cingulate", rostralmiddlefrontal: "Rostral mid. frontal",
    superiorfrontal: "Superior frontal", superiorparietal: "Superior parietal",
    superiortemporal: "Superior temporal", supramarginal: "Supramarginal",
    frontalpole: "Frontal pole", temporalpole: "Temporal pole", transversetemporal: "Transverse temporal",
  };

  (function cortex() {
    var regs = D.cortex;
    var maxT = 3.6, ticks = [1, 2, 3];
    var W = 940, band = 220, pad = 16; // central label band
    var cx = W / 2, half = (W - 2 * pad - band) / 2;
    var Lc = cx - band / 2, Rc = cx + band / 2;
    var rowH = 15, top = 26, bottom = 22;
    var H = top + regs.length * rowH + bottom;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });

    ticks.forEach(function (t) {
      [Lc - (t / maxT) * half, Rc + (t / maxT) * half].forEach(function (x) {
        s.appendChild(svg("line", { x1: x, y1: top - 10, x2: x, y2: H - bottom + 4, stroke: cssVar("--grid", "#e1e0d9"), "stroke-width": 1 }));
        s.appendChild(text(x, top - 14, t + "", "axis", "middle"));
      });
    });
    s.appendChild(text(W - pad, top - 14, "mm", "axis", "end"));

    regs.forEach(function (r, i) {
      var by = top + i * rowH + (rowH - 10) / 2;
      s.appendChild(text(cx, by + 9, REGION_NAMES[r.region] || r.region, "rowlabel", "middle"));
      s.appendChild(bar(Lc, by, Math.max((r.lh.thickAvg / maxT) * (half - 4), 1), 10,
        cssVar("--s1", "#2a78d6"), -1,
        (REGION_NAMES[r.region] || r.region) + " · left: " + r.lh.thickAvg.toFixed(2) + " mm"));
      s.appendChild(bar(Rc, by, Math.max((r.rh.thickAvg / maxT) * (half - 4), 1), 10,
        cssVar("--s2", "#eb6834"), 1,
        (REGION_NAMES[r.region] || r.region) + " · right: " + r.rh.thickAvg.toFixed(2) + " mm"));
    });
    s.appendChild(svg("line", { x1: Lc, y1: top - 10, x2: Lc, y2: top + regs.length * rowH, stroke: cssVar("--baseline", "#c3c2b7"), "stroke-width": 1 }));
    document.getElementById("chart-cortex").appendChild(s);

    addLegend("legend-cortex", [
      ["left hemisphere", cssVar("--s1", "#2a78d6")],
      ["right hemisphere", cssVar("--s2", "#eb6834")],
    ]);
  })();

  /* ---------------- composition vs. population norms ---------------- */
  (function norms() {
    var N = window.BRAIN_NORMS;
    if (!N || !N.composition) return;

    var g = D.global;
    function vol(name) {
      var p = D.subcorticalPairs.find(function (r) { return r.structure === name; });
      return p ? p.lh + p.rh : 0;
    }
    var subSum = ["Thalamus", "Caudate", "Putamen", "Pallidum", "Hippocampus",
                  "Amygdala", "Accumbens area", "VentralDC"]
      .reduce(function (a, n) { return a + vol(n); }, 0);
    var vent = (g.VentricleChoroidVol ? g.VentricleChoroidVol.value : 0) / 1000;

    /* panel definitions: [key in N.composition, display name, user value in cm³] */
    var PANELS = [
      { key: "GMV", name: "Cortical gray matter", user: g.CortexVol.value / 1000 },
      { key: "WMV", name: "Cerebral white matter", user: g.CerebralWhiteMatterVol.value / 1000 },
      { key: "sGMV", name: "Subcortical gray matter", user: subSum / 1000 },
      { key: "Ventricles", name: "Ventricles + choroid", user: vent },
    ];
    PANELS.forEach(function (p) {
      var n = N.composition[p.key];
      p.norm = n;
      p.median = n && n.median != null ? n.median : null;
    });

    /* story paragraph */
    var story = document.getElementById("norms-story");
    var html = "<p class=\"sub\">";
    var bits = [];
    PANELS.forEach(function (p) {
      if (!p.norm || p.norm.pct == null) return;
      var b = percentiles(p.norm.pct);
      var vs = p.median ? " (population median " + fmt(p.median, 0) + " cm³, i.e. " +
        (p.user > p.median ? "+" : "−") + fmt(Math.abs((p.user / p.median - 1) * 100), 0) + "%)" : "";
      bits.push("<strong>" + p.name.toLowerCase() + "</strong> at the " + b.label + vs);
    });
    html += "Compared with typical " + N.meta.sex + "s of my age (" + N.meta.age + "): " +
      bits.join("; ") + ".";
    html += "</p>";
    story.innerHTML = html;

    /* small multiples: 2 × 2 centile panels */
    var PW = 452, PH = 190, M = { l: 46, r: 14, t: 30, b: 26 };
    var s = svg("svg", { viewBox: "0 0 " + (2 * PW) + " " + (2 * PH), role: "img" });

    PANELS.forEach(function (p, idx) {
      var x0 = (idx % 2) * PW, y0 = Math.floor(idx / 2) * PH;
      var n = p.norm;
      if (!n) return;
      var pw = PW - M.l - M.r, ph = PH - M.t - M.b;
      function X(a) { return x0 + M.l + ((a - n.ages[0]) / (n.ages[n.ages.length - 1] - n.ages[0])) * pw; }
      var ymax = Math.max.apply(null, n.hi.concat([p.user])) * 1.06;
      var ymin = Math.min.apply(null, n.lo.concat([p.user])) * 0.9;
      function Y(v) { return y0 + M.t + ph - ((v - ymin) / (ymax - ymin)) * ph; }

      function poly(aCol, bCol, fill) {
        var d = "M";
        aCol.forEach(function (v, i) { d += X(n.ages[i]) + " " + Y(v) + (i ? " L" : " "); });
        for (var i2 = bCol.length - 1; i2 >= 0; i2--) { d += " L" + X(n.ages[i2]) + " " + Y(bCol[i2]); }
        return svg("path", { d: d + " z", fill: fill });
      }

      s.appendChild(svg("rect", { x: x0 + 8, y: y0 + 8, width: PW - 16, height: PH - 16, rx: 8,
        fill: "none", stroke: cssVar("--border", "#ddd"), "stroke-width": 1 }));
      s.appendChild(text(x0 + M.l, y0 + 20, p.name, "rowlabel"));
      s.appendChild(text(x0 + PW - M.r, y0 + 20, p.norm.pct != null ? "you: " + pctlLabel(p.norm.pct) : "", "axis", "end"));
      s.appendChild(text(x0 + M.l, y0 + PH - 8, "age " + n.ages[0] + " → " + n.ages[n.ages.length - 1], "axis"));

      // y gridlines (drawn under the data)
      niceTicks(ymin, ymax, 3).forEach(function (v) {
        var yv = Y(v);
        s.appendChild(svg("line", { x1: x0 + M.l, y1: yv, x2: x0 + PW - M.r, y2: yv,
          stroke: cssVar("--grid", "#e1e0d9"), "stroke-width": 1 }));
        s.appendChild(text(x0 + M.l - 6, yv + 3, fmt(v, 0), "axis", "end"));
      });

      s.appendChild(poly(n.lo, n.hi, cssVar("--band", "#eef0f8")));
      s.appendChild(poly(n.lin, n.hiin, cssVar("--bandin", "#dfe3f2")));
      [2.5, 25, 97.5].forEach(function (v, i) {
        var col = n[i === 2.5 ? "lo" : i === 97.5 ? "hi" : "lin"];
        var d2 = "";
        col.forEach(function (vv, i2) { d2 += (i2 ? " L" : "M") + X(n.ages[i2]) + " " + Y(vv); });
        s.appendChild(svg("path", { d: d2, fill: "none", stroke: cssVar("--grid", "#b9c0d4"),
          "stroke-width": 1, "stroke-dasharray": "3 3" }));
      });
      var dmed = "";
      n.med.forEach(function (v, i) { dmed += (i ? " L" : "M") + X(n.ages[i]) + " " + Y(v); });
      s.appendChild(svg("path", { d: dmed, fill: "none", stroke: cssVar("--median", "#6d76a8"), "stroke-width": 2 }));

      // user dot: vertical line at their age + dot
      var ua = N.meta.age, ux = X(ua), uy = Y(p.norm.user != null ? p.norm.user : 0);
      s.appendChild(svg("line", { x1: ux, y1: y0 + M.t, x2: ux, y2: y0 + M.t + ph,
        stroke: cssVar("--s1", "#2a78d6"), "stroke-width": 1, "stroke-dasharray": "2 3" }));
      s.appendChild(svg("circle", { cx: ux, cy: uy, r: 5, fill: cssVar("--s1", "#2a78d6"),
        stroke: cssVar("--surface", "#fff"), "stroke-width": 2 }));
      var dot = svg("circle", { cx: 0, cy: 0, r: 14, fill: "transparent" });
      dot.setAttribute("cx", ux); dot.setAttribute("cy", uy);
      var ti = svg("title", {});
      ti.textContent = p.name + " · me: " + fmt(p.user, 1) + " cm³ · " + pctlLabel(p.norm.pct) +
        " · population median: " + fmt(p.median, 0) + " cm³";
      dot.appendChild(ti);
      s.appendChild(dot);
    });
    document.getElementById("chart-comp-norms").appendChild(s);

    addLegend("legend-comp-norms", [
      ["2.5–97.5th centile band", cssVar("--band", "#eef0f8")],
      ["25–75th centile band", cssVar("--bandin", "#dfe3f2")],
      ["population median", cssVar("--median", "#6d76a8")],
      ["me, at age " + N.meta.age, cssVar("--s1", "#2a78d6")],
    ]);
  })();

  /* ---------------- full cortex table ---------------- */
  (function table() {
    var t = document.getElementById("cortex-table");
    var html = "<thead><tr>" +
      ["Region", "L thick (mm)", "R thick (mm)", "Mean (mm)", "L area (cm²)", "R area (cm²)", "L vol (cm³)", "R vol (cm³)"]
        .map(function (h, i) { return '<th class="' + (i ? "num" : "") + '">' + h + "</th>"; })
        .join("") +
      "</tr></thead><tbody>";
    D.cortex.forEach(function (r) {
      html += "<tr><td>" + (REGION_NAMES[r.region] || r.region) + "</td>" +
        '<td class="num">' + r.lh.thickAvg.toFixed(2) + "</td>" +
        '<td class="num">' + r.rh.thickAvg.toFixed(2) + "</td>" +
        '<td class="num">' + r.meanThick.toFixed(2) + "</td>" +
        '<td class="num">' + (r.lh.surfArea / 100).toFixed(1) + "</td>" +
        '<td class="num">' + (r.rh.surfArea / 100).toFixed(1) + "</td>" +
        '<td class="num">' + (r.lh.grayVol / 1000).toFixed(1) + "</td>" +
        '<td class="num">' + (r.rh.grayVol / 1000).toFixed(1) + "</td></tr>";
    });
    t.innerHTML = html;
  })();

  /* ---------------- fun facts ---------------- */
  (function facts() {
    var g = D.global, h = D.hemis;
    var pial = (h.lh.pialSurfArea + h.rh.pialSurfArea) / 100; // cm²
    var a4 = 623.7;
    var meanThick = (h.lh.meanThickness + h.rh.meanThickness) / 2;
    var credit = 0.76;
    var cc = D.subcorticalSingletons
      .filter(function (s) { return s.structure.indexOf("CC") === 0; })
      .reduce(function (a, s) { return a + s.volume; }, 0) / 1000;
    var vent = g.VentricleChoroidVol ? g.VentricleChoroidVol.value / 1000 : 0;

    var facts = [
      { emoji: "📄", title: fmt(pial / a4, 1) + " sheets of A4 paper",
        body: "The area of your folded pial surface (" + fmt(pial, 0) + " cm²) if you ironed the cortex flat." },
      { emoji: "💳", title: "≈ " + fmt(meanThick / credit, 1) + " credit cards",
        body: "The cortex is " + meanThick.toFixed(2) + " mm thick on average — about " + fmt(meanThick / credit, 1) + " credit cards stacked." },
      { emoji: "🥤", title: "A one-and-a-half-litre bottle",
        body: "Estimated intracranial volume is " + fmt((g.eTIV || g.EstimatedTotalIntraCranialVol).value / 1000, 2) + " L — roughly how much space is inside your skull." },
      { emoji: "🪢", title: fmt(cc, 1) + " cm³ of cable",
        body: "The corpus callosum, the highway joining your hemispheres, has " + fmt(cc, 1) + " cm³ of white matter in five segments." },
 { emoji: "💦", title: fmt((vent / (g.BrainSegVolNotVent.value / 1000)) * 100, 1) + "% fluid",
        body: "Ventricles and choroid plexus hold " + fmt(vent, 1) + " cm³ of cerebrospinal fluid — about " + fmt((vent / (g.BrainSegVolNotVent.value / 1000)) * 100, 1) + "% of the segmented brain." },
    ];
    var el = document.getElementById("facts");
    facts.forEach(function (f) {
      var d = document.createElement("div");
      d.className = "fact";
      d.innerHTML = '<div class="emoji">' + f.emoji + "</div><h3>" + f.title + "</h3><p>" + f.body + "</p>";
      el.appendChild(d);
    });
  })();
})();