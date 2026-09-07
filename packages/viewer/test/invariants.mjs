/**
 * @precedence/viewer invariants: locating/validating a catalog.pcs and baking it
 * into the self-contained index.html. The tree/editor/export UI lives only in
 * index.html and is exercised by hand.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { loadCatalog } = await import(pathToFileURL(path.resolve(here, "../dist/model.js")).href);
const { renderHtml } = await import(pathToFileURL(path.resolve(here, "../dist/render.js")).href);

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

/* ---- index.html: guard the two things a silent edit could break — the script
 * must parse, and eventExport() must keep the shape instrument resolves against.
 * The tree/editor UI is exercised by hand + the instrument "viewer contract" test. */
const indexHtml = fs.readFileSync(path.resolve(here, "../index.html"), "utf8");
const appScript = indexHtml.split(/<script>\s*\n\(function \(\) \{/)[1]?.split(/\}\)\(\);\s*<\/script>/)[0];
check("index.html: the picker script is present and syntactically valid",
  (() => { try { new Function(appScript || "throw 0"); return true; } catch { return false; } })());

const exportFn = (appScript || "").split("function eventExport(")[1]?.split("\n  }")[0] || "";
check("index.html: eventExport still emits the keys @precedence/instrument reads",
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
