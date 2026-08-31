/*
 * region-picker.js — highlight one cortical region at a time in the embedded
 * FreeBrowse viewer (see the "Explore the scan" section of index.html).
 *
 * How it works:
 *  - FreeBrowse is vendored with a one-line patch (freebrowse.html) that
 *    exposes its NiiVue instance as `window.nv`, reachable from the parent
 *    page via the iframe (same origin).
 *  - convert_surfaces.py writes data/{lh,rh}.labels.json.gz: the per-vertex
 *    Desikan parcellation (aparc.annot) plus its color table. FreeSurfer's
 *    lh/rh.white and lh/rh.pial surfaces share vertex topology, so one label
 *    array per hemisphere covers all four meshes.
 *  - Highlighting = rebuilding the mesh's per-vertex rgba255 array (the
 *    region's annot color, everything else muted) and pushing it through
 *    NiiVue's setMeshProperty(idx, "rgba255", arr). The loader forces alpha
 *    to 255, so "ghost vs isolate" is done with the muted RGB, not alpha.
 *  - "Show all" recomputes the original full-parcellation colors from the
 *    annot color table; nothing is ever read back from the GPU.
 *
 * The picker re-applies the #region=<name>[&hemi=l|r&surf=white&mode=isolate]
 * URL fragment, so a specific view can be shared.
 */
