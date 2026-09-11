/**
 * The Precedence picker agent. Injected into a running dev build by
 * @precedence-dev/sdk when the page is opened with `?precedence=pick&at=<url>`.
 *
 * Click an interactive element -> resolve it to a catalog entry (walk the React
 * fiber tree up from the node, reading the `data-precedence-id` stamp
 * @precedence-dev/cli/stamp-loader put in each element's props) -> the element's
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
  // method / array names that leak into an object's `observedFields` when the
  // shape was inferred from usage (`x.map(...)`) rather than a resolved type
  var FIELD_NOISE = /^(split|sort|map|filter|forEach|some|every|find|reduce|includes|indexOf|slice|concat|join|trim|toLowerCase|toUpperCase|replace|match|test|toString|valueOf|length|push|pop)$/;

  /* ---- resolve a clicked node to a catalog entry ------------------------------
   * The stamp-loader puts `data-precedence-id="<file>#<Comp>::<slot>"` in every
   * interactive element's JSX. Reading it back:
   *
   *   1. FIBER WALK (primary) — from the clicked DOM node, up the React fiber
   *      tree via `fiber.return`. The fiber tree is the LOGICAL component tree,
   *      so this:
   *        · crosses portals — a MUI Select's option list, a Dialog body, a
   *          date picker's calendar render into <body>, but their fibers stay
   *          children of where they were written
   *        · needs no prop forwarding — a component fiber carries
   *          `data-precedence-id` in its props even when the component never
   *          passes it down to a real DOM attribute
   *        · doesn't care what rendered the content — API data, a 3rd-party
   *          list, anything
   *      One rule, every React component, every UI library. No per-library code.
   *
   *   2. DOM ATTRIBUTE (fallback) — `closest("[data-precedence-id]")`, for host
   *      elements and in case a future React renames its internal fields.
   *
   * `internalKey` is memoised on first hit — React DOM's suffix is random per
   * page but stable for the page's life. */
  var internalKey = null;
  function fiberOf(node) {
    if (!node || typeof node !== "object") return null;
    if (internalKey && node[internalKey]) return node[internalKey];
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf("__reactFiber$") === 0) { internalKey = keys[i]; return node[keys[i]]; }
    }
    return null;
  }
  function refViaFiber(node) {
    for (var f = fiberOf(node); f; f = f.return) {
      var p = f.memoizedProps || f.pendingProps;
      if (p && p["data-precedence-id"]) return p["data-precedence-id"];
    }
    return null;
  }
  function refViaDom(node) {
    var s = node && node.closest ? node.closest("[data-precedence-id]") : null;
    return s ? s.getAttribute("data-precedence-id") : null;
  }
  function entryFor(node, catalog) {
    var ref = refViaFiber(node) || refViaDom(node);
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
        fingerprint: a.fingerprint, props: pmeta(a.candidateProps),
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

  /** candidateProps → the shape the editor needs: name, object-or-scalar, and
   *  (for a type-resolved object) its real field list, so we can offer to flatten. */
  function pmeta(cps) {
    return (cps || []).map(function (p) {
      return { name: p.name, shape: p.shape, src: p.typeSource,
        fields: p.shape === "object" ? (p.observedFields || []) : [] };
    });
  }

  function nodeOf(b, kids) {
    return {
      id: b.id, kind: b.kind, label: b.label, firesWhen: b.firesWhen,
      suggestedName: b.suggestedName, fingerprint: b.fingerprint, inject: b.inject || "statement",
      props: pmeta(b.candidateProps), anchors: null,
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
        props: pmeta(d.candidateProps),
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
      candsOf: candsOf, samplePayload: samplePayload,
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
      "<button id=browse>browse</button>" +
      "<button id=plan hidden>plan</button>" +
      "<button class=pause id=pause>pause</button>" +
      "<button class=go id=send>send to wizard</button>" +
      "<span class=msg id=msg>click an element to track it — or “browse” for one that isn't on screen</span></div>" +
      "<div class=panel id=panel hidden></div>" +
      "</div>";
    panel = root.getElementById("panel");
    barEl = root.getElementById("msg");
    document.documentElement.appendChild(host);
    root.getElementById("send").onclick = send;
    root.getElementById("pause").onclick = togglePause;
    root.getElementById("browse").onclick = showBrowse;
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

  /* every catalog element, searchable — for anything not rendered right now (a
   * closed dialog, an inactive tab, another route). Clicking resolves via the
   * fiber walk (see entryFor), so on-screen MUI components don't need this. */
  function showBrowse() {
    panel.hidden = false;
    panel.innerHTML = "";
    panel.appendChild(el("el", "browse — every element in the catalog"));
    var q = input("text");
    q.placeholder = "filter by tag, label, component, file…";
    q.style.cssText = "width:100%;font:12px system-ui;border:1px solid #e4e4e2;border-radius:5px;padding:4px 7px;margin:4px 0 8px";
    panel.appendChild(q);
    var list = el("div");
    panel.appendChild(list);
    var withActions = (catalog.elements || []).filter(function (e) { return (e.actions || []).some(function (a) { return !a.synthetic || a.branches; }); });
    function draw() {
      var t = q.value.toLowerCase().trim();
      list.innerHTML = "";
      withActions
        .filter(function (e) { return !t || (e.tag + " " + e.label + " " + e.component + " " + e.file).toLowerCase().indexOf(t) >= 0; })
        .slice(0, 150)
        .forEach(function (e) {
          var r = el("br");
          r.style.cursor = "pointer";
          var h = el("el", "<" + e.tag + ">" + (e.label ? ' "' + e.label + '"' : ""));
          h.style.fontSize = "12px";
          r.appendChild(h);
          r.appendChild(el("loc", e.component + "  ·  " + e.file.replace(/.*\/src\//, "src/") + ":" + e.line
            + "  ·  " + (e.actions || []).map(function (a) { return a.name; }).join(", ")));
          r.onclick = function () { show(e); };
          list.appendChild(r);
        });
      if (!list.children.length) list.appendChild(el("loc", "nothing matches"));
    }
    q.oninput = draw;
    draw();
    q.focus();
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

  /** the starting editor rows for a fresh pick: every in-scope candidate prop
   *  (objects kept whole), checked. */
  function seedRows(n) {
    return (n.props || []).map(function (p) { return { kind: "prop", key: p.name, name: p.name }; });
  }
  /** the candidates one prop-meta contributes: the whole value, plus — for a
   *  type-resolved object — each real field, so it can be flattened. */
  function candsOf(p) {
    var out = [{ name: p.name, key: p.name, expr: null }];   // whole value → shorthand
    if (p.shape === "object" && p.src === "resolved") {
      (p.fields || []).filter(function (f) { return f.length > 1 && !FIELD_NOISE.test(f); }).forEach(function (f) {
        out.push({ name: p.name + "." + f, key: (p.name + "_" + f).replace(/[^A-Za-z0-9_]/g, "_"), expr: p.name + "." + f, field: true });
      });
    }
    return out;
  }
  function metaByName(n) {
    var m = {};
    (n.props || []).forEach(function (p) { m[p.name] = p; });
    return m;
  }
  /** a sample of the payload this event would send — placeholder scalars, real
   *  object shapes, literal constants. */
  function samplePayload(name, anchorId, rows, meta) {
    var props = { psc_id: pscId(anchorId) };
    (rows || []).forEach(function (r) {
      if (!r.key) return;
      if (r.kind === "const") { props[r.key] = r.value; return; }
      var base = (r.name || r.key).split(".")[0];
      var m = base === (r.name || r.key) && meta[base];
      if (m && m.shape === "object" && (m.fields || []).length) {
        var o = {}; m.fields.forEach(function (f) { o[f] = "‹" + f + "›"; });
        props[r.key] = o;
      } else {
        props[r.key] = "‹" + (r.name || r.key) + "›";
      }
    });
    return { event: cleanName(name), properties: props };
  }

  function trackRow(n, entry) {
    var cur = picked[n.id] || { name: n.suggestedName || "event", description: "", rows: seedRows(n) };
    var wrap = el("br");

    var cb = input("checkbox"); cb.checked = !!picked[n.id];
    var lab = el("lab", n.label);
    if (n.perItem) lab.appendChild(perItem());
    var head = el("brh");
    head.appendChild(cb); head.appendChild(lab);
    if (inPlan[n.id]) head.appendChild(el("tag", "● in plan"));
    head.onclick = function (e) { if (e.target !== cb) { cb.checked = !cb.checked; onToggle(); } };
    wrap.appendChild(head);

    var det = detailOf(n);
    if (det) wrap.appendChild(el("fx", det));

    var body = el("brb"); body.hidden = !picked[n.id];
    var name = input("text");
    name.value = cur.name;
    name.onblur = function () { name.value = cleanName(name.value); sync(); };
    var mean = input("text");
    mean.placeholder = "business definition, success criteria, exclusions";
    mean.value = cur.description || "";
    body.appendChild(field("event name", name));
    body.appendChild(field("what this event means", mean));

    var editor = outcomeEditor(n, entry, cur.rows, function () { return name.value; }, sync);
    body.appendChild(editor.el);
    wrap.appendChild(body);

    function onToggle() { if (cb.checked) sync(); else { delete picked[n.id]; body.hidden = true; count(); } }
    function sync() {
      if (!cb.checked) return;
      picked[n.id] = {
        name: name.value.trim(), description: mean.value.trim(),
        fingerprint: n.fingerprint, inject: n.inject, anchors: n.anchors || null,
        rows: editor.rows(),
      };
      body.hidden = false;
      count();
    }
    cb.onchange = onToggle;
    name.oninput = function () { editor.refresh(); sync(); };
    mean.oninput = sync;
    return wrap;
  }

  /** the property picker + payload preview for one outcome. Owns its editable
   *  `rows`; `nameGetter` feeds the live preview, `onSync` is called after every
   *  change. Returns `{ el, rows(), refresh() }`. */
  function outcomeEditor(n, entry, seed, nameGetter, onSync) {
    var rows = (seed || []).map(function (r) { return Object.assign({}, r); });
    var meta = metaByName(n);
    var sample = true;
    var box = el("div");
    box.appendChild(el("ph", "properties  ·  tick, rename the key, ⤋ flatten an object, ＋ add a constant"));
    var host = el("div"); box.appendChild(host);
    var head = el("ph"); head.style.margin = "8px 0 0"; head.textContent = "this event will send";
    var toggle = document.createElement("button");
    toggle.className = "mini"; toggle.style.marginLeft = "6px";
    toggle.onclick = function () { sample = !sample; preview(); };
    head.appendChild(toggle); box.appendChild(head);
    var prev = el("prev"); box.appendChild(prev);

    function has(name) { return rows.filter(function (x) { return x.kind !== "const" && x.name === name; })[0]; }
    function changed() { draw(); onSync(); }

    function addRow(c, ambient) {
      rows.push({ kind: ambient ? "ambient" : "prop", key: cleanKey(c.key, c.key),
        name: c.name, accessor: ambient ? (ambient.accessor || ambient.via) : undefined });
    }
    function keyInput(r, fallback) {
      var k = input("text"); k.className = "k"; k.value = r.key;
      k.oninput = function () { r.key = cleanKey(k.value, fallback); preview(); onSync(); };
      k.onblur = function () { k.value = r.key; };
      return k;
    }
    function rhs(c, ambient) {
      if (has(c.name)) return "= " + (ambient ? shortAcc(ambient) : (c.expr || c.name)) + (ambient && ambient.identity ? "  ⚑" : "");
      if (ambient) return "· " + ambient.source + (ambient.identity ? " ⚑" : "");
      return !c.field && meta[c.name] && meta[c.name].shape === "object" ? "· object" : "";
    }
    function flatten(fields, objName) {
      fields.forEach(function (fc) { if (!has(fc.name)) addRow(fc, null); });
      rows = rows.filter(function (x) { return !(x.kind !== "const" && x.name === objName); });
      changed();
    }
    function candRow(c, ambient, fields) {
      var r = has(c.name);
      var line = el("prow");
      if (c.field) line.style.marginLeft = "18px";
      var pc = input("checkbox"); pc.checked = !!r;
      pc.onchange = function () {
        if (pc.checked) addRow(c, ambient);
        else rows = rows.filter(function (x) { return x !== r; });
        changed();
      };
      line.appendChild(pc);
      if (r) line.appendChild(keyInput(r, c.key));
      line.appendChild(el("span", (r ? "" : (c.field ? "↳ " : "") + c.name + " ") + rhs(c, ambient))).className = "v";
      if (fields && fields.length) {
        var fl = document.createElement("button");
        fl.className = "mini"; fl.textContent = "⤋ flatten";
        fl.onclick = function () { flatten(fields, c.name); };
        line.appendChild(fl);
      }
      return line;
    }
    function constRow(r) {
      var line = el("prow");
      line.appendChild(input("checkbox")).checked = true;
      var k = input("text"); k.className = "k"; k.placeholder = "key"; k.value = r.key;
      k.oninput = function () { r.key = cleanKey(k.value, ""); preview(); onSync(); };
      var v = input("text"); v.className = "cv"; v.placeholder = "\"value\" / 42 / true"; v.value = r.value;
      v.oninput = function () { r.value = coerce(v.value); preview(); onSync(); };
      var x = el("span", "✕"); x.className = "x";
      x.onclick = function () { rows = rows.filter(function (z) { return z !== r; }); changed(); };
      line.appendChild(k); line.appendChild(el("span", "=")); line.appendChild(v); line.appendChild(x);
      return line;
    }
    function draw() {
      host.innerHTML = "";
      (n.props || []).forEach(function (p) {
        var cs = candsOf(p), fields = cs.slice(1);
        cs.forEach(function (c) { host.appendChild(candRow(c, null, c.field ? null : fields)); });
      });
      ((catalog && catalog.ambientProps) || []).forEach(function (p) {
        host.appendChild(candRow({ name: p.name, key: p.name, expr: p.accessor || p.via }, p, null));
      });
      rows.filter(function (r) { return r.kind === "const"; }).forEach(function (r) { host.appendChild(constRow(r)); });
      var add = document.createElement("button");
      add.className = "mini"; add.textContent = "＋ constant";
      add.onclick = function () { rows.push({ kind: "const", key: "", value: "" }); changed(); };
      host.appendChild(add);
      preview();
    }
    function preview() {
      toggle.textContent = sample ? "show the exact call" : "show a sample";
      prev.textContent = "";
      var anchor = previewAnchor(n);
      if (sample) {
        prev.appendChild(document.createTextNode(
          JSON.stringify(samplePayload(nameGetter(), anchor, rows, meta), null, 2).replace(/"‹([^›]+)›"/g, "‹$1›")));
      } else {
        prev.appendChild(el("span", "// " + entry.file.replace(/.*\/src\//, "src/") + ":" + entry.line + "\n")).className = "lk";
        prev.appendChild(document.createTextNode(trackCall(nameGetter(), anchor, rows)));
      }
    }
    draw();
    return { el: box, rows: function () { return rows.filter(function (r) { return r.key || r.kind !== "const"; }); }, refresh: preview };
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
