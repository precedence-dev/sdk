/**
 * @precedence-dev/sdk invariants:
 *   - the collection pipeline — canonical envelope, buffer, flush-at-20 /
 *     flush-on-demand / beacon, one fire-and-forget destination (URL | function | console);
 *   - identity — anonymousId always, userId after identify, reset clears both;
 *   - the plan overlay — a loaded plan reshapes a baked `precedence.track` call
 *     by `psc_id` (rename / narrow props / add the discriminator / disable),
 *     stamps `psc_v`; a hand-written call with no `psc_id` passes straight through.
 * Framework-agnostic; the only DOM it touches is a page-hide flush.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { installPrecedence, precedence, precedencePicker, PSC_ID_KEY, PSC_V_KEY, pscId } =
  await import(pathToFileURL(path.resolve(here, "../dist/index.js")).href);

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "\n         " + detail));
  if (!ok) fails++;
};

const STRUCT = "src/Checkout.tsx#Checkout::form|onSubmit|result_ok";
const HASH = pscId(STRUCT);

check("pscId: a short deterministic p_ hash, not the readable id",
  typeof HASH === "string" && HASH.startsWith("p_") && HASH.length < 16 && pscId(STRUCT) === HASH && !HASH.includes("#"));
// KEEP IN SYNC with @precedence-dev/instrument's identical pscId() — same vector asserted there.
check("pscId: known vector — instrument bakes the same hash for the same anchor id",
  HASH === "p_1pmtwplf6av");

/* ---- canonical envelope + buffer + flush ---- */
{
  let batches = [];
  await installPrecedence({ endpoint: (b) => batches.push(b), picker: false });
  precedence.reset();

  precedence.track("checkout_ok", { [PSC_ID_KEY]: HASH, amount: 42 });
  check("pipeline: a track call is buffered, not delivered immediately", batches.length === 0);

  precedence.flush();
  check("pipeline: flush() delivers one batch to the endpoint function", batches.length === 1 && batches[0].length === 1);

  const ev = batches[0][0];
  check("pipeline: canonical track envelope — psc_id stays inside properties, context is just page",
    ev.type === "track" &&
    ev.event === "checkout_ok" &&
    ev.properties.amount === 42 &&
    ev.properties[PSC_ID_KEY] === HASH &&
    !("psc_id" in ev) &&
    Object.keys(ev.context).join() === "page" &&
    typeof ev.anonymousId === "string" && ev.anonymousId.length > 0 &&
    !("userId" in ev) &&
    !Number.isNaN(Date.parse(ev.timestamp)),
    JSON.stringify(ev));

  precedence.flush();
  check("pipeline: flush() with an empty buffer is a no-op (no empty batch sent)", batches.length === 1);

  batches = [];
  for (let i = 0; i < 19; i++) precedence.track("e", { [PSC_ID_KEY]: HASH, amount: i });
  check("pipeline: 19 buffered events have not flushed", batches.length === 0);
  precedence.track("e", { [PSC_ID_KEY]: HASH, amount: 19 });
  check("pipeline: the 20th event triggers an automatic flush", batches.length === 1 && batches[0].length === 20);
}

/* ---- no plan: baked calls emit exactly as written ---- */
{
  const batches = [];
  await installPrecedence({ endpoint: (b) => batches.push(b), picker: false });
  precedence.reset();

  precedence.track("checkout_ok", { [PSC_ID_KEY]: HASH, amount: 5, coupon: "SAVE10" });
  precedence.track("signup_completed", { plan: "pro" });
  precedence.flush();

  const [a, b] = batches.flat();
  check("no plan: a baked call passes through untouched (no prop filtering, no rename, no psc_v)",
    a.event === "checkout_ok" && a.properties.amount === 5 && a.properties.coupon === "SAVE10" &&
    a.properties[PSC_ID_KEY] === HASH && !(PSC_V_KEY in a.properties),
    JSON.stringify(a));
  check("no plan: a hand-written call with no psc_id is a plain track event",
    b.event === "signup_completed" && b.properties.plan === "pro" && !(PSC_ID_KEY in b.properties));
}

