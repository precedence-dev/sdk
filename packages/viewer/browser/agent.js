/**
 * The Precedence picker agent. Injected into a running dev build by
 * @precedence-dev/sdk when the page is opened with `?precedence=pick&at=<url>`.
 *
 * Click an interactive element -> resolve it to a catalog entry via the
 * `data-precedence-id` stamp (@precedence-dev/cli/stamp-loader) -> the element's
 * outcome tree is shown; for each outcome worth tracking, name it, write a
 * meaning, choose + rename properties, add constants, and see the exact
 * `precedence.track(...)` call it will bake -> POST the plan to the wizard.
 * Fetches `GET /plan` first so whatever's already tracked shows up, stays
 * checked, and rides along on send (merge, not replace).
 *
 * Vanilla, self-contained, runs in a shadow root so nothing here touches the
 * host app's styles. No build step. The pure helpers are exported for tests
 * (`typeof module` is only truthy under Node's require, never in a <script>).
 */
(function () {
  "use strict";

  var RESERVED = { psc_id: 1, psc_v: 1 };

  /* ---- pure: resolve a stamped node to a catalog entry ---------------------- */
  function entryFor(node, catalog) {
    var stamped = node && node.closest ? node.closest("[data-precedence-id]") : null;
    var ref = stamped && stamped.getAttribute("data-precedence-id");
    if (!ref) return null;
    var els = catalog.elements || [];
    for (var i = 0; i < els.length; i++) if (els[i].ref === ref) return els[i];
    return null;
  }

  /* ---- pure: an entry's outcome TREE -------------------------------------------
   * One node per action, each with its pruned branch subtree. A node is
   * `trackable` when it's a real end state (a terminal branch, or the action
   * itself for "any outcome"); intermediate nodes render as structure only.
   * Pruned out entirely:
   *   - `synthetic` branches ("otherwise, nothing happens")
   *   - a loop whose whole subtree just builds a local array (.push/.splice…)
   *     and produces no call, state write, or outcome — counted in `hidden`
   *   - a pass-through with nothing trackable under it
   * A handler that forwards to a prop pulls its outcomes from the render site
   * (`action.forwardsTo`); the person picking never sees the parent component. */
  function nodesFor(entry, catalog) {
    return (entry.actions || []).map(function (a) {
      var fwd = a.forwardsTo && catalog ? forwarded(a, catalog) : null;
      var t = fwd ? fwd.tree : prune(a.branches || []);
      return {
        id: a.attachId, kind: "action", label: a.name + "  ·  any outcome",
        firesWhen: a.firesWhen, suggestedName: a.suggestedName, inject: "statement",
        fingerprint: a.fingerprint, props: (a.candidateProps || []).map(nm),
        anchors: fwd ? fwd.anyAnchors : null, trackable: true, perItem: false,
        children: t.nodes, hidden: t.hidden,
      };
    });
  }

  var NOISE_CALL = /\.(push|pop|shift|unshift|splice|fill|copyWithin|set|add|delete|clear)\s*\(/;
  function realEffect(b) {
    return (b.codeAtPoint || []).some(function (s) { return /[\w$]\s*\(/.test(s) && !NOISE_CALL.test(s); });
  }
  function meaningful(b) {
    return !!b.via
      || /^(guard|guard-passed|catch|try|finally|outcome|reactive)$/.test(b.kind)
      || realEffect(b)
      || (b.children || []).some(meaningful);
  }

  function prune(branches) {
    var hidden = 0;
    function walk(bs) {
      var out = [];
      (bs || []).forEach(function (b) {
        if (b.synthetic) return;
        if (b.kind === "loop" && !meaningful(b)) { hidden++; return; }
        var node = nodeOf(b, walk(b.children || []));
        if (node.trackable || hasTrackable(node)) out.push(node);
      });
      return out;
    }
    return { nodes: walk(branches), hidden: hidden };
  }
  function hasTrackable(n) {
    return (n.children || []).some(function (c) { return c.trackable || hasTrackable(c); });
  }

  function nodeOf(b, kids) {
    return {
      id: b.id, kind: b.kind, label: b.label, firesWhen: b.firesWhen,
      suggestedName: b.suggestedName, fingerprint: b.fingerprint, inject: b.inject || "statement",
      props: (b.candidateProps || []).map(nm), anchors: null,
      perItem: !!b.firesPerIteration,
      trackable: !!b.terminal && !b.synthetic,
      children: kids, hidden: 0,
    };
  }

  function forwarded(action, catalog) {
    var byId = {};
    (catalog.elements || []).forEach(function (e) { (e.actions || []).forEach(function (a) { byId[a.attachId] = a; }); });
    var targets = (action.forwardsTo.targets || []).map(function (id) { return byId[id]; }).filter(Boolean);
    if (!targets.length) return null;
    var anyAnchors = targets.map(function (t) { return { id: t.attachId, fingerprint: t.fingerprint, inject: "statement" }; });

    if (targets.length === 1) {
      var disp = {};
      (function w(bs) { (bs || []).forEach(function (b) { disp[b.path] = b; w(b.children); }); })(action.branches);
      var pr = prune(targets[0].branches || []);
      (function relabel(ns) {
        ns.forEach(function (n) {
          var d = disp[pathOf(n.id)];
          if (d) { n.label = d.label; n.firesWhen = d.firesWhen; n.suggestedName = d.suggestedName; }
          relabel(n.children || []);
        });
      })(pr.nodes);
      return { tree: pr, anyAnchors: anyAnchors };
    }

    var byPath = {};
    targets.forEach(function (t) {
      terminalsOf(t.branches).forEach(function (b) { (byPath[b.path] = byPath[b.path] || []).push(b); });
    });
    var nodes = Object.keys(byPath).map(function (p) {
      var bs = byPath[p], d = bs[0];
      return {
        id: bs.map(function (b) { return b.id; }).join("+"), kind: "outcome", label: d.label,
        firesWhen: "", suggestedName: d.suggestedName, fingerprint: d.fingerprint, inject: "statement",
        props: (d.candidateProps || []).map(nm),
        anchors: bs.map(function (b) { return { id: b.id, fingerprint: b.fingerprint, inject: b.inject || "statement" }; }),
        trackable: true, perItem: false, children: [], hidden: 0,
      };
    });
    return { tree: { nodes: nodes, hidden: 0 }, anyAnchors: anyAnchors };
  }

  function pathOf(id) { return String(id).split("|").slice(2).join("|"); }
  function terminalsOf(bs) {
    var out = [];
    (function w(list) { (list || []).forEach(function (b) { if (b.terminal && !b.synthetic) out.push(b); w(b.children); }); })(bs);
    return out;
  }
  function nm(p) { return p.name; }

  /* ---- pure: derive the plan's { properties, accessors } from editor rows ----
   * A row is a prop (a name in scope), a renamed prop (`key` ≠ `name`, value
   * expr fixed), an ambient read (localStorage / context), or a constant. Every
   * shape is just a key + a value expression, which is exactly `properties[]` +
   * `accessors{}` — no new plan fields, no new instrument code. */
  function fromRows(rows) {
    var properties = [], accessors = {};
    (rows || []).forEach(function (r) {
      if (!r.key) return;
      properties.push(r.key);
      if (r.kind === "const") accessors[r.key] = JSON.stringify(r.value);
      else if (r.kind === "ambient") accessors[r.key] = r.accessor;         // string or {hook,context,path}
      else if (r.key !== r.name) accessors[r.key] = r.name;                  // renamed in-scope prop
      // else: shorthand, `key` is a bare in-scope binding — no accessor
    });
    return { properties: properties, accessors: accessors };
  }

  /* ---- pure: picked nodes -> the plan events @precedence-dev/instrument consumes -- */
  function toEvents(picked) {
    return Object.keys(picked).map(function (id) {
      var p = picked[id];
      var pa = fromRows(p.rows);
      var anchors = p.anchors && p.anchors.length
        ? p.anchors
        : [{ id: id, fingerprint: p.fingerprint, inject: p.inject || "statement" }];
      var ev = { name: cleanName(p.name), properties: pa.properties, anchors: anchors };
      if (p.description && p.description.trim()) ev.description = p.description.trim();
      if (Object.keys(pa.accessors).length) ev.accessors = pa.accessors;
      return ev;
    });
  }

  /* ---- pure: the guard rails ---- */
  function cleanName(s) {
    return String(s || "").trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "event";
  }
  function cleanKey(s, fallback) {
    var k = String(s || "").trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    return !k || RESERVED[k] ? (fallback || "") : k;
  }
  function coerce(v) {
    var t = String(v).trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return String(v);
  }
  /** cyrb53 — the anchor hash the SDK / instrument bake as `psc_id`. A copy so
   *  the preview shows the real value; keep in sync with the other three copies. */
  function pscId(structuralId) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < structuralId.length; i++) {
      var ch = structuralId.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return "p_" + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  /** the exact call @precedence-dev/instrument would bake for this event */
  function trackCall(name, anchorId, rows) {
    var pa = fromRows(rows);
    var parts = ['psc_id: "' + pscId(anchorId) + '"'];
    pa.properties.forEach(function (k) {
      var a = pa.accessors[k];
      parts.push(a == null || a === k ? k : k + ": " + (typeof a === "string" ? a : "<" + a.hook + "().." + a.path + ">"));
    });
    return 'precedence.track("' + cleanName(name) + '", { ' + parts.join(", ") + " })";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      entryFor: entryFor, nodesFor: nodesFor, toEvents: toEvents,
      fromRows: fromRows, trackCall: trackCall, cleanName: cleanName, cleanKey: cleanKey,
    };
  }
  if (typeof document === "undefined" || !document.currentScript) return; // required for tests, not a browser

  /* ---- browser: the overlay -------------------------------------------------- */
  var AT = new URL(document.currentScript.src).origin;
  var catalog = null;
  var picked = {};   // nodeId -> { name, description, fingerprint, inject, anchors, rows }
  var inPlan = {};    // nodeId -> true (already in .precedence/plan.json)
  var carry = [];     // existing multi-anchor (discriminated) events, passed through untouched
  var root, panel, barEl, paused = false;

  Promise.all([
    fetch(AT + "/catalog").then(function (r) { return r.json(); }),
    fetch(AT + "/plan").then(function (r) { return r.json(); }).catch(function () { return { events: [] }; }),
  ]).then(function (res) {
    catalog = res[0];
    seedExisting(res[1]);
    mount();
    if (Object.keys(inPlan).length || carry.length) showPlan();
  }).catch(function () { alert("Precedence: couldn't load the catalog from " + AT); });

  /** rebuild editor rows from a plan event's properties + accessors */
  function rowsFromPlan(ev) {
    var acc = ev.accessors || {};
    return (ev.properties || []).map(function (k) {
      var a = acc[k];
      if (a == null) return { kind: "prop", key: k, name: k };
      if (typeof a === "object") return { kind: "ambient", key: k, name: k, accessor: a };
      if (/^(["']).*\1$|^-?\d|^(true|false|null)$/.test(a.trim())) {
        try { return { kind: "const", key: k, value: JSON.parse(a.replace(/^'|'$/g, '"')) }; } catch (e) { /* fall through */ }
      }
      return /localStorage|sessionStorage|JSON\.parse/.test(a)
        ? { kind: "ambient", key: k, name: k, accessor: a }
        : { kind: "prop", key: k, name: a };   // a bare identifier → a renamed in-scope prop
    });
  }
  function seedExisting(plan) {
    ((plan && plan.events) || []).forEach(function (ev) {
      var an = ev.anchors || [];
      if (an.length === 1) {
        var a = an[0];
        inPlan[a.id] = true;
        picked[a.id] = {
          name: ev.name, description: ev.description || "", fingerprint: a.fingerprint,
          inject: a.inject || "statement", anchors: null, rows: rowsFromPlan(ev),
        };
      } else if (an.length > 1) {
        carry.push(ev);
      }
    });
  }

  function mount() {
    var host = document.createElement("div");
    host.id = "precedence-picker";
    host.style.cssText = "position:fixed;top:0;right:0;z-index:2147483647;width:404px;max-width:96vw";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      "<style>:host{all:initial}*{box-sizing:border-box;font:13px/1.5 system-ui,sans-serif}" +
      ".wrap{background:#fff;border:1px solid #e4e4e2;border-top:0;border-right:0;border-bottom-left-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.2);overflow:hidden}" +
      ".bar{background:#1c1d1f;color:#fff;padding:9px 12px;display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}" +
      ".bar b{font-weight:650}.bar .sp{flex:1}.msg{flex-basis:100%;order:9;color:#c9cbcf;font-size:12px}" +
      "button{font:inherit;border:1px solid #3a3b3e;background:#2a2b2e;color:#fff;border-radius:6px;padding:4px 9px;cursor:pointer}" +
      "button.go{background:#2f9e44;border-color:#2f9e44}button.paused{background:#b5850b;border-color:#b5850b}" +
      "button.mini{background:#f0f0ee;border-color:#e0e0dd;color:#3a3b3e;padding:2px 7px;font-size:11px}" +
      ".panel{background:#fff;color:#1c1d1f;max-height:72vh;overflow:auto;padding:12px 14px;border-top:1px solid #e4e4e2}" +
      ".panel[hidden]{display:none}" +
      ".el{font-family:ui-monospace,Menlo,monospace;font-weight:700;word-break:break-all}" +
      ".loc{color:#6b6f76;font-size:11px;margin-bottom:10px;word-break:break-all}" +
      ".nd{margin:1px 0}.nd .nd{margin-left:9px;border-left:1px solid #ececea;padding-left:9px}" +
      ".st{color:#3a3b3e;font-weight:600;font-size:12px;padding:5px 0}.st .pi,.brh .pi{color:#8a8f98;font-weight:400}" +
      ".hint{color:#9a9ea6;font-size:11px;font-style:italic;padding:3px 0}" +
      ".br{padding:5px 0}" +
      ".brh{display:flex;gap:7px;align-items:flex-start;cursor:pointer}.brh .lab{flex:1}.brh input[type=checkbox]{margin-top:3px}" +
      ".tag{font-size:10px;color:#2f9e44;white-space:nowrap;margin-top:2px}" +
      ".fx{color:#6b6f76;font-size:11.5px;margin:1px 0 0 21px}" +
      ".brb{margin:6px 0 4px 21px}.brb[hidden]{display:none}" +
      ".fld{margin-bottom:6px}.fld input{width:100%;font:12px ui-monospace,monospace;border:1px solid #e4e4e2;border-radius:5px;padding:3px 6px}" +
      ".ph{color:#6b6f76;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;margin:8px 0 3px}" +
      ".prow{display:flex;gap:6px;align-items:center;font:12px ui-monospace,monospace;padding:1px 0}" +
      ".prow input[type=checkbox]{flex:none}" +
      ".prow .k{width:130px;font:12px ui-monospace,monospace;border:1px solid #e4e4e2;border-radius:4px;padding:2px 5px}" +
      ".prow .v{flex:1;color:#6b6f76;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".prow .cv{flex:1;font:12px ui-monospace,monospace;border:1px solid #e4e4e2;border-radius:4px;padding:2px 5px}" +
      ".prow .x{cursor:pointer;color:#b02a2a;font-size:11px}" +
      ".prev{margin:8px 0 2px;background:#1c1d1f;color:#e8e8e8;border-radius:6px;padding:8px 10px;font:11.5px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all}" +
      ".prev .lk{color:#8a8f98}" +
      ".pe{padding:3px 0;font:12px ui-monospace,monospace}.pe b{color:#2f9e44}" +
      ".hi{outline:2px solid #2f6fed!important;outline-offset:1px}</style>" +
      "<div class=wrap>" +
      "<div class=bar><b>Precedence</b><span class=sp></span><span id=count></span>" +
      "<button id=plan hidden>plan</button>" +
      "<button class=pause id=pause>pause</button>" +
      "<button class=go id=send>send to wizard</button>" +
      "<span class=msg id=msg>click an element to track it</span></div>" +
      "<div class=panel id=panel hidden></div>" +
      "</div>";
    panel = root.getElementById("panel");
    barEl = root.getElementById("msg");
    document.documentElement.appendChild(host);
    root.getElementById("send").onclick = send;
    root.getElementById("pause").onclick = togglePause;
    var planBtn = root.getElementById("plan");
    planBtn.onclick = showPlan;
    if (Object.keys(inPlan).length || carry.length) planBtn.hidden = false;
    document.addEventListener("mouseover", onHover, true);
    document.addEventListener("mouseout", function (e) { if (e.target.classList) e.target.classList.remove("hi"); }, true);
    document.addEventListener("click", onClick, true);
  }

  function bar(t) { if (barEl) barEl.textContent = t; }
  function count() {
    root.getElementById("count").textContent = (Object.keys(picked).length + carry.length) + " tracked";
  }
  function clearHi() {
    var hi = document.querySelectorAll(".hi");
    for (var i = 0; i < hi.length; i++) hi[i].classList.remove("hi");
  }
  function togglePause() {
    paused = !paused;
    var btn = root.getElementById("pause");
    btn.textContent = paused ? "resume" : "pause";
    btn.className = paused ? "pause paused" : "pause";
    bar(paused ? "paused — the app clicks normally. “resume” to pick again." : "click an element to track it");
    if (paused) clearHi();
  }
  function onHover(e) {
    if (paused || root.host.contains(e.target)) return;
    if (e.target.classList) e.target.classList.toggle("hi", !!entryFor(e.target, catalog));
  }
  function onClick(e) {
    if (paused || root.host.contains(e.target)) return;
    var entry = entryFor(e.target, catalog);
    if (!entry) return;
    e.preventDefault(); e.stopPropagation();
    show(entry);
  }

  function el(cls, text) {
    var d = document.createElement("div");
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }
  function input(type) { var i = document.createElement("input"); i.type = type; return i; }
  function field(label, node) {
    var f = el("fld");
    f.appendChild(el("ph", label));
    f.appendChild(node);
    return f;
  }
  function perItem() {
    var s = document.createElement("span");
    s.className = "pi"; s.textContent = "  · once per item";
    return s;
  }

  /* the read-only view of what's already in .precedence/plan.json */
  function showPlan() {
    panel.hidden = false;
    panel.innerHTML = "";
    panel.appendChild(el("el", ".precedence/plan.json"));
    var ids = Object.keys(inPlan);
    if (!ids.length && !carry.length) { panel.appendChild(el("loc", "empty — nothing tracked yet")); return; }
    ids.forEach(function (id) { panel.appendChild(planRow(picked[id])); });
    carry.forEach(function (e) { panel.appendChild(planRow({ name: e.name, rows: rowsFromPlan(e) }, (e.anchors || []).length + " outcomes")); });
    panel.appendChild(el("loc", "click an element to add to this or edit it"));
  }
  function planRow(p, note) {
    var r = el("pe");
    var b = document.createElement("b"); b.textContent = "✓ " + cleanName(p.name);
    r.appendChild(b);
    var keys = (p.rows || []).map(function (x) { return x.key; }).filter(Boolean);
    if (keys.length) r.appendChild(document.createTextNode("  (" + keys.join(", ") + ")"));
    if (note) r.appendChild(document.createTextNode("  · " + note));
    return r;
  }

  function show(entry) {
    panel.hidden = false;
    panel.innerHTML = "";
    panel.appendChild(el("el", "<" + entry.tag + ">" + (entry.label ? " " + entry.label : "")));
    panel.appendChild(el("loc", entry.component + "  ·  " + entry.file.replace(/.*\/src\//, "src/") + ":" + entry.line));
    nodesFor(entry, catalog).forEach(function (n) { panel.appendChild(renderNode(n, entry)); });
    count();
  }

  function renderNode(n, entry) {
    var box = el("nd");
    box.appendChild(n.trackable ? trackRow(n, entry) : structRow(n));
    (n.children || []).forEach(function (c) { box.appendChild(renderNode(c, entry)); });
    if (n.hidden) box.appendChild(el("hint", "+ " + n.hidden + (n.hidden > 1 ? " steps" : " step") + " with no outcome (not tracked)"));
    return box;
  }

  function structRow(n) {
    var d = el("st");
    d.textContent = n.label;
    if (n.perItem) d.appendChild(perItem());
    return d;
  }
  function detailOf(n) {
    var det = (n.firesWhen || "").replace(/^Fires when /, "");
    return det && det.replace(/[.\s]+$/, "").toLowerCase() !== String(n.label).toLowerCase() ? det : "";
  }
  function previewAnchor(n) { return (n.anchors && n.anchors[0] && n.anchors[0].id) || n.id; }

  /** the starting editor rows for a fresh pick: every in-scope candidate prop, checked. */
  function seedRows(n) { return (n.props || []).map(function (p) { return { kind: "prop", key: p, name: p }; }); }

  function trackRow(n, entry) {
    var planned = inPlan[n.id];
    var cur = picked[n.id] || { name: n.suggestedName || "event", description: "", rows: seedRows(n) };
    var on = !!picked[n.id];
    var wrap = el("br");

    var cb = input("checkbox"); cb.checked = on;
    var lab = el("lab", n.label);
    if (n.perItem) lab.appendChild(perItem());
    var head = el("brh");
    head.appendChild(cb); head.appendChild(lab);
    if (planned) head.appendChild(el("tag", "● in plan"));
    head.onclick = function (e) { if (e.target !== cb) { cb.checked = !cb.checked; onToggle(); } };
    wrap.appendChild(head);

    var det = detailOf(n);
    if (det) wrap.appendChild(el("fx", det));

    var body = el("brb"); body.hidden = !on;
    var name = input("text");
    name.value = cur.name;
    name.onblur = function () { name.value = cleanName(name.value); sync(); };
    var mean = input("text");
    mean.placeholder = "business definition, success criteria, exclusions";
    mean.value = cur.description || "";
    body.appendChild(field("event name", name));
    body.appendChild(field("what this event means", mean));

    var rows = cur.rows.map(function (r) { return Object.assign({}, r); });   // editable copy
    var propHost = el("div");
    body.appendChild(el("ph", "properties  ·  pick, rename the key, add constants"));
    body.appendChild(propHost);
    var prev = el("prev");
    body.appendChild(prev);
    wrap.appendChild(body);

    function draw() {
      propHost.innerHTML = "";
      (n.props || []).forEach(function (pn) { propHost.appendChild(candRow(pn, null)); });
      ((catalog && catalog.ambientProps) || []).forEach(function (p) { propHost.appendChild(candRow(p.name, p)); });
      rows.filter(function (r) { return r.kind === "const"; }).forEach(function (r) { propHost.appendChild(constRow(r)); });
      var add = document.createElement("button");
      add.className = "mini"; add.textContent = "＋ constant";
      add.onclick = function () { rows.push({ kind: "const", key: "", value: "" }); draw(); sync(); };
      propHost.appendChild(add);
      renderPreview();
    }
    function candRow(pnName, ambient) {
      var r = rows.filter(function (x) { return x.kind !== "const" && (x.name === pnName || x.key === pnName); })[0];
      var line = el("prow");
      var pc = input("checkbox"); pc.checked = !!r;
      pc.onchange = function () {
        if (pc.checked) rows.push({ kind: ambient ? "ambient" : "prop", key: pnName, name: pnName, accessor: ambient && (ambient.accessor || ambient.via) });
        else rows = rows.filter(function (x) { return x !== r; });
        draw(); sync();
      };
      line.appendChild(pc);
      if (r) {
        var k = input("text"); k.className = "k"; k.value = r.key;
        k.oninput = function () { r.key = cleanKey(k.value, pnName); renderPreview(); sync(); };
        k.onblur = function () { k.value = r.key; };
        line.appendChild(k);
        line.appendChild(el("span", "= " + (ambient ? shortAcc(ambient) : pnName) + (ambient && ambient.identity ? "  ⚑" : ""))).className = "v";
      } else {
        line.appendChild(el("span", pnName + (ambient ? "  · " + ambient.source + (ambient.identity ? " ⚑" : "") : ""))).className = "v";
      }
      return line;
    }
    function constRow(r) {
      var line = el("prow");
      line.appendChild(input("checkbox")).checked = true;
      var k = input("text"); k.className = "k"; k.placeholder = "key"; k.value = r.key;
      k.oninput = function () { r.key = cleanKey(k.value, ""); renderPreview(); sync(); };
      var eq = el("span", "="); eq.style.color = "#6b6f76";
      var v = input("text"); v.className = "cv"; v.placeholder = "\"value\" / 42 / true"; v.value = r.value;
      v.oninput = function () { r.value = coerce(v.value); renderPreview(); sync(); };
      var x = el("span", "✕"); x.className = "x";
      x.onclick = function () { rows = rows.filter(function (z) { return z !== r; }); draw(); sync(); };
      line.appendChild(k); line.appendChild(eq); line.appendChild(v); line.appendChild(x);
      return line;
    }
    function renderPreview() {
      prev.innerHTML = "";
      prev.appendChild(el("span", "// baked at ")).className = "lk";
      prev.appendChild(document.createTextNode(entry.file.replace(/.*\/src\//, "src/") + ":" + entry.line + "\n"));
      prev.appendChild(document.createTextNode(trackCall(name.value, previewAnchor(n), rows)));
    }
    function onToggle() { if (cb.checked) sync(); else { delete picked[n.id]; body.hidden = true; count(); } }
    function sync() {
      if (!cb.checked) return;
      picked[n.id] = {
        name: name.value.trim(), description: mean.value.trim(),
        fingerprint: n.fingerprint, inject: n.inject, anchors: n.anchors || null,
        rows: rows.filter(function (r) { return r.key || r.kind !== "const"; }),
      };
      body.hidden = false;
      count();
    }
    cb.onchange = onToggle;
    name.oninput = sync; mean.oninput = sync;
    draw();
    return wrap;
  }

  function shortAcc(a) {
    var s = a.accessor || (a.via && a.via.hook + "()." + a.via.path) || a.name;
    return s.length > 34 ? s.slice(0, 33) + "…" : s;
  }

  function send() {
    var events = toEvents(picked).concat(carry);
    if (!events.length) { bar("nothing tracked yet"); return; }
    fetch(AT + "/plan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "precedence-agent", generated: new Date().toISOString(), events: events }),
    })
      .then(function (r) { if (!r.ok) throw 0; })
      .then(function () { root.host.remove(); alert("Sent " + events.length + " event(s) to the wizard. Back to your terminal."); })
      .catch(function () { bar("couldn't reach the wizard at " + AT); });
  }
})();
