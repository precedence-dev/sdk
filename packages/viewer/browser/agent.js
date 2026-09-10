/**
 * The Precedence picker agent. Injected into a running dev build by
 * @precedence-dev/sdk when the page is opened with `?precedence=pick&at=<url>`.
 *
 * Click an interactive element -> resolve it to a catalog entry via the
 * `data-precedence-id` stamp (@precedence-dev/cli/stamp-loader) -> the element's
 * outcome tree is shown; check the outcomes worth tracking, name each, add a
 * meaning, tick the properties (including app state — localStorage / context) ->
 * POST the plan to the wizard. Fetches `GET /plan` first so whatever's already
 * tracked shows up, stays checked, and rides along on send (merge, not replace).
 *
 * Vanilla, self-contained, runs in a shadow root so nothing here touches the
 * host app's styles. No build step. The pure helpers are exported for tests
 * (`typeof module` is only truthy under Node's require, never in a <script>).
 */
(function () {
  "use strict";

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
   * itself for "any outcome"); intermediate nodes (guards passed, a loop that
   * still contains outcomes) render as structure only. Pruned out entirely:
   *   - `synthetic` branches ("otherwise, nothing happens")
   *   - a loop whose whole subtree just builds a local array (.push/.splice…)
   *     and produces no call, state write, or outcome — counted in `hidden`.
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
        // a pass-through (guard-passed, a bare container) with nothing trackable
        // under it carries no information the picker can act on
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

  /* resolve `action.forwardsTo` → an outcome tree. Injection anchors are the
   * render-site action(s), real and injectable there. One render site: use its
   * tree, relabelled from the inner control's spliced copy (nicer wording).
   * Several: one node per distinct outcome, anchors merged, picker resolves per
   * instance. */
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

  /* ---- pure: picked nodes -> the plan events @precedence-dev/instrument consumes -- */
  function toEvents(picked) {
    return Object.keys(picked).map(function (id) {
      var p = picked[id];
      var anchors = p.anchors && p.anchors.length
        ? p.anchors
        : [{ id: id, fingerprint: p.fingerprint, inject: p.inject || "statement" }];
      var ev = { name: (p.name || "event").trim(), properties: p.props || [], anchors: anchors };
      if (p.description) ev.description = p.description.trim();
      if (p.accessors && Object.keys(p.accessors).length) ev.accessors = p.accessors;
      return ev;
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { entryFor: entryFor, nodesFor: nodesFor, toEvents: toEvents };
  }
  if (typeof document === "undefined" || !document.currentScript) return; // required for tests, not a browser

  /* ---- browser: the overlay -------------------------------------------------- */
  var AT = new URL(document.currentScript.src).origin;
  var catalog = null;
  var picked = {};   // nodeId -> { name, description, fingerprint, inject, props, accessors, anchors }
  var inPlan = {};    // nodeId -> { name, properties, description }
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

  function seedExisting(plan) {
    ((plan && plan.events) || []).forEach(function (ev) {
      var an = ev.anchors || [];
      if (an.length === 1) {
        var a = an[0];
        inPlan[a.id] = { name: ev.name, properties: ev.properties || [], description: ev.description || "" };
        picked[a.id] = {
          name: ev.name, description: ev.description || "", fingerprint: a.fingerprint,
          inject: a.inject || "statement", props: ev.properties || [], accessors: ev.accessors || {},
        };
      } else if (an.length > 1) {
        carry.push(ev);
      }
    });
  }

  function mount() {
    var host = document.createElement("div");
    host.id = "precedence-picker";
    host.style.cssText = "position:fixed;top:0;right:0;z-index:2147483647;width:384px;max-width:94vw";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      "<style>:host{all:initial}*{box-sizing:border-box;font:13px/1.5 system-ui,sans-serif}" +
      ".wrap{background:#fff;border:1px solid #e4e4e2;border-top:0;border-right:0;border-bottom-left-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.2);overflow:hidden}" +
      ".bar{background:#1c1d1f;color:#fff;padding:9px 12px;display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}" +
      ".bar b{font-weight:650}.bar .sp{flex:1}" +
      ".msg{flex-basis:100%;order:9;color:#c9cbcf;font-size:12px}" +
      "button{font:inherit;border:1px solid #3a3b3e;background:#2a2b2e;color:#fff;border-radius:6px;padding:4px 9px;cursor:pointer}" +
      "button.go{background:#2f9e44;border-color:#2f9e44}button.paused{background:#b5850b;border-color:#b5850b}" +
      ".panel{background:#fff;color:#1c1d1f;max-height:70vh;overflow:auto;padding:12px 14px;border-top:1px solid #e4e4e2}" +
      ".panel[hidden]{display:none}" +
      ".el{font-family:ui-monospace,Menlo,monospace;font-weight:700;word-break:break-all}" +
      ".loc{color:#6b6f76;font-size:11px;margin-bottom:10px;word-break:break-all}" +
      ".nd{margin:1px 0}.nd .nd{margin-left:9px;border-left:1px solid #ececea;padding-left:9px}" +
      ".st{color:#3a3b3e;font-weight:600;font-size:12px;padding:5px 0}" +
      ".st .pi{color:#8a8f98;font-weight:400}" +
      ".hint{color:#9a9ea6;font-size:11px;font-style:italic;padding:3px 0}" +
      ".br{padding:5px 0}" +
      ".brh{display:flex;gap:7px;align-items:flex-start;cursor:pointer}" +
      ".brh .lab{flex:1}.brh input[type=checkbox]{margin-top:3px}" +
      ".tag{font-size:10px;color:#2f9e44;white-space:nowrap;margin-top:2px}" +
      ".fx{color:#6b6f76;font-size:11.5px;margin:1px 0 0 21px}" +
      ".brb{margin:6px 0 4px 21px}.brb[hidden]{display:none}" +
      ".fld{margin-bottom:6px}" +
      ".fld input{width:100%;font:12px ui-monospace,monospace;border:1px solid #e4e4e2;border-radius:5px;padding:3px 6px}" +
      ".ph{color:#6b6f76;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;margin:7px 0 2px}" +
      ".pl{display:flex;flex-wrap:wrap;gap:3px 12px}" +
      ".pl label{font:12px ui-monospace,monospace;display:flex;gap:4px;align-items:center;cursor:pointer}" +
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

  /* the read-only view of what's already in .precedence/plan.json */
  function showPlan() {
    panel.hidden = false;
    panel.innerHTML = "";
    panel.appendChild(el("el", ".precedence/plan.json"));
    var ids = Object.keys(inPlan);
    if (!ids.length && !carry.length) { panel.appendChild(el("loc", "empty — nothing tracked yet")); return; }
    ids.forEach(function (id) { panel.appendChild(planRow(inPlan[id].name, inPlan[id].properties)); });
    carry.forEach(function (e) { panel.appendChild(planRow(e.name, e.properties || [], (e.anchors || []).length + " outcomes")); });
    panel.appendChild(el("loc", "click an element to add to this or edit it"));
  }
  function planRow(name, props, note) {
    var r = el("pe");
    var b = document.createElement("b"); b.textContent = "✓ " + name;
    r.appendChild(b);
    if (props && props.length) r.appendChild(document.createTextNode("  (" + props.join(", ") + ")"));
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
    if (n.trackable) box.appendChild(trackRow(n, entry));
    else box.appendChild(structRow(n));
    (n.children || []).forEach(function (c) { box.appendChild(renderNode(c, entry)); });
    if (n.hidden) box.appendChild(el("hint", "+ " + n.hidden + (n.hidden > 1 ? " steps" : " step") + " with no outcome (not tracked)"));
    return box;
  }

  function perItem() {
    var s = document.createElement("span");
    s.className = "pi"; s.textContent = "  · once per item";
    return s;
  }
  function structRow(n) {
    var d = el("st");
    d.textContent = n.label;
    if (n.perItem) d.appendChild(perItem());
    return d;
  }
  /** the "…, and no error is thrown" tail of firesWhen, unless it just repeats the label */
  function detailOf(n) {
    var det = (n.firesWhen || "").replace(/^Fires when /, "");
    return det && det.replace(/[.\s]+$/, "").toLowerCase() !== String(n.label).toLowerCase() ? det : "";
  }

  function trackRow(n, entry) {
    var ex = inPlan[n.id], cur = picked[n.id];
    var sel = (cur && cur.props) || (ex && ex.properties) || (n.props || []).slice();
    var wrap = el("br");

    var cb = input("checkbox"); cb.checked = !!cur;
    var lab = el("lab", n.label);
    if (n.perItem) lab.appendChild(perItem());
    var head = el("brh");
    head.appendChild(cb); head.appendChild(lab);
    if (ex) head.appendChild(el("tag", "● in plan"));
    head.onclick = function (e) { if (e.target !== cb) { cb.checked = !cb.checked; sync(); } };
    wrap.appendChild(head);

    var det = detailOf(n);
    if (det) wrap.appendChild(el("fx", det));

    var body = el("brb"); body.hidden = !cur;
    var name = input("text");
    name.value = (cur && cur.name) || (ex && ex.name) || n.suggestedName || "event";
    var mean = input("text");
    mean.placeholder = "business definition, success criteria, exclusions";
    mean.value = (cur && cur.description) || (ex && ex.description) || "";
    body.appendChild(field("event name", name));
    body.appendChild(field("what this event means", mean));

    var amb = (catalog && catalog.ambientProps) || [];
    var shown = section(body, "properties to send", n.props || [], sel, null)
              + section(body, "app state — localStorage / context", amb.map(nm), sel, amb);
    if (!shown) body.appendChild(el("ph", "no properties in scope here"));
    wrap.appendChild(body);

    function sync() {
      if (cb.checked) {
        var props = [], acc = {};
        body.querySelectorAll(".pl input").forEach(function (i) {
          if (!i.checked) return;
          props.push(i._pm);
          if (i._amb) acc[i._pm] = i._amb.accessor || i._amb.via;
        });
        picked[n.id] = {
          name: name.value.trim(), description: mean.value.trim(),
          fingerprint: n.fingerprint, inject: n.inject,
          props: props, accessors: acc, anchors: n.anchors || null,
        };
      } else {
        delete picked[n.id];
      }
      body.hidden = !cb.checked;
      count();
    }
    cb.onchange = sync; name.oninput = sync; mean.oninput = sync;
    body.addEventListener("change", function (e) { if (e.target.matches(".pl input")) sync(); });
    return wrap;
  }

  /** append one labelled checkbox section to `body`; returns 1 if it rendered.
   *  `ambient` (or null): the AmbientProp[] backing these names — a checked
   *  ambient entry carries its `accessor` / `via` into the plan. */
  function section(body, title, names, sel, ambient) {
    if (!names.length) return 0;
    body.appendChild(el("ph", title));
    var pl = el("pl");
    names.forEach(function (pn) {
      var meta = ambient && ambient.filter(function (p) { return p.name === pn; })[0];
      var lbl = document.createElement("label");
      var pc = input("checkbox");
      pc.checked = sel.indexOf(pn) >= 0;
      pc._pm = pn; pc._amb = meta || null;
      lbl.appendChild(pc);
      lbl.appendChild(document.createTextNode(pn + (meta && meta.identity ? "  ⚑" : "")));
      pl.appendChild(lbl);
    });
    body.appendChild(pl);
    return 1;
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