/* ---- plan overlay: rename / narrow / discriminator / psc_v / disable ---- */
{
  const GUARD = "src/Checkout.tsx#Checkout::form|onSubmit|guard";
  const plan = {
    version: 7,
    events: [
      { name: "checkout_completed", properties: ["amount"], anchors: [{ id: STRUCT, staticProps: { outcome: "paid" } }] },
      // no anchor for GUARD -> that event is disabled
    ],
  };
  const batches = [];
  await installPrecedence({ plan, endpoint: (b) => batches.push(b), picker: false });
  precedence.reset();

  // baked call: `checkout_ok` with the plan's psc_id + { amount, coupon } and NO outcome
  precedence.track("checkout_ok", { [PSC_ID_KEY]: HASH, amount: 9, coupon: "SAVE10" });
  precedence.flush();
  const ev = batches.flat()[0];
  check("overlay: the plan renames the event, narrows props to its list, ADDS the discriminator, stamps psc_v",
    ev.event === "checkout_completed" &&
    ev.properties.amount === 9 &&
    !("coupon" in ev.properties) &&
    ev.properties.outcome === "paid" &&
    ev.properties[PSC_ID_KEY] === HASH &&
    ev.properties[PSC_V_KEY] === 7,
    JSON.stringify(ev));

  batches.length = 0;
  precedence.track("checkout_guard", { [PSC_ID_KEY]: pscId(GUARD) });
  precedence.track("signup_completed", { plan: "pro" });
  precedence.flush();
  const evs = batches.flat();
  check("overlay: a baked call whose anchor is absent from the loaded plan is dropped (event disabled)",
    evs.length === 1 && evs[0].event === "signup_completed",
    JSON.stringify(evs.map((e) => e.event)));

  batches.length = 0;
  await installPrecedence({ endpoint: (b) => batches.push(b), picker: false });
  precedence.track("checkout_ok", { [PSC_ID_KEY]: HASH, amount: 1, coupon: "X" });
  precedence.flush();
  check("overlay: re-installing without a plan clears it — the baked call is authoritative again",
    batches.flat()[0].event === "checkout_ok" && batches.flat()[0].properties.coupon === "X" &&
    !(PSC_V_KEY in batches.flat()[0].properties));
}

/* ---- identity (anonymousId always, userId after identify, reset clears) ---- */
{
  let batches = [];
  await installPrecedence({ endpoint: (b) => batches.push(b), picker: false });
  precedence.reset();

  precedence.track("first", { [PSC_ID_KEY]: HASH });
  precedence.identify("u_123", { email: "a@b.c" });
  precedence.track("after_identify", { k: "v" });
  precedence.flush();

  const evs = batches.flat();
  const anon = evs[0].anonymousId;
  check("identity: same anonymousId on every event; identify emits a traits event; later events carry userId + anonymousId",
    evs.length === 3 &&
    evs[0].anonymousId === anon && !evs[0].userId &&
    evs[1].type === "identify" && evs[1].traits.email === "a@b.c" && evs[1].userId === "u_123" && evs[1].anonymousId === anon &&
    evs[2].type === "track" && evs[2].userId === "u_123" && evs[2].anonymousId === anon);

  batches = [];
  precedence.reset();
  precedence.track("after_logout");
  precedence.flush();
  const post = batches.flat()[0];
  check("identity: reset() clears both ids — the next event has no userId and a fresh anonymousId",
    !post.userId && typeof post.anonymousId === "string" && post.anonymousId !== anon);
}

