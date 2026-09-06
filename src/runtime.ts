/**
 * The runtime half of @precedence/sdk: makes `emit: "runtime"` mode work.
 * @precedence/instrument's runtime mode injects `globalThis.__pm?.("<anchor
 * id>", { ...props })` at each anchor with no static event name/props baked
 * in — this fetches the plan (the same one the picker produced) once, and
 * maps an anchor id back to its event name so a rename/retarget/prop change
 * is a plan edit, not a rebuild.
 */
export interface PlanEvent { name: string; properties: string[]; anchors: { id: string }[]; }
export interface RuntimePlan { events: PlanEvent[]; }

export interface InstallOpts {
  /** where to fetch the plan from; default assumes it's in your public/ dir */
  planUrl?: string;
  /** an already-fetched plan, if you don't want this to fetch it itself */
  plan?: RuntimePlan;
  /** your actual analytics call, e.g. (name, props) => yourAnalyticsClient.track(name, props) */
  track: (name: string, props: Record<string, unknown>) => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __pm: ((id: string, props?: Record<string, unknown>) => void) | undefined;
}

function indexById(plan: RuntimePlan): Map<string, PlanEvent> {
  const byId = new Map<string, PlanEvent>();
  for (const event of plan.events) for (const anchor of event.anchors) byId.set(anchor.id, event);
  return byId;
}

/** Wires up globalThis.__pm from an already-loaded plan — no fetch, directly testable. */
export function installFromPlan(plan: RuntimePlan, track: InstallOpts["track"]): void {
  const byId = indexById(plan);
  globalThis.__pm = (id, props = {}) => {
    const event = byId.get(id);
    if (!event) return;
    track(event.name, props);
  };
}

export async function installPrecedence(opts: InstallOpts): Promise<void> {
  const plan = opts.plan ?? (await fetch(opts.planUrl ?? "/precedence-plan.json").then((r) => r.json()));
  installFromPlan(plan, opts.track);
}
