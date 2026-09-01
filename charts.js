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
  /* one-line "what it does / what higher-lower volume might mean" per structure.
     associations are from population studies — small effects, not diagnostic of anything. */
  var SUBCORTICAL_DESC = {
    "Thalamus": "The brain's relay hub — routes sensory and motor signals to the cortex and gates attention and sleep. Higher: often tracks overall brain size. Lower: reported in ADHD, multiple sclerosis, and normal aging.",
    "Caudate": "Basal-ganglia structure for habit and skill learning, action selection, and linking motivation to movement. Higher: linked to goal-directed drive. Lower: reported in OCD, ADHD, and Parkinson's.",
    "Putamen": "Basal-ganglia workhorse for initiating and smoothing movement, habit formation, and motor learning. Higher: generally follows overall size. Lower: an early radiological signature of Parkinson's disease.",
    "Pallidum": "The basal ganglia's output gate — filters the movement commands assembled by caudate and putamen. Higher: little behavioral signal on its own. Lower: hallmark of parkinsonism and some dystonias.",
    "Hippocampus": "Builds new long-term memories and encodes spatial maps; one of few regions that grows new neurons in adults. Higher: linked to aerobic fitness and better recall. Lower: strongly age-sensitive; shrinks in Alzheimer's and chronic stress.",
    "Amygdala": "Tags what matters emotionally — threat, fear, reward — and stamps memories with feeling. Higher: reported with anxiety traits. Lower: associated with blunted threat responses and bipolar disorder.",
    "Accumbens area": "Reward center where motivation becomes action — dopamine-driven wanting and reinforcement learning. Higher: tied to reward sensitivity. Lower: linked to apathy and loss of pleasure (anhedonia).",
    "VentralDC": "Ventral diencephalon — deep midline tissue beside the hypothalamus: hormonal balance, autonomic control, feeding and sleep drives. Size differences here mostly reflect anatomy and overall brain size."
  };
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
    var maxT = 0; // mm, with headroom so the longest bar clears the badge column
    regs.forEach(function (r) { maxT = Math.max(maxT, r.lh.thickAvg, r.rh.thickAvg); });
    maxT = Math.ceil(maxT * 1.12 * 10) / 10;
    var ticks = [1, 2, 3];
    var W = 940, L = 230, R = 92, plot = W - L - R;
    var rowH = 32, barH = 10, top = 26, bottom = 26;
    var H = top + regs.length * rowH + bottom;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });

    ticks.forEach(function (t) {
      var x = L + (t / maxT) * plot;
      s.appendChild(svg("line", { x1: x, y1: top - 8, x2: x, y2: H - bottom + 4, stroke: cssVar("--grid", "#e1e0d9"), "stroke-width": 1 }));
      s.appendChild(text(x, top - 12, t + "", "axis", "middle"));
    });
    s.appendChild(text(L - 10, top - 12, "mm", "axis", "end"));

    regs.forEach(function (r, i) {
      var yc = top + i * rowH + (rowH - 2 * barH) / 2;
      var name = REGION_NAMES[r.region] || r.region;
      var norm = window.BRAIN_NORMS && window.BRAIN_NORMS.cortex &&
                 window.BRAIN_NORMS.cortex[r.region];
      s.appendChild(text(L - 10, yc + barH + 2, name, "rowlabel", "end"));
      s.appendChild(bar(L - 1, yc, Math.max((r.lh.thickAvg / maxT) * plot, 1), barH,
        cssVar("--s1", "#2a78d6"), 1,
        name + " · left: " + r.lh.thickAvg.toFixed(2) + " mm" +
        (norm ? " — " + pctlLabel(norm.l.pct) : "")));
      s.appendChild(bar(L - 1, yc + barH + 1, Math.max((r.rh.thickAvg / maxT) * plot, 1), barH,
        cssVar("--s2", "#eb6834"), 1,
        name + " · right: " + r.rh.thickAvg.toFixed(2) + " mm" +
        (norm ? " — " + pctlLabel(norm.r.pct) : "")));
      if (norm) {
        // percentile badges to the right of the row
        s.appendChild(text(L + plot - 6, yc + barH, "L " + pctlLabel(norm.l.pct), "axis", "end"));
        s.appendChild(text(L + plot - 6, yc + 2 * barH + 6, "R " + pctlLabel(norm.r.pct), "axis", "end"));
      }
    });
    s.appendChild(svg("line", { x1: L - 1, y1: top - 6, x2: L - 1, y2: top + regs.length * rowH, stroke: cssVar("--baseline", "#c3c2b7"), "stroke-width": 1 }));
    document.getElementById("chart-cortex").appendChild(s);

    addLegend("legend-cortex", [
      ["left hemisphere", cssVar("--s1", "#2a78d6")],
      ["right hemisphere", cssVar("--s2", "#eb6834")],
    ]);
  })();

  /* ---------------- what each cortical region does ---------------- */
  // Desikan atlas, 34 regions. Associations are population-level and small —
  // regional thickness in a healthy scan is mostly anatomy and heredity.
  var CORTEX_DESC = {
    bankssts: "Multimodal junction at the back of the superior temporal sulcus — blends auditory, visual, and social cues (voices, biological motion). Thinner: linked to dyslexia and voice-recognition difficulty. Thicker: rarely abnormal on its own.",
    caudalanteriorcingulate: "Affective–autonomic part of the cingulate — conflict monitoring, pain, adjusting heart rate and breathing. Thinner: reported in depression and anxiety.",
    caudalmiddlefrontal: "Dorsolateral prefrontal cortex — working memory, planning, self-control; the brain's executive desk. Thinner: seen in ADHD and schizophrenia. Thicker: generally favorable in aging studies.",
    cuneus: "Early visual cortex on the medial surface — basic visual features and the visual periphery. Thickness here mostly mirrors the shape of the fold; deviations are rarely meaningful.",
    entorhinal: "The gateway between the hippocampus and the rest of the cortex — where memories enter long-term storage. Thinner: the earliest consistent MRI sign of Alzheimer's disease.",
    fusiform: "Face and object recognition (the 'fusiform face area'), plus word recognition after literacy. Thinner: linked to prosopagnosia (face blindness). Thicker: sometimes reported in autism research.",
    inferiorparietal: "A crossroads for attention, number, language, and self/other perspective-taking. Thinner: seen in dyscalculia and Alzheimer's. Thicker: linked to education and spatial skill.",
    inferiortemporal: "High-level visual area — recognizing objects, body parts, and faces in complex scenes. Thinner: associated with visual agnosia in dementia.",
    insula: "Interoception — sensing your own body (heartbeat, breath, gut) — plus taste, pain, and emotional salience. Thinner: linked to substance use and anxiety.",
    isthmuscingulate: "Narrow waist of the cingulate connecting emotion and memory circuits via the cingulum bundle. Thinner: reported in late-life depression and early Alzheimer's.",
    lateraloccipital: "Object-shape processing (the lateral occipital complex) — 'what is that silhouette?'. Thinner: with visual-object difficulties; otherwise largely anatomy-driven.",
    lateralorbitofrontal: "Evaluates punishment, social rules, and impulse inhibition. Thinner: linked to disinhibition and antisocial traits.",
    lingual: "Early visual area for color, letters, and reading. Thinner: reported in reading disability and some migraine-visual changes.",
    medialorbitofrontal: "The reward-and-value center of the decision loop — what feels good and is worth doing. Thinner: strongly associated with depression.",
    middletemporal: "Motion-detection area (V5/MT), plus word-form and semantic processing. Thinner: with motion-perception deficits; otherwise subtle.",
    parahippocampal: "Contextual memory — tags places and scenes so the hippocampus can store them. Thinner: an early Alzheimer's signal.",
    paracentral: "Primary motor/sensory strip for the legs and feet. Tracks the rest of the motor strip; deviations here are rarely behavioral.",
    parsopercularis: "Inferior frontal (Broca's) area — articulating speech and syntax production. Thinner: reported in stuttering and language disorders.",
    parsorbitalis: "Inferior frontal cortex above the orbit — stopping impulses and emotional control of speech. Thinner: linked to disinhibition and substance use.",
    parstriangularis: "The other half of Broca's area — combining words into meaning, semantic selection. Thinner: seen in aphasia and dyslexia.",
    pericalcarine: "Primary visual cortex (V1, along the calcarine sulcus). Normally the thinnest cortex in the brain — ~1.5 mm here is expected, not a red flag.",
    postcentral: "Primary somatosensory cortex — touch, pressure, and body position across the whole body surface. Thinner: with dulled sensation; mostly mirrors hand/mouth representation size.",
    posteriorcingulate: "Default-mode hub — self-referential thought and memory retrieval; among the brain's most metabolically active areas. Thinner: a hallmark of early Alzheimer's.",
    precentral: "Primary motor cortex — every voluntary movement starts here. Thinner: with aging and motor change. Thicker: linked to motor training.",
    precuneus: "Medial-parietal hub of the default-mode network — autobiographical memory, self-reflection, visuospatial imagery. Thinner: in cognitive decline.",
    rostralanteriorcingulate: "Front-most cingulate — emotion regulation, conflict resolution, motivation. Thinner: associated with depression, ADHD, and apathy.",
    rostralmiddlefrontal: "Anterior dorsolateral prefrontal cortex — flexible thinking, strategy switching, working memory. Thinner: in schizophrenia and executive dysfunction.",
    superiorfrontal: "Medial superior frontal — motivation, initiative, and motor planning (the SMA). Thinner bilaterally: linked to apathy.",
    superiorparietal: "Spatial attention and reaching — where your body is relative to objects. Thinner: with visuospatial decline.",
    superiortemporal: "Auditory cortex and speech perception (right side: voices and social sounds). Thinner: reported in schizophrenia and hearing-related decline.",
    supramarginal: "Phonology and empathy hub — mapping sounds to letters, sensing others' states. Thinner: in dyslexia and empathic deficits.",
    frontalpole: "The very front of the brain — planning multi-step goals, introspection, imagining the future. Thinner: with aging and executive decline.",
    temporalpole: "Anterior temporal — semantic and social memory, recognizing familiar people. Thinner: in frontotemporal dementia and semantic impairment.",
    transversetemporal: "Primary auditory cortex (Heschl's gyrus) — the first cortical stop for sound. Thickness here is notably heritable.",
  };

  /* ---------------- cortex thickness vs. population ---------------- */
  (function cortexNorms() {
    var N = window.BRAIN_NORMS;
    if (!N || !N.cortex) return;
    var surf = cssVar("--surface", "#fcfcfb");
    var keys = Object.keys(N.cortex).sort();
    var el = document.getElementById("chart-cortex-norms");
    if (!el) return;

    var lo = 10, hi = 0;
    keys.forEach(function (k) {
      var n = N.cortex[k];
      lo = Math.min(lo, n.lo, n.l.user, n.r.user);
      hi = Math.max(hi, n.hi, n.l.user, n.r.user);
    });
    lo = Math.floor((lo - 0.08) * 20) / 20;
    hi = Math.ceil((hi + 0.08) * 20) / 20;

    var W = 940, L = 185, R = 120;
    var plot = W - L - R;
    var rowH = 21, top = 30, bottom = 28;
    var H = top + keys.length * rowH + bottom;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });
    function X(v) { return L + ((v - lo) / (hi - lo)) * plot; }

    niceTicks(lo, hi, 8).forEach(function (t) {
      var x = X(t);
      s.appendChild(svg("line", { x1: x, y1: top - 10, x2: x, y2: H - bottom + 4, stroke: cssVar("--grid", "#e1e0d9"), "stroke-width": 1 }));
      s.appendChild(svg("line", { x1: x, y1: top - 4, x2: x, y2: top - 10, stroke: cssVar("--baseline", "#c3c2b7"), "stroke-width": 1 }));
      s.appendChild(text(x, top - 14, t.toFixed(1), "axis", "middle"));
    });
    s.appendChild(text(W - R + 6, top - 14, "mm", "axis", "start"));

    keys.forEach(function (k, i) {
      var n = N.cortex[k];
      var name = REGION_NAMES[k] || k;
      var yc = top + i * rowH + (rowH - 12) / 2;
      var tip = name + " (population, " + N.meta.age + "-year-old " + N.meta.sex + ")\n" +
        "band 2.5–97.5: " + n.lo.toFixed(2) + "–" + n.hi.toFixed(2) + " mm · median " + n.median.toFixed(2) + " mm\n" +
        "me, left: " + n.l.user.toFixed(2) + " mm — " + percentiles(n.l.pct).label +
        "\nme, right: " + n.r.user.toFixed(2) + " mm — " + percentiles(n.r.pct).label;
      // population bands
      s.appendChild(svg("rect", { x: X(n.lo), y: yc, width: X(n.hi) - X(n.lo), height: 12, rx: 3, fill: cssVar("--band", "#eef0f8") }));
      s.appendChild(svg("rect", { x: X(n.lin), y: yc, width: X(n.hiin) - X(n.lin), height: 12, rx: 3, fill: cssVar("--bandin", "#dfe3f2") }));
      s.appendChild(svg("line", { x1: X(n.median), y1: yc - 2, x2: X(n.median), y2: yc + 14, stroke: cssVar("--median", "#6d76a8"), "stroke-width": 2 }));
      // me: left + right dots (ring in surface color so overlapping dots stay separable)
      s.appendChild(svg("circle", { cx: X(n.l.user), cy: yc + 3, r: 4.5, fill: cssVar("--s1", "#2a78d6"), stroke: surf, "stroke-width": 2 }));
      s.appendChild(svg("circle", { cx: X(n.r.user), cy: yc + 9, r: 4.5, fill: cssVar("--s2", "#eb6834"), stroke: surf, "stroke-width": 2 }));
      // labels + hit area
      var lbl = text(L - 8, yc + 10, name, "rowlabel", "end");
      var ttl = svg("title", {});
      ttl.textContent = tip + "\n\n" + (CORTEX_DESC[k] || "");
      lbl.appendChild(ttl);
      s.appendChild(lbl);
      var hit = svg("rect", { x: L, y: top + i * rowH, width: plot, height: rowH, fill: "transparent" });
      var httl = svg("title", {});
      httl.textContent = tip + "\n\n" + (CORTEX_DESC[k] || "");
      hit.appendChild(httl);
      s.appendChild(hit);
      // short percentile badges on the right
      s.appendChild(text(W - R + 6, yc + 6, "L " + pctlLabel(n.l.pct).replace(" pct", ""), "axis", "end"));
      s.appendChild(text(W - R + 6, yc + 14, "R " + pctlLabel(n.r.pct).replace(" pct", ""), "axis", "end"));
    });
    s.appendChild(svg("line", { x1: L - 1, y1: top - 6, x2: L - 1, y2: top + keys.length * rowH, stroke: cssVar("--baseline", "#c3c2b7"), "stroke-width": 1 }));
    el.appendChild(s);

    addLegend("legend-cortex-norms", [
      ["2.5–97.5th centile band", cssVar("--band", "#eef0f8")],
      ["25–75th centile band", cssVar("--bandin", "#dfe3f2")],
      ["population median", cssVar("--median", "#6d76a8")],
      ["me, left hemisphere", cssVar("--s1", "#2a78d6")],
      ["me, right hemisphere", cssVar("--s2", "#eb6834")],
    ]);

    // "what each region does" table
    var tb = document.getElementById("cortex-desc");
    if (tb) {
      var html = "<thead><tr><th>Region</th><th>What it does · what thinner/thicker might mean</th></tr></thead><tbody>";
      keys.forEach(function (k) {
        html += "<tr><td>" + (REGION_NAMES[k] || k) + "</td><td>" + (CORTEX_DESC[k] || "") + "</td></tr>";
      });
      tb.innerHTML = html + "</tbody>";
    }
  })();

  /* ---------------- population-norms centile panels (shared) ---------------- */
  /* entries: [{ name, badge, norm:{ages,lo,lin,med,hiin,hi,median}, users:[{v,color,label}] }] */
  function centileGrid(containerId, entries, cols, PW, PH) {
    var N = window.BRAIN_NORMS;
    if (!N) return;
    var M = { l: 46, r: 14, t: 30, b: 26 };
    var rows = Math.ceil(entries.length / cols);
    var s = svg("svg", { viewBox: "0 0 " + (cols * PW) + " " + (rows * PH), role: "img" });

    entries.forEach(function (e, idx) {
      var x0 = (idx % cols) * PW, y0 = Math.floor(idx / cols) * PH;
      var n = e.norm;
      if (!n || !n.ages) return;
      // a panel with a description grows taller on top to make room for the note
      var descLines = [];
      if (e.desc) {
        var words = e.desc.split(" ");
        descLines = [""];
        words.forEach(function (w) {
          if ((descLines[descLines.length - 1] + " " + w).trim().length > 78) descLines.push(w);
          else descLines[descLines.length - 1] = (descLines[descLines.length - 1] + " " + w).trim();
        });
        descLines = descLines.slice(0, 3);
      }
      var mt = M.t + (descLines.length ? descLines.length * 11 + 8 : 0);
      var pw = PW - M.l - M.r, ph = PH - mt - M.b;
      var ymax = Math.max.apply(null, n.hi.concat(e.users.map(function (u) { return u.v; }))) * 1.06;
      var ymin = Math.min.apply(null, n.lo.concat(e.users.map(function (u) { return u.v; }))) * 0.9;
      function X(a) { return x0 + M.l + ((a - n.ages[0]) / (n.ages[n.ages.length - 1] - n.ages[0])) * pw; }
      function Y(v) { return y0 + mt + ph - ((v - ymin) / (ymax - ymin)) * ph; }

      function poly(aCol, bCol, fill) {
        var d = "M";
        aCol.forEach(function (v, i) { d += X(n.ages[i]) + " " + Y(v) + (i && i < aCol.length - 1 ? " L" : " "); });
        for (var i2 = bCol.length - 1; i2 >= 0; i2--) { d += " L" + X(n.ages[i2]) + " " + Y(bCol[i2]); }
        return svg("path", { d: d + " z", fill: fill });
      }

      s.appendChild(svg("rect", { x: x0 + 8, y: y0 + 8, width: PW - 16, height: PH - 16, rx: 8,
        fill: "none", stroke: cssVar("--border", "#ddd"), "stroke-width": 1 }));
      s.appendChild(text(x0 + M.l, y0 + 20, e.name + (e.unit ? " (" + e.unit + ")" : ""), "rowlabel"));
      s.appendChild(text(x0 + PW - M.r, y0 + 20, e.badge || "", "axis", "end"));
      descLines.forEach(function (ln, li) {
        s.appendChild(text(x0 + M.l, y0 + 31 + li * 11, ln, "rowdesc"));
      });
      s.appendChild(text(x0 + M.l, y0 + PH - 8, "age " + n.ages[0] + " → " + n.ages[n.ages.length - 1], "axis"));

      // y gridlines (drawn under the data)
      var tk = niceTicks(ymin, ymax, 3);
      var step = tk.length > 1 ? tk[1] - tk[0] : 1;
      var digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
      tk.forEach(function (v) {
        var yv = Y(v);
        s.appendChild(svg("line", { x1: x0 + M.l, y1: yv, x2: x0 + PW - M.r, y2: yv,
          stroke: cssVar("--grid", "#e1e0d9"), "stroke-width": 1 }));
        s.appendChild(text(x0 + M.l - 6, yv + 3, fmt(v, digits), "axis", "end"));
      });

      s.appendChild(poly(n.lo, n.hi, cssVar("--band", "#eef0f8")));
      s.appendChild(poly(n.lin, n.hiin, cssVar("--bandin", "#dfe3f2")));
      var dmed = "";
      n.med.forEach(function (v, i) { dmed += (i ? " L" : "M") + X(n.ages[i]) + " " + Y(v); });
      s.appendChild(svg("path", { d: dmed, fill: "none", stroke: cssVar("--median", "#6d76a8"), "stroke-width": 2 }));

      // user dots: vertical line at their age, one dot per user
      if (e.users.length) {
        var ua = N.meta.age, ux = X(ua);
        s.appendChild(svg("line", { x1: ux, y1: y0 + mt, x2: ux, y2: y0 + mt + ph,
          stroke: e.users[0].color, "stroke-width": 1, "stroke-dasharray": "2 3" }));
        e.users.forEach(function (u) {
          s.appendChild(svg("circle", { cx: ux, cy: Y(u.v), r: 5, fill: u.color,
            stroke: cssVar("--surface", "#fff"), "stroke-width": 2 }));
          var dot = svg("circle", { cx: 0, cy: 0, r: 14, fill: "transparent" });
          dot.setAttribute("cx", ux); dot.setAttribute("cy", Y(u.v));
          var ti = svg("title", {});
          ti.textContent = e.name + (u.label ? " · " + u.label : "") + ": " + fmt(u.v, 1) +
            " " + (e.unit || "cm³") + " · " + u.pctl +
            " · population median: " + fmt(n.median, 0) + " " + (e.unit || "cm³") +
            (e.desc ? "\n" + e.desc : "");
          dot.appendChild(ti);
          s.appendChild(dot);
        });
      }
    });
    document.getElementById(containerId).appendChild(s);
  }

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

    centileGrid("chart-comp-norms", PANELS.map(function (p) {
      return {
        name: p.name,
        unit: "cm³",
        badge: p.norm && p.norm.pct != null ? "you: " + pctlLabel(p.norm.pct) : "",
        norm: p.norm,
        users: p.norm && p.norm.pct != null
          ? [{ v: p.user, pctl: pctlLabel(p.norm.pct), color: cssVar("--s1", "#2a78d6") }]
          : [],
      };
    }), 2, 452, 190);

    addLegend("legend-comp-norms", [
      ["2.5–97.5th centile band", cssVar("--band", "#eef0f8")],
      ["25–75th centile band", cssVar("--bandin", "#dfe3f2")],
      ["population median", cssVar("--median", "#6d76a8")],
      ["me, at age " + N.meta.age, cssVar("--s1", "#2a78d6")],
    ]);
  })();

  /* ---------------- subcortical vs. population norms ---------------- */
  (function subNorms() {
    var N = window.BRAIN_NORMS;
    if (!N || !N.subcortical) return;
    var WANT = ["Thalamus", "Caudate", "Putamen", "Pallidum", "Hippocampus",
                "Amygdala", "Accumbens area", "VentralDC"];
    var NICE = { VentralDC: "Ventral diencephalon", "Accumbens area": "Nucleus accumbens" };

    var entries = [];
    WANT.forEach(function (k) {
      var n = N.subcortical[k];
      if (!n || !n.ages) return;
      entries.push({
        name: NICE[k] || k,
        unit: "cm³",
        desc: SUBCORTICAL_DESC[k],
        badge: "you: L " + pctlLabel(n.l.pct) + " · R " + pctlLabel(n.r.pct),
        norm: n,
        users: [
          { v: n.l.user, pctl: pctlLabel(n.l.pct), label: "left", color: cssVar("--s1", "#2a78d6") },
          { v: n.r.user, pctl: pctlLabel(n.r.pct), label: "right", color: cssVar("--s2", "#eb6834") },
        ],
      });
    });
    centileGrid("chart-sub-norms", entries, 2, 452, 215);

    addLegend("legend-sub-norms", [
      ["2.5–97.5th centile band", cssVar("--band", "#eef0f8")],
      ["25–75th centile band", cssVar("--bandin", "#dfe3f2")],
      ["population median", cssVar("--median", "#6d76a8")],
      ["me, left hemisphere", cssVar("--s1", "#2a78d6")],
      ["me, right hemisphere", cssVar("--s2", "#eb6834")],
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