/* ---- URL endpoint (POST { batch }) + beacon on page hide ---- */
{
  const posts = [];
  global.fetch = (url, init) => { posts.push({ url, init }); return Promise.resolve({ ok: true }); };
  const beacons = [];
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { sendBeacon: (url, body) => { beacons.push({ url, body }); return true; } },
    configurable: true,
  });
  global.Blob = class { constructor(parts) { this.parts = parts; } };
  const docListeners = [];
  global.document = {
    visibilityState: "hidden",
    addEventListener: (t, fn) => docListeners.push({ t, fn }),
    removeEventListener: (t, fn) => { const i = docListeners.findIndex((l) => l.fn === fn); if (i >= 0) docListeners.splice(i, 1); },
  };
  try {
    await installPrecedence({ endpoint: "https://collect.example.com/e", picker: false });
    precedence.reset();

    precedence.track("manual");
    precedence.flush();
    check("URL endpoint: one POST of { batch: [...] } with a JSON content-type and keepalive",
      posts.length === 1 &&
      posts[0].url === "https://collect.example.com/e" &&
      posts[0].init.method === "POST" &&
      posts[0].init.keepalive === true &&
      JSON.parse(posts[0].init.body).batch.length === 1);

    precedence.track("on_hide");
    docListeners.find((l) => l.t === "visibilitychange").fn(); // page hidden
    check("URL endpoint: on visibilitychange:hidden the buffer flushes via navigator.sendBeacon, not fetch",
      beacons.length === 1 && beacons[0].url === "https://collect.example.com/e" && posts.length === 1);
  } finally {
    delete global.fetch; delete global.Blob; delete global.document;
    if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc);
    else delete globalThis.navigator;
  }
}

/* ---- endpoint omitted -> console.debug each event, no buffering ---- */
{
  const debugged = [];
  const realDebug = console.debug;
  console.debug = (...a) => debugged.push(a);
  try {
    await installPrecedence({ picker: false });
    precedence.reset();
    precedence.track("dev_event");
    check("no endpoint: each event is console.debug'd immediately (dev default)",
      debugged.length === 1 && debugged[0][0] === "[precedence]" && debugged[0][1].event === "dev_event");
  } finally {
    console.debug = realDebug;
  }
}

/* ---- the `?precedence=pick` picker hook ---- */
{
  const appended = [];
  global.document = {
    createElement: () => ({ set src(v) { this._src = v; }, get src() { return this._src; } }),
    head: { appendChild: (n) => appended.push(n) },
    addEventListener() {}, removeEventListener() {},
  };
  const withSearch = (s) => { global.window = { location: { search: s } }; };
  let fetched = false;
  global.fetch = () => { fetched = true; return Promise.resolve({ json: () => ({ events: [] }) }); };
  try {
    withSearch("?precedence=pick&at=http://127.0.0.1:51820");
    await installPrecedence({ planUrl: "/p.json" });
    check("picker hook: ?precedence=pick&at=<localhost> loads agent.js from that origin, skips the plan fetch",
      appended.length === 1 && appended[0].src === "http://127.0.0.1:51820/agent.js" && fetched === false);

    appended.length = 0;
    withSearch("?precedence=pick&at=https://evil.example.com");
    await installPrecedence({ plan: { events: [] } });
    check("picker hook: a non-localhost `at` is refused — nothing injected", appended.length === 0);

    appended.length = 0; fetched = false;
    withSearch("?utm=x");
    await installPrecedence({ plan: { events: [] } });
    check("picker hook: no ?precedence=pick -> normal install, no agent", appended.length === 0);

    appended.length = 0;
    withSearch("?precedence=pick&at=http://localhost:4000");
    check("precedencePicker(): standalone export activates the same way (for instrumentation-client.ts)",
      precedencePicker() === true && appended[0].src === "http://localhost:4000/agent.js");
  } finally {
    delete global.document; delete global.window; delete global.fetch;
  }
}

console.log(fails ? `\n${fails} FAILED` : "\nall invariants hold");
process.exit(fails ? 1 : 0);
