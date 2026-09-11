/**
 * @precedence-dev/viewer invariants: locating/validating a catalog.pcs and baking it
 * into the self-contained index.html. The tree/editor/export UI lives only in
 * index.html and is exercised by hand.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { loadCatalog, renderHtml, servePlan } = await import(pathToFileURL(path.resolve(here, "../dist/index.js")).href);

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "\n         " + detail));
  if (!ok) fails++;
};

const cat = { tool: "precedence", elements: [{ file: "a.tsx", ref: "a.tsx#A::button", actions: [] }], attachPoints: 1 };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-viewer-"));

/* ---- loadCatalog ---- */
fs.writeFileSync(path.join(tmp, "catalog.pcs"), JSON.stringify(cat));
check("loadCatalog: reads a .pcs file", loadCatalog(path.join(tmp, "catalog.pcs")).catalog?.tool === "precedence");
check("loadCatalog: finds catalog.pcs in a directory", loadCatalog(tmp).catalog?.elements.length === 1);

fs.writeFileSync(path.join(tmp, "old.catalog.json"), JSON.stringify(cat));
fs.rmSync(path.join(tmp, "catalog.pcs"));
check("loadCatalog: falls back to a legacy .json catalog in a directory", loadCatalog(tmp).catalog?.tool === "precedence");

fs.writeFileSync(path.join(tmp, "catalog.pcs"), JSON.stringify(cat));
check("loadCatalog: prefers .pcs over .json when both are present",
  loadCatalog(tmp).source.endsWith("catalog.pcs"));

fs.writeFileSync(path.join(tmp, "bad.pcs"), "{ not json");
check("loadCatalog: invalid JSON -> a clear error, no throw",
  loadCatalog(path.join(tmp, "bad.pcs")).catalog === null && /not valid JSON/.test(loadCatalog(path.join(tmp, "bad.pcs")).errors[0]));

fs.writeFileSync(path.join(tmp, "notcat.pcs"), JSON.stringify({ hello: 1 }));
check("loadCatalog: JSON without an elements array -> rejected as not a catalog",
  /not a catalog/.test(loadCatalog(path.join(tmp, "notcat.pcs")).errors[0]));

check("loadCatalog: a missing directory with no catalog -> a clear 'no catalog.pcs' error",
  /no catalog\.pcs/.test(loadCatalog(fs.mkdtempSync(path.join(os.tmpdir(), "pm-empty-"))).errors[0]));

/* ---- renderHtml ---- */
const html = renderHtml(cat);
check("renderHtml: produces a full HTML document", html.startsWith("<!doctype html") || /<html/i.test(html));
check("renderHtml: bakes the catalog into the data script tag",
  html.includes('id="precedence-catalog-data"') && html.includes('"a.tsx#A::button"'));

const evil = renderHtml({ tool: "precedence", elements: [], note: "</script><script>alert(1)</script>" });
const blob = evil.split('id="precedence-catalog-data"')[1].split("</script>")[0];
check("renderHtml: escapes < / > in the blob so it can't break out of the data script tag",
  !blob.includes("<script>") && !blob.includes("</script>") && blob.includes("\\u003c"));

check("renderHtml: no postUrl -> precedence-post stays an inert placeholder",
  /<script id="precedence-post"[^>]*><!--POST--><\/script>/.test(renderHtml(cat)));
check("renderHtml: postUrl -> precedence-post carries it as JSON",
  renderHtml(cat, { postUrl: "/plan" }).includes('<script id="precedence-post" type="application/json">"/plan"</script>'));

