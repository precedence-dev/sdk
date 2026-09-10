/**
 * The tracking plan and the overlay it drives.
 *
 * `@precedence-dev/instrument` bakes a complete `precedence.track("event", {
 * psc_id, ...props })` call at every tracked site. `psc_id` is a short hash of
 * the structural anchor id (`p_…`) — it keeps your file paths out of the bundle
 * and out of any third-party destination, and it's the key the plan overlay
 * matches on. The readable id lives only in the plan.
 *
 * When `installPrecedence` has loaded a plan, `precedence.track` looks the
 * `psc_id` up here and lets the plan override the baked call — rename the event,
 * narrow the property set, add the `outcome` / `placement` discriminator, or (id
 * absent) drop it. The discriminator is *not* baked into source; it's applied
 * here from `anchor.staticProps`.
 *
 * A rename / retarget / discriminator change / prop narrowing / disable is a plan
 * edit that's live immediately; the next `precedence-instrument` build re-bakes
 * the source to match, and the overlay for that anchor goes quiet.
 */

/** reserved property key: the anchor hash on every baked call. */
export const PSC_ID_KEY = "psc_id";
/** reserved property key: the plan version, added by the overlay so a warehouse
 *  row is self-contained. */
export const PSC_V_KEY = "psc_v";

/** cyrb53 — a tiny, dependency-free 53-bit string hash. `@precedence-dev/instrument`
 *  has a byte-for-byte copy; the two must stay in sync (they hash `anchor.id`
 *  the same way so the baked `psc_id` matches this index). */
export function pscId(structuralId: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < structuralId.length; i++) {
    const ch = structuralId.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return "p_" + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface PlanAnchor {
  id: string;
  /** the `outcome` / `placement` discriminator — plan-only, applied by the
   *  overlay, never baked into source */
  staticProps?: Record<string, string>;
}
export interface PlanEvent { name: string; properties: string[]; anchors: PlanAnchor[]; }
export interface RuntimePlan {
  events: PlanEvent[];
  /** surfaced as `properties.psc_v` on overlaid events */
  version?: number;
}

export interface Hit { event: PlanEvent; anchor: PlanAnchor; }

/** index the plan by `psc_id` (the anchor-id hash the baked call carries). */
export function indexByPscId(plan: RuntimePlan): Map<string, Hit> {
  const byId = new Map<string, Hit>();
  for (const event of plan.events) for (const anchor of event.anchors) byId.set(pscId(anchor.id), { event, anchor });
  return byId;
}

/** the plan's current view of a baked call's properties: keep only what the
 *  plan's event still lists (narrowing needs no rebuild — the baked call passes
 *  a superset), then layer the anchor's discriminator on top. */
export function selectProps(hit: Hit, baked: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of hit.event.properties) if (p in baked) out[p] = baked[p];
  return Object.assign(out, hit.anchor.staticProps ?? {});
}
