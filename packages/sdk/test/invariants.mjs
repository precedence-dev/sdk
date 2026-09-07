/**
 * @precedence/sdk invariants: the runtime event-id lookup — `installPrecedence`
 * / `installFromPlan`, what makes @precedence/instrument's `emit: "runtime"`
 * mode work. Framework-agnostic; the only DOM it touches is one click listener.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { installFromPlan } = await import(pathToFileURL(path.resolve(here, "../dist/index.js")).href);

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "\n         " + detail));
  if (!ok) fails++;
};

/* ---- installFromPlan: the emit:"runtime" side — id -> event name/props, no rebuild ---- */
{
  const plan = { events: [
    { name: "checkout_ok", properties: ["amount"], anchors: [{ id: "a#Checkout::form|onSubmit|ok" }] },
    { name: "checkout_guard", properties: [], anchors: [{ id: "a#Checkout::form|onSubmit|guard" }] },
    { name: "checkout_done", properties: ["amount"], anchors: [{ id: "a#Checkout::form|onSubmit|done", staticProps: { outcome: "settled" } }] },
  ] };
  const calls = [];
  installFromPlan(plan, (name, props) => calls.push([name, props]));
  globalThis.__pm("a#Checkout::form|onSubmit|ok", { amount: 42 });
  check("installFromPlan: a known anchor id calls track() with the plan's event name",
    calls.length === 1 && calls[0][0] === "checkout_ok" && calls[0][1].amount === 42);

  check("installFromPlan: every payload carries pm_id (the anchor id — instrument's --explain key)",
    calls[0][1].pm_id === "a#Checkout::form|onSubmit|ok");

  globalThis.__pm("a#Checkout::form|onSubmit|unknown-id");
  check("installFromPlan: an id absent from the plan is silently ignored, not thrown", calls.length === 1);

  installFromPlan(plan, () => { throw new Error("analytics unavailable"); });
  let propagated = false;
  try { globalThis.__pm("a#Checkout::form|onSubmit|ok", { amount: 1 }); } catch { propagated = true; }
  check("installFromPlan: a throwing analytics client cannot escape into product control flow", !propagated);

  installFromPlan(plan, () => Promise.reject(new Error("analytics unavailable")));
  globalThis.__pm("a#Checkout::form|onSubmit|ok", { amount: 1 });
  check("installFromPlan: a rejected analytics promise is handled fire-and-forget", true);

  installFromPlan(plan, (name, props) => calls.push([name, props]));

  globalThis.__pm("a#Checkout::form|onSubmit|guard");
  check("installFromPlan: an event with no plan properties fires with just pm_id",
    calls.length === 2 && calls[1][0] === "checkout_guard" && JSON.stringify(calls[1][1]) === JSON.stringify({ pm_id: "a#Checkout::form|onSubmit|guard" }));

  globalThis.__pm("a#Checkout::form|onSubmit|ok", { amount: 5, secret: "drop me" });
  check("installFromPlan: props not in the plan's list are dropped (narrowing = a plan edit, no rebuild)",
    calls[2][1].amount === 5 && !("secret" in calls[2][1]));

  globalThis.__pm("a#Checkout::form|onSubmit|done", { amount: 9 });
  check("installFromPlan: the anchor's staticProps (outcome discriminator) are layered on",
    calls[3][1].outcome === "settled" && calls[3][1].amount === 9);

  const renamed = { events: [{ name: "checkout_success", properties: ["amount"], anchors: [{ id: "a#Checkout::form|onSubmit|ok" }] }] };
  installFromPlan(renamed, (name, props) => calls.push([name, props]));
  globalThis.__pm("a#Checkout::form|onSubmit|ok", { amount: 1 });
  check("installFromPlan: re-installing with a renamed event changes what fires for the same id — no rebuild needed",
    calls[4][0] === "checkout_success");
}

/* ---- installFromPlan: the synthetic-anchor click listener (links / bare buttons) ---- */
{
  const listeners = [];
  const fakeDoc = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
  };
  global.document = fakeDoc;
  try {
    const calls = [];
    const plan = { events: [{ name: "nav_pricing", properties: ["href", "label"], anchors: [{ id: "src/Nav.tsx#Nav::a[Pricing]" }] }] };
    installFromPlan(plan, (name, props) => calls.push([name, props]));

    check("click listener: one capture-phase click listener is registered", listeners.length === 1 && listeners[0].type === "click" && listeners[0].capture === true);

    const anchorEl = { getAttribute: (n) => ({ "data-pm-el": "src/Nav.tsx#Nav::a[Pricing]", href: "/pricing", "aria-label": "Pricing" }[n] ?? null) };
    listeners[0].fn({ target: { closest: (sel) => (sel === "[data-pm-el]" ? anchorEl : null) } });
    check("click listener: a click on a stamped synthetic anchor fires its event with DOM-derived props",
      calls.length === 1 && calls[0][0] === "nav_pricing" && calls[0][1].href === "/pricing" && calls[0][1].label === "Pricing" && calls[0][1].pm_id === "src/Nav.tsx#Nav::a[Pricing]");

    listeners[0].fn({ target: { closest: () => null } });
    check("click listener: a click with no [data-pm-el] ancestor is ignored", calls.length === 1);

    installFromPlan(plan, () => {});
    check("click listener: re-installing detaches the previous listener instead of stacking", listeners.length === 1);
  } finally {
    delete global.document;
  }
}

console.log(fails ? `\n${fails} FAILED` : "\nall invariants hold");
process.exit(fails ? 1 : 0);
