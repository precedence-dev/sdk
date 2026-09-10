/**
 * The Precedence picker agent. Injected into a running dev build by
 * @precedence-dev/sdk when the page is opened with `?precedence=pick&at=<url>`.
 *
 * Click an interactive element -> resolve it to a catalog entry via the
 * `data-precedence-id` stamp (@precedence-dev/cli/stamp-loader) -> show its
 * outcome branches -> name the ones to track -> POST the plan to the wizard.
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
      return { name: (p.name || "event").trim(), properties: p.props || [],
        anchors: [{ id: id, fingerprint: p.fingerprint, inject: p.inject || "statement" }] };
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
  var picked = {}; // rowId -> { name, fingerprint, inject, props }
  var root, panel, barEl, paused = false;

  fetch(AT + "/catalog").then(function (r) { return r.json(); })
    .then(function (c) { catalog = c; mount(); })
    .catch(function () { alert("Precedence: couldn't load the catalog from " + AT); });

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
      ".br{display:flex;gap:8px;align-items:baseline;padding:5px 0;flex-wrap:wrap}" +
      ".br input[type=text]{flex:1;min-width:140px;font:12px ui-monospace,monospace;border:1px solid #e4e4e2;border-radius:5px;padding:3px 6px}" +
      ".fx{flex-basis:100%;color:#6b6f76;font-size:12px}.hi{outline:2px solid #2f6fed!important;outline-offset:1px}</style>" +
      "<div class=wrap>" +
      "<div class=bar><b>Precedence</b><span class=sp></span><span id=count></span>" +
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
    document.addEventListener("mouseover", onHover, true);
    document.addEventListener("mouseout", function (e) { if (e.target.classList) e.target.classList.remove("hi"); }, true);
    document.addEventListener("click", onClick, true);
  }
  function bar(t) { if (barEl) barEl.textContent = t; }
  function count() { root.getElementById("count").textContent = Object.keys(picked).length + " picked"; }

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

  function show(entry) {
    panel.hidden = false;
    panel.innerHTML = "";
    var h = document.createElement("div");
    h.className = "el"; h.textContent = "<" + entry.tag + ">" + (entry.label ? " " + entry.label : "");
    panel.appendChild(h);
    var loc = document.createElement("div");
    loc.className = "loc";
    loc.textContent = entry.component + "  ·  " + entry.file.replace(/.*\/src\//, "src/") + ":" + entry.line;
    panel.appendChild(loc);
    rowsFor(entry).forEach(function (r) { panel.appendChild(row(r)); });
    count();
  }

  function row(r) {
    var wrap = document.createElement("div");
    wrap.className = "br";
    var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!picked[r.id];
    var name = document.createElement("input"); name.type = "text";
    name.value = (picked[r.id] && picked[r.id].name) || r.suggestedName || "event";
    name.disabled = !cb.checked;
    var fx = document.createElement("span"); fx.className = "fx";
    fx.textContent = r.label + (r.firesWhen ? " — " + r.firesWhen.replace(/^Fires when /, "") : "");
    function sync() {
      if (cb.checked) picked[r.id] = { name: name.value.trim(), fingerprint: r.fingerprint, inject: r.inject, props: r.props };
      else delete picked[r.id];
      name.disabled = !cb.checked;
      count();
    }
    cb.onchange = sync; name.oninput = sync;
    wrap.appendChild(cb); wrap.appendChild(name); wrap.appendChild(fx);
    return wrap;
  }

  function send() {
    var events = toEvents(picked);
    if (!events.length) { bar("nothing checked yet"); return; }
    fetch(AT + "/plan", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "precedence-agent", generated: new Date().toISOString(), events: events }) })
      .then(function (r) { if (!r.ok) throw 0; })
      .then(function () { root.host.remove(); alert("Sent " + events.length + " event(s) to the wizard. Back to your terminal."); })
      .catch(function () { bar("couldn't reach the wizard at " + AT); });
  }
})();
