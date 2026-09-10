/**
 * The Precedence picker agent. Injected into a running dev build by
 * @precedence-dev/sdk when the page is opened with `?precedence=pick&at=<url>`.
 *
 * Click an interactive element -> resolve it to a catalog entry via the
 * `data-precedence-id` stamp (@precedence-dev/cli/stamp-loader) -> for each
 * outcome: name it, add a meaning, tick the properties to send -> POST the plan
 * to the wizard. Fetches `GET /plan` first so whatever's already tracked shows
 * up, stays checked, and rides along on send (merge, not replace).
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
    // the stamp IS catalog.elements[].ref (@precedence-dev/cli/stamp-loader) — exact match
    var els = catalog.elements || [];
    for (var i = 0; i < els.length; i++) if (els[i].ref === ref) return els[i];
    return null;
  }

  /* ---- pure: an entry's trackable rows (the action + each terminal branch) -- */
  function rowsFor(entry) {
    function flat(bs, out) { (bs || []).forEach(function (b) { out.push(b); flat(b.children, out); }); return out; }
    var rows = [];
    (entry.actions || []).forEach(function (a) {
      rows.push({ id: a.attachId, fingerprint: a.fingerprint, label: a.name + " (any outcome)", firesWhen: a.firesWhen,
        suggestedName: a.suggestedName, inject: "statement", props: (a.candidateProps || []).map(nm) });
      flat(a.branches, []).filter(function (b) { return b.terminal; }).forEach(function (b) {
        rows.push({ id: b.id, fingerprint: b.fingerprint || a.fingerprint, label: b.label, firesWhen: b.firesWhen,
          suggestedName: b.suggestedName, inject: b.inject || "statement", props: (b.candidateProps || []).map(nm) });
      });
    });
    return rows;
  }
  function nm(p) { return p.name; }

  /* ---- pure: picked rows -> the plan events @precedence-dev/instrument consumes -- */
  function toEvents(picked) {
    return Object.keys(picked).map(function (id) {
      var p = picked[id];
      var ev = { name: (p.name || "event").trim(), properties: p.props || [],
        anchors: [{ id: id, fingerprint: p.fingerprint, inject: p.inject || "statement" }] };
      if (p.description) ev.description = p.description.trim();
      return ev;
    });
  }

  if (typeof module !== "undefined" && module.exports) { module.exports = { entryFor: entryFor, rowsFor: rowsFor, toEvents: toEvents }; }
  if (typeof document === "undefined" || !document.currentScript) return; // required for tests, not a browser

  /* ---- browser: the overlay --------------------------------------------------
   * A right-side drawer. Two modes:
   *   picking (default) — hover highlights trackable elements, a click opens the
   *                       element's outcome rows instead of doing its normal thing.
   *   paused            — the drawer stays, but clicks pass straight through so
   *                       you can navigate the app. Toggle with the pause button.
   */
  var AT = new URL(document.currentScript.src).origin;
  var catalog = null;
  var picked = {};       // rowId -> { name, description, fingerprint, inject, props }
  var inPlan = {};        // rowId -> { name, properties, description } already in .precedence/plan.json
  var carry = [];         // existing multi-anchor (discriminated) events, passed through untouched
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

  /* pre-load whatever's already tracked so it shows up and round-trips on send.
   * single-anchor events become editable rows; discriminated ones ride along in
   * `carry` untouched (the agent's one-row-one-event model can't edit them). */
  function seedExisting(plan) {
    ((plan && plan.events) || []).forEach(function (ev) {
      var an = ev.anchors || [];
      if (an.length === 1) {
        var a = an[0];
        inPlan[a.id] = { name: ev.name, properties: ev.properties || [], description: ev.description || "" };
        picked[a.id] = { name: ev.name, description: ev.description || "",
          fingerprint: a.fingerprint, inject: a.inject || "statement", props: ev.properties || [] };
      } else if (an.length > 1) {
        carry.push(ev);
      }
    });
  }

  function mount() {
    var host = document.createElement("div");
    host.id = "precedence-picker";
    host.style.cssText = "position:fixed;top:0;right:0;z-index:2147483647;width:340px;max-width:92vw";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      "<style>:host{all:initial}*{box-sizing:border-box;font:13px/1.5 system-ui,sans-serif}" +
      ".wrap{background:#fff;border:1px solid #e4e4e2;border-top:0;border-right:0;border-bottom-left-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.2);overflow:hidden}" +
      ".bar{background:#1c1d1f;color:#fff;padding:9px 12px;display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}" +
      ".bar b{font-weight:650}.bar .sp{flex:1}" +
      ".msg{flex-basis:100%;order:9;color:#c9cbcf;font-size:12px}" +
      "button{font:inherit;border:1px solid #3a3b3e;background:#2a2b2e;color:#fff;border-radius:6px;padding:4px 9px;cursor:pointer}" +
      "button.go{background:#2f9e44;border-color:#2f9e44}" +
      "button.paused{background:#b5850b;border-color:#b5850b}" +
      ".panel{background:#fff;color:#1c1d1f;max-height:68vh;overflow:auto;padding:12px 14px;border-top:1px solid #e4e4e2}" +
      ".panel[hidden]{display:none}.el{font-family:ui-monospace,Menlo,monospace;font-weight:700;word-break:break-all}" +
      ".loc{color:#6b6f76;font-size:11px;margin-bottom:8px;word-break:break-all}" +
      ".br{padding:6px 0;border-top:1px solid #f0f0ee}.br:first-of-type{border-top:0}" +
      ".brh{display:flex;gap:8px;align-items:baseline}" +
      ".brh input[type=text]{flex:1;min-width:120px;font:12px ui-monospace,monospace;border:1px solid #e4e4e2;border-radius:5px;padding:3px 6px}" +
      ".tag{font-size:10px;color:#2f9e44;white-space:nowrap}" +
      ".fx{color:#6b6f76;font-size:12px;margin:2px 0 0 22px}" +
      ".brb{margin:6px 0 2px 22px}.brb[hidden]{display:none}" +
      ".brb input[type=text]{width:100%;font:12px system-ui;border:1px solid #e4e4e2;border-radius:5px;padding:3px 6px;margin-bottom:5px}" +
      ".ph{color:#6b6f76;font-size:11px;text-transform:uppercase;letter-spacing:.04em}" +
      ".pl{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:3px}" +
      ".pl label{font:12px ui-monospace,monospace;display:flex;gap:4px;align-items:center}" +
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
    var n = Object.keys(picked).length + carry.length;
    root.getElementById("count").textContent = n + " tracked";
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

  /* the read-only view of what's already in .precedence/plan.json */
  function showPlan() {
    panel.hidden = false;
    panel.innerHTML = "";
    panel.appendChild(el("el", ".precedence/plan.json"));
    var ids = Object.keys(inPlan);
    if (!ids.length && !carry.length) { panel.appendChild(el("loc", "empty — nothing tracked yet")); return; }
    ids.forEach(function (id) {
      var e = inPlan[id];
      panel.appendChild(planRow(e.name, e.properties));
    });
    carry.forEach(function (e) {
      panel.appendChild(planRow(e.name, e.properties || [], (e.anchors || []).length + " outcomes"));
    });
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
    rowsFor(entry).forEach(function (r) { panel.appendChild(row(r)); });
    count();
  }

  function row(r) {
    var ex = inPlan[r.id];
    var cur = picked[r.id];
    var on = !!cur;
    // properties selected right now: the plan's set if it's tracked, else the
    // analyzer's full suggestion list for a fresh pick.
    var sel = (cur && cur.props) || (ex && ex.properties) || r.props.slice();

    var wrap = el("br");
    var head = el("brh");
    var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = on;
    var name = document.createElement("input"); name.type = "text";
    name.value = (cur && cur.name) || (ex && ex.name) || r.suggestedName || "event";
    name.disabled = !on;
    head.appendChild(cb); head.appendChild(name);
    if (ex) { var tag = el("span", "● in plan"); tag.className = "tag"; head.appendChild(tag); }

    var fx = el("fx", r.label + (r.firesWhen ? " — " + r.firesWhen.replace(/^Fires when /, "") : ""));

    var body = el("brb"); body.hidden = !on;
    var mean = document.createElement("input"); mean.type = "text";
    mean.placeholder = "what this event means (optional)";
    mean.value = (cur && cur.description) || (ex && ex.description) || "";
    body.appendChild(mean);
    var pl = el("pl");
    if (r.props.length) {
      body.appendChild(el("span", "properties to send")).className = "ph";
      r.props.forEach(function (pn) {
        var lbl = document.createElement("label");
        var pc = document.createElement("input"); pc.type = "checkbox"; pc.checked = sel.indexOf(pn) >= 0;
        pc._pm = pn; pc.onchange = sync;
        lbl.appendChild(pc); lbl.appendChild(document.createTextNode(pn));
        pl.appendChild(lbl);
      });
      body.appendChild(pl);
    } else {
      body.appendChild(el("span", "no properties in scope here")).className = "ph";
    }

    function selectedProps() {
      var out = [], ins = pl.querySelectorAll("input");
      for (var i = 0; i < ins.length; i++) if (ins[i].checked) out.push(ins[i]._pm);
      return out;
    }
    function sync() {
      if (cb.checked) {
        picked[r.id] = { name: name.value.trim(), description: mean.value.trim(),
          fingerprint: r.fingerprint, inject: r.inject, props: selectedProps() };
      } else {
        delete picked[r.id];
      }
      name.disabled = !cb.checked;
      body.hidden = !cb.checked;
      count();
    }
    cb.onchange = sync; name.oninput = sync; mean.oninput = sync;

    wrap.appendChild(head); wrap.appendChild(fx); wrap.appendChild(body);
    return wrap;
  }

  function send() {
    var events = toEvents(picked).concat(carry);
    if (!events.length) { bar("nothing tracked yet"); return; }
    fetch(AT + "/plan", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "precedence-agent", generated: new Date().toISOString(), events: events }) })
      .then(function (r) { if (!r.ok) throw 0; })
      .then(function () { root.host.remove(); alert("Sent " + events.length + " event(s) to the wizard. Back to your terminal."); })
      .catch(function () { bar("couldn't reach the wizard at " + AT); });
  }
})();
