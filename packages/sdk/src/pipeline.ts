/**
 * The v0 collection pipeline: `@precedence-dev/sdk` *is* the analytics client.
 *
 * Every event — a baked `precedence.track(...)` call, a synthetic-anchor click,
 * or a hand-written `precedence.track` / `identify` — is shaped into one
 * canonical envelope, buffered in memory, and flushed as `{ batch: [...] }` on
 * **20 events**, **10 s**, or **page hide**.
 *
 * `precedence.track` also applies the plan overlay (see `plan.ts`): when a plan
 * is loaded, a baked call's `psc_id` is looked up and the plan gets to rename the
 * event, narrow the props, add the discriminator, or drop it.
 *
 * v0 is deliberately barebones. **Fire-and-forget: a failed flush drops that
 * batch — no retry queue, no durable storage, one destination.** Everything the
 * design doc defers (retry, plan `destinations`, vendor adapters, consent,
 * sessions) is additive over this shape.
 */
import { PSC_ID_KEY, PSC_V_KEY, type RuntimePlan, indexByPscId, selectProps } from "./plan";

/** the canonical envelope — a minimal subset of the Segment message; grows
 *  toward the full shape (`messageId`, `campaign`, `library`, …) in later
 *  versions without breaking this one. */
export interface PrecedenceEvent {
  type: "track" | "identify";
  /** track only */
  event?: string;
  /** track only — the customer's props, plus the reserved `psc_id` (anchor
   *  hash) and, on overlaid events, `psc_v` (plan version) */
  properties?: Record<string, unknown>;
  /** identify only */
  traits?: Record<string, unknown>;
  anonymousId: string;
  /** present on every event once `identify` has been called */
  userId?: string;
  timestamp: string;
  context: PrecedenceContext;
}
export interface PrecedenceContext {
  page?: { url: string; path: string; referrer: string; title: string };
}

/** where events go:
 *  - a **URL** → `POST { batch: [...] }` (`sendBeacon` on page hide, else `fetch(keepalive)`)
 *  - a **function** → you get the batch array (route it yourself)
 *  - **omitted** → `console.debug` each event (dev default) */
export type Endpoint = string | ((batch: PrecedenceEvent[]) => unknown);

const FLUSH_AT = 20;
const FLUSH_INTERVAL_MS = 10_000;
const AID_KEY = "pmid";
const UID_KEY = "pmuid";

let endpoint: Endpoint | undefined;
let planIndex: ReturnType<typeof indexByPscId> | undefined;
let planVersion: number | undefined;
let anonymousId: string | undefined;
let userId: string | undefined;

let buffer: PrecedenceEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let detachUnload: (() => void) | undefined;

/* ---------- identity & storage (one location, not a priority array yet) ---------- */

function ls(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined; // access itself can throw (privacy mode, sandboxed iframe)
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      ((+c ^ (Math.random() * 16)) >> (+c / 4)).toString(16),
    );
  }
}

function getAnonymousId(): string {
  if (anonymousId) return anonymousId;
  const store = ls();
  try {
    const existing = store?.getItem(AID_KEY);
    if (existing) return (anonymousId = existing);
  } catch {
    /* fall through to a fresh in-memory id */
  }
  anonymousId = newId();
  try {
    store?.setItem(AID_KEY, anonymousId);
  } catch {
    /* in-memory only */
  }
  return anonymousId;
}

function loadUserId(): void {
  try {
    userId = ls()?.getItem(UID_KEY) ?? undefined;
  } catch {
    /* stays undefined */
  }
}

/* ---------- envelope ---------- */

function pageContext(): PrecedenceContext["page"] {
  if (typeof document === "undefined" || typeof location === "undefined") return undefined;
  return { url: location.href, path: location.pathname, referrer: document.referrer, title: document.title };
}

function envelope(type: PrecedenceEvent["type"], extra: Partial<PrecedenceEvent>): PrecedenceEvent {
  const ev: PrecedenceEvent = {
    type,
    anonymousId: getAnonymousId(),
    timestamp: new Date().toISOString(),
    context: { page: pageContext() },
    ...extra,
  };
  if (userId) ev.userId = userId;
  return ev;
}

/* ---------- buffer & flush ---------- */

function enqueue(ev: PrecedenceEvent): void {
  if (endpoint === undefined) {
    // dev default: surface each event immediately rather than 10 s later
    console.debug("[precedence]", ev);
    return;
  }
  buffer.push(ev);
  if (buffer.length >= FLUSH_AT) {
    flush();
    return;
  }
  if (timer === undefined && typeof setTimeout === "function") {
    timer = setTimeout(flush, FLUSH_INTERVAL_MS);
    // don't hold a Node process open for a browser SDK's timer
    (timer as { unref?: () => void }).unref?.();
  }
}

