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
  const { entryFor, rowsFor, toEvents } = require(path.resolve(here, "../browser/agent.js"));

  const agentCat = { elements: [{
    file: "src/Checkout.tsx", line: 12, component: "Checkout", tag: "form", label: "",
    ref: "src/Checkout.tsx#Checkout::form",
    actions: [{
      name: "onSubmit", attachId: "src/Checkout.tsx#Checkout::form|onSubmit", suggestedName: "checkout_submit",
      fingerprint: { handler: "onSubmit", conditionKey: "" }, candidateProps: [], branches: [
        { id: "src/Checkout.tsx#Checkout::form|onSubmit|ok", label: "result.ok", terminal: true, inject: "statement",
          fingerprint: { handler: "onSubmit", conditionKey: "_.ok" }, firesWhen: "Fires when the form is submitted, and result.ok",
          suggestedName: "checkout_ok", candidateProps: [{ name: "result" }], children: [] },
        { id: "src/Checkout.tsx#Checkout::form|onSubmit|guard", label: "!user", terminal: true, inject: "statement",
          fingerprint: { handler: "onSubmit", conditionKey: "!_" }, suggestedName: "checkout_blocked", candidateProps: [{ name: "user" }], children: [] },
      ],
    }],
  }, { file: "src/Other.tsx", line: 40, component: "Other", tag: "button", ref: "src/Other.tsx#Other::button", actions: [] }] };

  // the stamp value IS catalog.elements[].ref (@precedence-dev/cli/stamp-loader)
  const stamp = (v) => ({ closest: (s) => (s === "[data-precedence-id]" && v ? { getAttribute: () => v } : null) });

  check("agent entryFor: a data-precedence-id stamp resolves to its catalog element by exact ref",
    entryFor(stamp("src/Checkout.tsx#Checkout::form"), agentCat)?.component === "Checkout");
  check("agent entryFor: no stamp -> null", entryFor(stamp(null), agentCat) === null);
  check("agent entryFor: a ref not in the catalog -> null",
    entryFor(stamp("src/Gone.tsx#Gone::form"), agentCat) === null);

  const rows = rowsFor(entryFor(stamp("src/Checkout.tsx#Checkout::form"), agentCat));
  check("agent rowsFor: the action + each terminal branch, with fingerprints and props",
    rows.length === 3
      && rows[0].id === "src/Checkout.tsx#Checkout::form|onSubmit"
      && rows.some((r) => r.id.endsWith("|ok") && r.props.includes("result") && r.fingerprint.conditionKey === "_.ok")
      && rows.some((r) => r.id.endsWith("|guard")));

  const events = toEvents({
    "src/Checkout.tsx#Checkout::form|onSubmit|ok": { name: " checkout_ok ", description: " paid checkout ", fingerprint: { handler: "onSubmit", conditionKey: "_.ok" }, inject: "statement", props: ["result"] },
    "src/Checkout.tsx#Checkout::form|onSubmit|guard": { name: "checkout_guard", fingerprint: {}, inject: "statement", props: [] },
  });
  check("agent toEvents: picked rows -> the { name, properties, anchors:[{id,fingerprint,inject}] } instrument consumes",
    events.length === 2 && events[0].name === "checkout_ok" && JSON.stringify(events[0].properties) === '["result"]'
      && events[0].anchors[0].id.endsWith("|ok") && events[0].anchors[0].fingerprint.conditionKey === "_.ok");
  check("agent toEvents: a per-row `description` is carried through, trimmed; absent when not set",
    events[0].description === "paid checkout" && !("description" in events[1]));

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
          { id: "src/Modal.tsx#CategoryModal::button[save]|onClick|ok", path: "ok", label: "runs without error",
            terminal: true, firesWhen: "Fires when \"Save\" is clicked, and no error is thrown",
            suggestedName: "save_ok", fingerprint: { handler: "onClick", conditionKey: "" }, candidateProps: [], children: [] },
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
          { id: "src/Page.tsx#Scores::CategoryModal|onSave|ok", path: "ok", label: "runs without error", terminal: true,
            firesWhen: "Fires when <CategoryModal> save fires, and no error is thrown", suggestedName: "categorymodal_save_ok",
            fingerprint: { handler: "onSave", conditionKey: "" }, candidateProps: [{ name: "categoryIds" }], children: [] },
          { id: "src/Page.tsx#Scores::CategoryModal|onSave|error", path: "error", label: "an error is thrown", terminal: true,
            firesWhen: "Fires when <CategoryModal> save fires, and an error is thrown", suggestedName: "categorymodal_save_error",
            fingerprint: { handler: "onSave", conditionKey: "" }, candidateProps: [], children: [] },
        ],
      }],
    },
  ] };
  const fwdRows = rowsFor(entryFor(stamp("src/Modal.tsx#CategoryModal::button[save]"), fwdCat), fwdCat);
  check("agent rowsFor: a forwarding control's outcomes come from the render site, keyed for injection there",
    fwdRows.length === 3
      && fwdRows[0].anchors.length === 1 && fwdRows[0].anchors[0].id === "src/Page.tsx#Scores::CategoryModal|onSave"
      && fwdRows.some((r) => r.label === "an error is thrown"
        && r.anchors[0].id === "src/Page.tsx#Scores::CategoryModal|onSave|error"
        && / "Save" is clicked/.test(r.firesWhen)),  // display text is the inner control's, not the component's
    JSON.stringify(fwdRows.map((r) => [r.label, r.anchors && r.anchors.map((a) => a.id)])));
  check("agent rowsFor: no component name leaks into a forwarded row's visible text",
    fwdRows.every((r) => !/CategoryModal|<[A-Z]/.test(r.label + " " + (r.firesWhen || ""))));
  const fwdEv = toEvents({ "src/Page.tsx#Scores::CategoryModal|onSave|error": {
    name: "save_failed", fingerprint: {}, props: [], anchors: fwdRows.find((r) => r.label === "an error is thrown").anchors } });
  check("agent toEvents: a forwarded pick plans the render-site anchor",
    fwdEv[0].anchors.length === 1 && fwdEv[0].anchors[0].id === "src/Page.tsx#Scores::CategoryModal|onSave|error");
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
