/**
 * @precedence/sdk invariants: the resolution algorithm and the runtime
 * event-id lookup are the parts with real logic here (the component itself
 * is UI, exercised by hand against a real app — see README).
 */
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { fiberSource, findElement, flattenBranches, shouldAutoActivate } = await import(pathToFileURL(path.resolve(here, "../dist/resolve.js")).href);
const { PrecedenceDevtools } = await import(pathToFileURL(path.resolve(here, "../dist/devtools.js")).href);
const { installFromPlan } = await import(pathToFileURL(path.resolve(here, "../dist/index.js")).href);
const React = (await import("react")).default;
const { renderToStaticMarkup } = (await import("react-dom/server")).default;

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "\n         " + detail));
  if (!ok) fails++;
};

/* ---- fiberSource: walks the fiber's `return` chain ---- */
const leafFiber = { return: { return: { _debugSource: { fileName: "src/Checkout.tsx", lineNumber: 42 }, return: null } } };
const domNode = { __reactFiber$abc123: leafFiber, parentElement: null };
check("fiberSource: walks up the fiber's `return` chain to find _debugSource",
  JSON.stringify(fiberSource(domNode)) === JSON.stringify({ fileName: "src/Checkout.tsx", lineNumber: 42 }));

const plainDiv = { parentElement: domNode };
check("fiberSource: climbs parentElement when the clicked node itself has no fiber tag",
  fiberSource(plainDiv)?.lineNumber === 42);

check("fiberSource: no fiber anywhere in the ancestry resolves to null (the SWC/React 19 case)",
  fiberSource({ parentElement: { parentElement: null } }) === null);

check("fiberSource: recognises the older __reactInternalInstance$ tag too",
  fiberSource({ __reactInternalInstance$xyz: leafFiber, parentElement: null })?.lineNumber === 42);

/* ---- findElement: file suffix + a small line-drift tolerance ---- */
const catalog = {
  tool: "precedence",
  elements: [
    { file: "src/Checkout.tsx", line: 12, component: "Checkout", tag: "form", actions: [] },
    { file: "src/Other.tsx", line: 12, component: "Other", tag: "div", actions: [] },
  ],
};
check("findElement: resolves an absolute-looking path by file suffix + line tolerance",
  findElement(catalog, "C:\\repo\\src\\Checkout.tsx", 13)?.component === "Checkout");
check("findElement: a real file but a line far from any element resolves to null, not a wrong guess",
  findElement(catalog, "src/Checkout.tsx", 500) === null);
check("findElement: a file not in the catalog resolves to null",
  findElement(catalog, "src/NotScanned.tsx", 1) === null);
check("findElement: doesn't confuse two files that share a line number",
  findElement(catalog, "src/Other.tsx", 12)?.component === "Other");

/* ---- flattenBranches: depth-first, includes every nested child ---- */
const tree = [{ id: "a", children: [{ id: "a.1", children: [{ id: "a.1.1", children: [] }] }] }, { id: "b", children: [] }];
check("flattenBranches: flattens nested children, preserves every node",
  flattenBranches(tree).map((b) => b.id).join(",") === "a,a.1,a.1.1,b");

/* ---- shouldAutoActivate: the wizard's ?precedence=pick handshake, no postMessage/opener needed ---- */
check("shouldAutoActivate: true for ?precedence=pick", shouldAutoActivate("?precedence=pick") === true);
check("shouldAutoActivate: false with no query string at all", shouldAutoActivate("") === false);
check("shouldAutoActivate: false for an unrelated query param", shouldAutoActivate("?foo=bar") === false);
check("shouldAutoActivate: false for the right key, wrong value (doesn't fire on just any 'precedence' param)",
  shouldAutoActivate("?precedence=other") === false);

/* ---- the component itself: renders without throwing, server-side (no jsdom needed) ---- */
const markup = renderToStaticMarkup(React.createElement(PrecedenceDevtools, {}));
check("PrecedenceDevtools: renders with defaults, no crash, produces the floating button",
  markup.includes(">P<"));
const markupCustom = renderToStaticMarkup(React.createElement(PrecedenceDevtools, { catalogUrl: "/x.pcs", planEndpoint: "http://x" }));
check("PrecedenceDevtools: accepts catalogUrl/planEndpoint props without crashing",
  markupCustom.includes(">P<"));

/* ---- installFromPlan: the emit:"runtime" side — id -> event name/props, no rebuild ---- */
{
  const plan = { events: [
    { name: "checkout_ok", properties: ["amount"], anchors: [{ id: "a#Checkout::form|onSubmit|ok" }] },
    { name: "checkout_guard", properties: [], anchors: [{ id: "a#Checkout::form|onSubmit|guard" }] },
  ] };
  const calls = [];
  installFromPlan(plan, (name, props) => calls.push([name, props]));
  globalThis.__pm("a#Checkout::form|onSubmit|ok", { amount: 42 });
  check("installFromPlan: a known anchor id calls track() with the plan's event name",
    calls.length === 1 && calls[0][0] === "checkout_ok" && calls[0][1].amount === 42);

  globalThis.__pm("a#Checkout::form|onSubmit|unknown-id");
  check("installFromPlan: an id absent from the plan is silently ignored, not thrown", calls.length === 1);

  globalThis.__pm("a#Checkout::form|onSubmit|guard");
  check("installFromPlan: an event with no properties still fires with an empty object",
    calls.length === 2 && calls[1][0] === "checkout_guard" && JSON.stringify(calls[1][1]) === "{}");

  const renamed = { events: [{ name: "checkout_success", properties: ["amount"], anchors: [{ id: "a#Checkout::form|onSubmit|ok" }] }] };
  installFromPlan(renamed, (name, props) => calls.push([name, props]));
  globalThis.__pm("a#Checkout::form|onSubmit|ok", { amount: 1 });
  check("installFromPlan: re-installing with a renamed event changes what fires for the same id — no rebuild needed",
    calls[2][0] === "checkout_success");
}

console.log(fails ? `\n${fails} FAILED` : "\nall invariants hold");
process.exit(fails ? 1 : 0);