(function () {
  "use strict";

  // `id` is the mesh name from mri-view.nvd (NiiVue assigns it as mesh.id);
  // `stem` is a fallback match against the mesh URL.
  var MESHES = {
    "lh-pial":  { id: "left pial (aparc).mz3",  stem: "lh.pial.mz3",  hemi: "lh", surf: "pial",  baseOpacity: 1.0 },
    "rh-pial":  { id: "right pial (aparc).mz3", stem: "rh.pial.mz3",  hemi: "rh", surf: "pial",  baseOpacity: 1.0 },
    "lh-white": { id: "left white (aparc).mz3", stem: "lh.white.mz3", hemi: "lh", surf: "white", baseOpacity: 0.5 },
    "rh-white": { id: "right white (aparc).mz3", stem: "rh.white.mz3", hemi: "rh", surf: "white", baseOpacity: 0.5 }
  };

  var MUTED_GHOST = [150, 150, 158];   // "context" vertices in ghost mode
  var MUTED_ISOLATE = [38, 38, 44];    // "context" vertices in isolate mode

  // volume opacities matching mri-view.nvd, restored when the picker resets
  var BASE_VOLUME_OPACITY = [1.0, 0.6];

  var state = { region: null, hemi: "both", surf: "pial", mode: "ghost" };
  var nv = null;                       // NiiVue instance inside the iframe
  var frame = null;                    // the iframe element
  var hadRegion = false;               // a region view was on since last reset
  var meshIndex = {};                  // key -> index in nv.meshes
  var labelsCache = {};                // "lh" -> {names, labels, ctab}
  var ui = {};

  function $(id) { return document.getElementById(id); }

  function pretty(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function parseFragment() {
    var m = { region: null, hemi: null, surf: null, mode: null };
    location.hash.replace(/^#/, "").split("&").forEach(function (kv) {
      var p = kv.split("=");
      if (p.length === 2) m[p[0]] = decodeURIComponent(p[1]);
    });
    if (m.region) state.region = m.region;
    if (m.hemi === "l" || m.hemi === "lh") state.hemi = "lh";
    else if (m.hemi === "r" || m.hemi === "rh") state.hemi = "rh";
    else if (m.hemi === "both") state.hemi = "both";
    if (m.surf === "pial" || m.surf === "white") state.surf = m.surf;
    if (m.mode === "ghost" || m.mode === "isolate") state.mode = m.mode;
  }

  function writeFragment() {
    var h = "";
    if (state.region) {
      h = "#region=" + encodeURIComponent(state.region) +
          "&hemi=" + (state.hemi === "lh" ? "l" : state.hemi === "rh" ? "r" : "both") +
          "&surf=" + state.surf + "&mode=" + state.mode;
    }
    history.replaceState(null, "", h || location.pathname + location.search);
  }

  function fetchLabels(hemi) {
    if (labelsCache[hemi]) return Promise.resolve(labelsCache[hemi]);
    return fetch("data/" + hemi + ".labels.json.gz")
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) {
        var stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
        return new Response(stream).json();
      })
      .then(function (d) { labelsCache[hemi] = d; return d; });
  }

  function lookupMeshes() {
    var meshes = nv.meshes || [];
    Object.keys(MESHES).forEach(function (key) {
      var def = MESHES[key];
      for (var i = 0; i < meshes.length; i++) {
        var m = meshes[i];
        var hay = [m.id, m.name, m.url].join(" ");
        if (hay.indexOf(def.id) >= 0 || hay.indexOf(def.stem) >= 0) {
          meshIndex[key] = i;
          return;
        }
      }
    });
    return Object.keys(meshIndex).length === Object.keys(MESHES).length;
  }

  function setProp(key, prop, val) {
    if (meshIndex[key] === undefined) return;
    try { nv.setMeshProperty(meshIndex[key], prop, val); } catch (e) { /* stale */ }
  }

  function originalRgba(def, cached) {
    // Full-parcellation colors, exactly what convert_surfaces.py baked in.
    var labels = cached.labels, ctab = cached.ctab;
    var n = labels.length;
    var rgba = new Uint8Array(n * 4);
    for (var i = 0; i < n; i++) {
      var c = ctab[labels[i]];
      var o = i * 4;
      if (labels[i] === 0) {
        rgba[o] = 150; rgba[o + 1] = 150; rgba[o + 2] = 150;
      } else {
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2];
      }
      rgba[o + 3] = 255;
    }
    return rgba;
  }

  // Push the region's annot color toward full saturation so it pops against
  // the muted context in either mode (e.g. frontal pole's 100,0,100 → vivid
  // magenta). Hue family is preserved.
  function boostColor(c) {
    var mean = (c[0] + c[1] + c[2]) / 3 || 1;
    return c.slice(0, 3).map(function (v) {
      return Math.max(0, Math.min(255, Math.round(128 + (v - mean) * 2.5)));
    });
  }

  function regionRgba(def, cached, selectedKeys) {
    var labels = cached.labels, ctab = cached.ctab;
    var n = labels.length;
    var rgba = new Uint8Array(n * 4);
    var muted = state.mode === "isolate" ? MUTED_ISOLATE : MUTED_GHOST;
    var count = 0;
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      if (selectedKeys[labels[i]]) {
        var c = boostColor(ctab[labels[i]]);
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
        count++;
      } else {
        rgba[o] = muted[0]; rgba[o + 1] = muted[1]; rgba[o + 2] = muted[2]; rgba[o + 3] = 255;
      }
    }
    return { rgba: rgba, count: count };
  }

  // The annot names we ship are hemisphere-agnostic ("banksts...", "frontalpole"),
  // so the same region index applies to either side.
  function regionLabelIndex(cached, region) {
    return cached.names.indexOf(region);
  }

  // FreeBrowse's layout (ACS slices vs 3D Render) is React state, so the only
  // way in is the same-origin DOM: click the view button ourselves. Surfaces
  // are only visible in the Render view.
  function setView(label) {
    try {
      var doc = frame.contentDocument;
      if (!doc) return;
      var btns = doc.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === label) { btns[i].click(); return; }
      }
    } catch (e) { /* cross-origin or not ready */ }
  }

  // In the 3D render view the aparc+aseg volume rendering would cover the
  // surface meshes, so the region view hides the volumes (reset restores the
  // opacities from mri-view.nvd). Opacity 0 is how FreeBrowse's own eye
  // buttons hide volumes.
  function hideVolumes(hide) {
    try {
      (nv.volumes || []).forEach(function (v, i) {
        if (i < BASE_VOLUME_OPACITY.length) {
          nv.setOpacity(i, hide ? 0 : BASE_VOLUME_OPACITY[i]);
        }
      });
    } catch (e) { /* not ready */ }
  }

  function apply() {
    if (!nv || !frame) return;
    parseFragment();
    writeFragment();

    var wantKeys;
    if (!state.region) {
      wantKeys = [];
    } else if (state.hemi === "both") {
      wantKeys = ["lh", "rh"];
    } else {
      wantKeys = [state.hemi];
    }
    var targetSurf = state.surf;

    // Both hemispheres' labels are needed even for a reset (to restore the
    // baked parcellation colors). ~45 KB gzipped each.
    var needed = ["lh", "rh"]
      .filter(function (h) { return labelsCache[h] === undefined; })
      .map(fetchLabels);

    Promise.all(needed).then(function () {
      if (state.region && !hadRegion) {
        setView("Render");
        hideVolumes(true);
      }
      if (!state.region && hadRegion) {
        setView("ACS");
        hideVolumes(false);
      }
      hadRegion = !!state.region;
      var shownVerts = 0;
      Object.keys(MESHES).forEach(function (key) {
        var def = MESHES[key];
        var cached = labelsCache[def.hemi];
        if (!cached) return; // no region active — reset path handles this without labels
        var active = state.region &&
                     wantKeys.indexOf(def.hemi) >= 0 && def.surf === targetSurf;

        if (active) {
          var li = regionLabelIndex(cached, state.region);
          if (li < 0) return;
          var sel = {}; sel[li] = true;
          var r = regionRgba(def, cached, sel);
          setProp(key, "rgba255", r.rgba);
          setProp(key, "visible", true);
          setProp(key, "opacity", 1.0);
          shownVerts += r.count;
        } else if (state.region) {
          // a region view is on: hide the other surface/hemisphere meshes
          setProp(key, "visible", false);
        } else {
          // reset: original colors, opacity, and hidden-by-default visibility
          setProp(key, "rgba255", originalRgba(def, cached));
          setProp(key, "opacity", def.baseOpacity);
          setProp(key, "visible", false);
        }
      });
      updateStatus(shownVerts);
    }).catch(function (e) {
      ui.status.textContent = "Could not load parcellation data: " + e;
    });
  }

  function updateStatus(verts) {
    if (!state.region) { ui.status.textContent = ""; return; }
    var parts = [pretty(state.region)];
    parts.push(state.hemi === "both" ? "both hemispheres"
             : state.hemi === "lh" ? "left hemisphere" : "right hemisphere");
    parts.push("white" === state.surf ? "white surface" : "pial surface");
    ui.status.textContent = parts.join(" · ") +
      " · " + verts.toLocaleString() + " vertices";
  }

  function buildUI() {
    ui.status = $("rp-status");
    ui.region = $("rp-region");

    fetchLabels("lh").then(function (cache) {
      cache.names.forEach(function (name) {
        if (name === "unknown" || name === "corpuscallosum") return;
        var opt = document.createElement("option");
        opt.value = name;
        opt.textContent = pretty(name);
        ui.region.appendChild(opt);
      });
      ui.region.value = state.region || "";
    });

    ui.region.addEventListener("change", function () {
      state.region = ui.region.value || null;
      apply();
    });

    [["rp-hemi-l", "lh"], ["rp-hemi-r", "rh"], ["rp-hemi-both", "both"],
     ["rp-surf-pial", "pial"], ["rp-surf-white", "white"],
     ["rp-mode-ghost", "ghost"], ["rp-mode-isolate", "isolate"]].forEach(function (spec) {
      var btn = $(spec[0]);
      if (!btn) return;
      btn.addEventListener("click", function () {
        var key = spec[0].indexOf("rp-hemi") === 0 ? "hemi"
                : spec[0].indexOf("rp-surf") === 0 ? "surf" : "mode";
        state[key] = spec[1];
        syncButtons();
        apply();
      });
    });

    $("rp-reset").addEventListener("click", function () {
      state.region = null;
      ui.region.value = "";
      syncButtons();
      apply();
    });

    syncButtons();
  }

  function syncButtons() {
    [["rp-hemi-l", "hemi", "lh"], ["rp-hemi-r", "hemi", "rh"], ["rp-hemi-both", "hemi", "both"],
     ["rp-surf-pial", "surf", "pial"], ["rp-surf-white", "surf", "white"],
     ["rp-mode-ghost", "mode", "ghost"], ["rp-mode-isolate", "mode", "isolate"]].forEach(function (s) {
      var btn = $(s[0]);
      if (btn) btn.classList.toggle("active", state[s[1]] === s[2]);
    });
  }

  function waitForViewer() {
    var tries = 0;
    var diag = "";
    (function poll() {
      frame = frame || $("viewer-frame");
      var win = frame && frame.contentWindow;
      if (win && win.nv && win.nv.meshes && win.nv.meshes.length >= 4) {
        nv = win.nv;                    // before lookupMeshes(), which reads it
        if (lookupMeshes()) {
          apply();
          return;
        }
      }
      // remember the first reason we can't proceed yet
      if (!diag) {
        diag = !win ? "no iframe window"
             : !win.nv ? "window.nv missing (re-vendored freebrowse? see README)"
             : "meshes: " + (win.nv.meshes || []).length + ", matched: " +
               Object.keys(meshIndex).length;
      }
      if (++tries < 120) setTimeout(poll, 500);
      else if (ui.status) ui.status.textContent = "Picker: " + diag;
    })();
  }

  parseFragment();
  buildUI();
  var frame = $("viewer-frame");
  if (frame) frame.addEventListener("load", waitForViewer);
  waitForViewer();
})();