/** Send everything buffered now. `beacon` uses `navigator.sendBeacon` (page-hide
 *  path — no response, so those events are treated as sent). */
export function flush(opts?: { beacon?: boolean }): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];

  try {
    if (typeof endpoint === "function") {
      void Promise.resolve(endpoint(batch)).catch(() => {});
      return;
    }
    if (typeof endpoint === "string") {
      deliver(endpoint, { batch }, opts?.beacon ?? false);
    }
  } catch {
    // Fire-and-forget: a delivery failure never surfaces to the app, and in v0
    // the dropped batch is not retried.
  }
}

function deliver(url: string, body: unknown, beacon: boolean): void {
  const json = JSON.stringify(body);

  if (beacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = typeof Blob === "function" ? new Blob([json], { type: "application/json" }) : json;
      if (navigator.sendBeacon(url, blob as BodyInit)) return;
    } catch {
      /* fall through to fetch */
    }
  }

  try {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* fire-and-forget */
  }
}

function armUnloadFlush(): void {
  detachUnload?.();
  detachUnload = undefined;
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;

  const doc = document;
  const onHide = (): void => flush({ beacon: true });
  const onVisibility = (): void => {
    if (doc.visibilityState === "hidden") onHide();
  };
  const target = (globalThis as { addEventListener?: typeof addEventListener; removeEventListener?: typeof removeEventListener });

  try {
    target.addEventListener?.("pagehide", onHide);
  } catch {
    /* no global event target */
  }
  doc.addEventListener("visibilitychange", onVisibility);

  detachUnload = () => {
    try {
      target.removeEventListener?.("pagehide", onHide);
    } catch {
      /* ignore */
    }
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}

/* ---------- public surface ---------- */

/** Point the pipeline at a destination and load persisted identity. Called by
 *  `installPrecedence`; safe to call again to re-point (v0 has one destination). */
export function configure(dest: Endpoint | undefined): void {
  endpoint = dest;
  loadUserId();
  armUnloadFlush();
}

/** Load the plan as the overlay: from now on `precedence.track` reshapes baked
 *  calls to match it (by `psc_id`). Pass `undefined` to clear it — with no plan,
 *  baked calls emit exactly as `precedence-instrument` wrote them. */
export function setPlan(plan: RuntimePlan | undefined): void {
  planIndex = plan ? indexByPscId(plan) : undefined;
  planVersion = plan && typeof plan.version === "number" ? plan.version : undefined;
}

/** Apply the loaded plan (if any) as an overlay on a `track` call, keyed by the
 *  reserved `psc_id` property:
 *   - no plan loaded, or no `psc_id` (a hand-written call) → emit as given;
 *   - plan loaded, `psc_id` matches an anchor → rename / narrow props / add the
 *     discriminator per the plan, and stamp `properties.psc_v`;
 *   - plan loaded, `psc_id` baked but absent from the plan → the event was
 *     disabled: drop it (`null`).
 */
function shapeTrack(name: string, props: Record<string, unknown>): PrecedenceEvent | null {
  const psc = props[PSC_ID_KEY];

  if (planIndex && typeof psc === "string") {
    const hit = planIndex.get(psc);
    if (!hit) return null; // disabled in the plan
    const properties: Record<string, unknown> = { [PSC_ID_KEY]: psc, ...selectProps(hit, props) };
    if (planVersion != null) properties[PSC_V_KEY] = planVersion;
    return envelope("track", { event: hit.event.name, properties });
  }

  return envelope("track", { event: name, properties: props });
}

export const precedence = {
  /** an event — baked by `precedence-instrument` or hand-written. When a plan is
   *  loaded it's reshaped to match (by `psc_id`); otherwise it emits as given. */
  track(name: string, props: Record<string, unknown> = {}): void {
    const ev = shapeTrack(name, props);
    if (ev) enqueue(ev);
  },

  /** store `userId`, emit one `identify`, and from now on stamp `userId` on
   *  every event alongside `anonymousId` (so a warehouse can JOIN the earlier
   *  anonymous-only rows to the known user). */
  identify(id: string, traits?: Record<string, unknown>): void {
    userId = id;
    try {
      ls()?.setItem(UID_KEY, id);
    } catch {
      /* in-memory only */
    }
    enqueue(envelope("identify", traits ? { traits } : {}));
  },

  /** logout — clear both ids; the next event generates a fresh `anonymousId` */
  reset(): void {
    userId = undefined;
    anonymousId = undefined;
    const store = ls();
    try {
      store?.removeItem(AID_KEY);
      store?.removeItem(UID_KEY);
    } catch {
      /* nothing persisted */
    }
  },

  /** force-send the buffer now */
  flush(): void {
    flush();
  },
};