/* ---- servePlan: the local receiver behind `precedence-view --serve` / the wizard ---- */
{
  const http = await import("node:http");
  let url;
  const planPromise = servePlan(cat, { open: false, onListen: (u) => { url = u; } });
  await new Promise((r) => setTimeout(r, 50));
  check("servePlan: listens on 127.0.0.1 and reports its URL", /^http:\/\/127\.0\.0\.1:\d+\/$/.test(url || ""));

  const page = await (await fetch(url)).text();
  check("servePlan: GET / serves the picker with the catalog baked in and post pointed at /plan",
    page.includes('"a.tsx#A::button"') && page.includes('<script id="precedence-post" type="application/json">"/plan"</script>'));

  const agent = await fetch(url + "agent.js");
  check("servePlan: GET /agent.js serves the agent with CORS + JS content-type",
    agent.ok && agent.headers.get("access-control-allow-origin") === "*"
      && /javascript/.test(agent.headers.get("content-type") || "")
      && /precedence-picker/.test(await agent.text()));
  const cat2 = await fetch(url + "catalog");
  check("servePlan: GET /catalog serves the catalog JSON with CORS",
    cat2.ok && cat2.headers.get("access-control-allow-origin") === "*"
      && (await cat2.json()).elements[0].ref === "a.tsx#A::button");
  const emptyPlan = await fetch(url + "plan");
  check("servePlan: GET /plan with no existing plan → { events: [] } + CORS",
    emptyPlan.ok && emptyPlan.headers.get("access-control-allow-origin") === "*"
      && JSON.stringify(await emptyPlan.json()) === '{"events":[]}');
  const pre = await fetch(url + "plan", { method: "OPTIONS" });
  check("servePlan: OPTIONS preflight for the cross-origin POST -> 204 + CORS", pre.status === 204 && pre.headers.get("access-control-allow-origin") === "*");

  const sent = { tool: "precedence-agent", events: [{ name: "e1", properties: [], anchors: [] }] };
  const ack = await fetch(url + "plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent) });
  check("servePlan: POST /plan is acknowledged", ack.ok);
  const got = await planPromise;
  check("servePlan: resolves with exactly the posted plan", JSON.stringify(got) === JSON.stringify(sent));
  check("servePlan: the server is closed once it has a plan",
    await fetch(url).then(() => false, () => true));

  const timedOut = await servePlan(cat, { open: false, timeoutMs: 60 }).then(() => null, (e) => e.message);
  check("servePlan: rejects on timeout with a clear message", /timed out/.test(timedOut || ""));

  /* GET /plan echoes the existing plan the wizard seeds, so the agent can show
   * what's tracked and merge instead of replace */
  let u2;
  const p2 = servePlan(cat, { open: false, plan: { events: [{ name: "kept", properties: ["x"], anchors: [{ id: "a.tsx#A::button" }] }] }, onListen: (u) => { u2 = u; } });
  await new Promise((r) => setTimeout(r, 50));
  const seeded = await (await fetch(u2 + "plan")).json();
  check("servePlan: GET /plan returns the seeded existing plan",
    seeded.events.length === 1 && seeded.events[0].name === "kept");
  await fetch(u2 + "plan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  await p2;
}

/* ---- agent.js: the in-page picker's pure logic (require-safe, no DOM) ---- */
{
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { entryFor, nodesFor, toEvents, fromRows, trackCall, cleanName, cleanKey, candsOf, samplePayload } = require(path.resolve(here, "../browser/agent.js"));

  const A = "src/ShiftPage.tsx#ShiftPage::button[update-shifts]";
  const agentCat = { elements: [{
    file: "src/ShiftPage.tsx", line: 304, component: "ShiftPage", tag: "button", label: "Update Shifts",
    ref: "src/ShiftPage.tsx#ShiftPage::button[update-shifts]",
    actions: [{
      name: "onClick", attachId: A + "|onClick", suggestedName: "update_shifts_click", verb: "when clicked",
      firesWhen: "Fires when \"Update Shifts\" is clicked", fingerprint: { handler: "onClick", conditionKey: "" },
      candidateProps: [{ name: "adminId" }],
      branches: [
        // a diff-building loop: no call, no via, just add.push(id) — pure plumbing
        { id: A + "|onClick|each", path: "each", kind: "loop", label: "for each selected shift", firesPerIteration: true,
          fingerprint: {}, candidateProps: [], children: [
            { id: A + "|onClick|each.if", path: "each.if", kind: "nested-if", label: "not in original", terminal: true,
              codeAtPoint: ["add.push(…)"], fingerprint: {}, candidateProps: [], children: [] },
            { id: A + "|onClick|each.else", path: "each.else", kind: "implicit-else", label: "otherwise, nothing happens",
              terminal: true, synthetic: true, fingerprint: {}, candidateProps: [], children: [] },
          ] },
        // the real outcomes: the mutation's callbacks
        { id: A + "|onClick|success", path: "success", kind: "outcome", via: "updateShiftMutation.mutate",
          label: "the request succeeds", terminal: true, firesWhen: "Fires when \"Update Shifts\" is clicked, and the request succeeds",
          suggestedName: "update_shifts_success", fingerprint: { handler: "onClick", conditionKey: "resolved" }, candidateProps: [], children: [] },
        { id: A + "|onClick|error", path: "error", kind: "outcome", via: "updateShiftMutation.mutate",
          label: "the request fails", terminal: true, firesWhen: "Fires when \"Update Shifts\" is clicked, and the request fails",
          suggestedName: "update_shifts_error", fingerprint: { handler: "onClick", conditionKey: "rejected" }, candidateProps: [], children: [] },
      ],
    }],
  }, { file: "src/Other.tsx", line: 40, component: "Other", tag: "button", ref: "src/Other.tsx#Other::button", actions: [] }],
    ambientProps: [
      { name: "accessToken", source: "localStorage", accessor: 'localStorage.getItem("accessToken")', identity: true },
      { name: "isAuthed", source: "context", via: { hook: "useAuth", context: "AuthCtx", path: "isAuthed" } },
    ] };

  const stamp = (v) => ({ closest: (s) => (s === "[data-precedence-id]" && v ? { getAttribute: () => v } : null) });
  // a DOM node with NO data-precedence-id attribute, whose React fiber chain
  // carries the stamp two components up (the portal / non-forwarding case)
  const fiberNode = (ref) => {
    const top = { memoizedProps: ref ? { "data-precedence-id": ref } : {}, return: null };
    const mid = { memoizedProps: { onChange: () => {} }, return: top };
    return { ["__reactFiber$" + Math.random().toString(36).slice(2)]: { return: mid }, closest: () => null };
  };

  check("agent entryFor: a data-precedence-id DOM attribute resolves to its catalog element by exact ref",
    entryFor(stamp(A.split("|")[0]), agentCat)?.component === "ShiftPage");
  check("agent entryFor: no stamp -> null", entryFor(stamp(null), agentCat) === null);
  check("agent entryFor: a ref not in the catalog -> null",
    entryFor(stamp("src/Gone.tsx#Gone::form"), agentCat) === null);
  check("agent entryFor: resolves through the React fiber tree when the DOM carries no stamp (portals / non-forwarding components)",
    entryFor(fiberNode(A.split("|")[0]), agentCat)?.component === "ShiftPage"
      && entryFor(fiberNode(null), agentCat) === null);

  const tree = nodesFor(entryFor(stamp(A.split("|")[0]), agentCat), agentCat);
  const flat = (ns, out = []) => { for (const n of ns) { out.push(n); flat(n.children, out); } return out; };
  const all = flat(tree);
  check("agent nodesFor: one action node, trackable, with its branch subtree as children",
    tree.length === 1 && tree[0].kind === "action" && tree[0].trackable === true
      && tree[0].id === A + "|onClick");
  check("agent nodesFor: the diff-building loop is pruned and counted in `hidden`",
    tree[0].hidden === 1 && !all.some((n) => n.id.includes("|each")),
    JSON.stringify(all.map((n) => n.id)));
  check("agent nodesFor: the synthetic \"nothing happens\" branch never appears",
    !all.some((n) => /nothing happens/i.test(n.label || "")));
  check("agent nodesFor: the two real outcomes survive, trackable, labelled by phrase not slug",
    all.filter((n) => /succeeds|fails/.test(n.label) && n.trackable).length === 2
      && all.some((n) => n.id.endsWith("|success") && n.suggestedName === "update_shifts_success"));

  /* ---- the guard rails: name / key sanitising, value coercion ---- */
  check("agent guardrails: cleanName → snake identifier; cleanKey rejects the reserved psc_id",
    cleanName("  Shifts Updated! ") === "Shifts_Updated"
      && cleanKey("admin id", "x") === "admin_id"
      && cleanKey("psc_id", "adminId") === "adminId"     // reserved → falls back
      && cleanKey("", "adminId") === "adminId");

  /* ---- editor rows -> the plan's { properties, accessors } (no new plan fields) ---- */
  const pa = fromRows([
    { kind: "prop", key: "adminId", name: "adminId" },                     // shorthand
    { kind: "prop", key: "admin_id", name: "adminId" },                    // renamed → accessor is the bare binding
    { kind: "prop", key: "project_categories", name: "project.categories" }, // a flattened object field
    { kind: "ambient", key: "token", accessor: 'localStorage.getItem("t")' }, // ambient read, renamed key
    { kind: "const", key: "surface", value: "admin_portal" },              // literal
    { kind: "const", key: "step", value: 3 },
  ]);
  check("agent fromRows: shorthand → no accessor; rename / flattened field / ambient / const → an accessor expr",
    JSON.stringify(pa.properties) === '["adminId","admin_id","project_categories","token","surface","step"]'
      && pa.accessors.adminId === undefined
      && pa.accessors.admin_id === "adminId"
      && pa.accessors.project_categories === "project.categories"   // flatten = a dotted value expr, flat key
      && pa.accessors.token === 'localStorage.getItem("t")'
      && pa.accessors.surface === '"admin_portal"'
      && pa.accessors.step === "3",
    JSON.stringify(pa));

  const events = toEvents({
    [A + "|onClick|success"]: { name: " shifts_updated ", description: " a save succeeded ",
      fingerprint: { handler: "onClick", conditionKey: "resolved" }, inject: "statement",
      rows: [
        { kind: "prop", key: "adminId", name: "adminId" },
        { kind: "ambient", key: "token", accessor: 'localStorage.getItem("accessToken")' },
        { kind: "const", key: "surface", value: "admin_portal" },
      ] },
    [A + "|onClick|error"]: { name: "shifts_update_failed", fingerprint: {}, inject: "statement", rows: [] },
  });
  check("agent toEvents: rows → { name, properties, accessors, anchors } instrument consumes",
    events.length === 2 && events[0].name === "shifts_updated"
      && JSON.stringify(events[0].properties) === '["adminId","token","surface"]'
      && events[0].accessors.token === 'localStorage.getItem("accessToken")'
      && events[0].accessors.surface === '"admin_portal"'
      && events[0].accessors.adminId === undefined
      && events[0].anchors[0].id.endsWith("|success") && events[0].anchors[0].fingerprint.conditionKey === "resolved");
  check("agent toEvents: no properties / accessors → those keys are omitted",
    !("accessors" in events[1]) && JSON.stringify(events[1].properties) === "[]");
  check("agent toEvents: a per-row `description` is carried through, trimmed; absent when not set",
    events[0].description === "a save succeeded" && !("description" in events[1]));

  /* ---- the payload preview: the exact call instrument bakes ---- */
  const call = trackCall("shifts updated", A + "|onClick|success", [
    { kind: "prop", key: "adminId", name: "adminId" },
    { kind: "const", key: "surface", value: "admin_portal" },
  ]);
  check("agent trackCall: renders precedence.track(name, { psc_id, …selected props })",
    /^precedence\.track\("shifts_updated", \{ psc_id: "p_[a-z0-9]+", adminId, surface: "admin_portal" \}\)$/.test(call), call);

  /* ---- object props: flatten a type-resolved object, leave an inferred one whole ---- */
  check("agent candsOf: a resolved object contributes the whole value + each real field; an inferred one stays whole",
    (() => {
      const resolved = candsOf({ name: "project", shape: "object", src: "resolved", fields: ["categories", "project_id", "map"] });
      const inferred = candsOf({ name: "filtered", shape: "object", src: "observed", fields: ["sort"] });
      return resolved.length === 3
        && resolved[0].expr === null && resolved[0].key === "project"
        && resolved.some((c) => c.key === "project_categories" && c.expr === "project.categories" && c.field)
        && !resolved.some((c) => /map/.test(c.name))   // method-name noise dropped
        && inferred.length === 1;
    })());

  /* ---- the sample payload: placeholder scalars, real object shapes, literal constants ---- */
  const sp = samplePayload("shifts updated", A + "|onClick|success", [
    { kind: "prop", key: "admin_id", name: "adminId" },
    { kind: "prop", key: "project", name: "project" },
    { kind: "const", key: "surface", value: "admin_portal" },
  ], { project: { name: "project", shape: "object", fields: ["categories", "project_id"] } });
  check("agent samplePayload: scalars → ‹placeholder›, object → its field shape, const → the literal, psc_id real",
    sp.event === "shifts_updated"
      && /^p_[a-z0-9]+$/.test(sp.properties.psc_id)
      && sp.properties.admin_id === "‹adminId›"
      && JSON.stringify(sp.properties.project) === '{"categories":"‹categories›","project_id":"‹project_id›"}'
      && sp.properties.surface === "admin_portal",
    JSON.stringify(sp));

  /* forwardsTo: a control that delegates to a prop shows the outcomes from the
   * render site(s) — the picker never surfaces the parent component to the PM */
  const fwdCat = { elements: [
    { file: "src/Modal.tsx", line: 20, component: "CategoryModal", tag: "button", label: "Save",
      ref: "src/Modal.tsx#CategoryModal::button[save]",
      actions: [{
        name: "onClick", attachId: "src/Modal.tsx#CategoryModal::button[save]|onClick",
        firesWhen: "Fires when \"Save\" is clicked", suggestedName: "save_click",
        fingerprint: { handler: "onClick", conditionKey: "" }, candidateProps: [],
        forwardsTo: { prop: "onSave", targets: ["src/Page.tsx#Scores::CategoryModal|onSave"] },
        branches: [
          { id: "src/Modal.tsx#CategoryModal::button[save]|onClick|error", path: "error", label: "an error is thrown",
            terminal: true, firesWhen: "Fires when \"Save\" is clicked, and an error is thrown",
            suggestedName: "save_error", fingerprint: { handler: "onClick", conditionKey: "" }, candidateProps: [], children: [] },
        ],
      }],
    },
    { file: "src/Page.tsx", line: 40, component: "Scores", tag: "CategoryModal", label: "",
      ref: "src/Page.tsx#Scores::CategoryModal",
      actions: [{
        name: "onSave", attachId: "src/Page.tsx#Scores::CategoryModal|onSave",
        firesWhen: "Fires when <CategoryModal> save fires", suggestedName: "categorymodal_save",
        fingerprint: { handler: "onSave", conditionKey: "" }, candidateProps: [],
        branches: [
          { id: "src/Page.tsx#Scores::CategoryModal|onSave|error", path: "error", label: "an error is thrown", terminal: true,
            kind: "catch", firesWhen: "Fires when <CategoryModal> save fires, and an error is thrown",
            suggestedName: "categorymodal_save_error", fingerprint: { handler: "onSave", conditionKey: "" }, candidateProps: [], children: [] },
        ],
      }],
    },
  ] };
  const fwdTree = nodesFor(entryFor(stamp("src/Modal.tsx#CategoryModal::button[save]"), fwdCat), fwdCat);
  const fwdAll = flat(fwdTree);
  const errNode = fwdAll.find((n) => n.label === "an error is thrown");
  check("agent nodesFor: a forwarding control's outcomes come from the render site, keyed for injection there",
    !!errNode && errNode.trackable
      && errNode.id === "src/Page.tsx#Scores::CategoryModal|onSave|error"
      && / "Save" is clicked/.test(errNode.firesWhen),   // display text is the inner control's, not the component's
    JSON.stringify(fwdAll.map((n) => [n.label, n.id])));
  check("agent nodesFor: no component name leaks into a forwarded node's visible text",
    fwdAll.every((n) => !/CategoryModal|<[A-Z]/.test((n.label || "") + " " + (n.firesWhen || ""))));
  check("agent nodesFor: the forwarding action node points 'any outcome' at the render-site action",
    fwdTree[0].anchors && fwdTree[0].anchors[0].id === "src/Page.tsx#Scores::CategoryModal|onSave");
}


/* ---- index.html: guard the two things a silent edit could break — the script
 * must parse, and eventExport() must keep the shape instrument resolves against.
 * The tree/editor UI is exercised by hand + the instrument "viewer contract" test. */
const indexHtml = fs.readFileSync(path.resolve(here, "../index.html"), "utf8");
const appScript = indexHtml.split(/<script>\s*\n\(function \(\) \{/)[1]?.split(/\}\)\(\);\s*<\/script>/)[0];
check("index.html: the picker script is present and syntactically valid",
  (() => { try { new Function(appScript || "throw 0"); return true; } catch { return false; } })());

const exportFn = (appScript || "").split("function eventExport(")[1]?.split("\n  }")[0] || "";
check("index.html: eventExport still emits the keys @precedence-dev/instrument reads",
  /name:\s*e\.name/.test(exportFn)
    && /description:\s*e\.description/.test(exportFn)
    && /properties:/.test(exportFn)
    && /outcomeProp:/.test(exportFn)
    && /anchors:\s*e\.anchors\.map/.test(exportFn)
    && /id:\s*a\.nodeId/.test(exportFn)
    && /fingerprint:\s*a\.fingerprint/.test(exportFn),
  exportFn.slice(0, 300));
check("index.html: the editor carries an event 'meaning' field that flows into the export",
  /function describeEvent\(/.test(appScript || "") && /ev\.description\s*=/.test(appScript || ""));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : "\nall invariants hold");
process.exit(fails ? 1 : 0);
