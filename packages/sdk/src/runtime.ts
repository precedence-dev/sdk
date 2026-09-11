/**
 * `installPrecedence` — point the SDK at a destination once, at your app root.
 *
 *   // baked `precedence.track(...)` calls, no plan hosted — they emit as written
 *   installPrecedence({ endpoint: "https://collect.example.com/e" });
 *
 *   // + the live plan overlay: rename / disable / retune events without a rebuild
 *   installPrecedence({ endpoint: "https://collect.example.com/e",
 *                       planUrl: "/precedence-plan.json" });
 *
 * `endpoint` is a URL (POST `{ batch }`), a `(batch) => void` you route yourself,
 * or omitted for `console.debug` (dev default). `planUrl` / `plan` are optional —
 * with neither, the baked calls are authoritative.
 *
 * Also carries the `?precedence=pick&at=<localhost>` picker hook — all the
 * overlay code lives in `@precedence-dev/viewer`, not here.
 */
import type { RuntimePlan } from "./plan";
import { type Endpoint, configure, precedence, setPlan } from "./pipeline";

export { precedence };
export { PSC_ID_KEY, PSC_V_KEY, pscId } from "./plan";
export type { RuntimePlan, PlanEvent, PlanAnchor } from "./plan";
export type { Endpoint, PrecedenceEvent, PrecedenceContext } from "./pipeline";

export interface InstallOpts {
  /** where events go — a URL (POST `{ batch }`), a `(batch) => void` you route
   *  yourself, or omitted for `console.debug` (dev default). */
  endpoint?: Endpoint;
  /** load the plan overlay from here — rename / disable / retune events live.
   *  Omit for baked-only. Cloud/BYOC: `https://<server>/v1/plan`. */
  planUrl?: string;
  /** an already-loaded plan overlay, instead of `planUrl` */
  plan?: RuntimePlan;
  /** sent as `Authorization: Bearer <planToken>` when fetching `planUrl` — the
   *  project API key, for an authenticated Cloud/BYOC plan-delivery endpoint. */
  planToken?: string;
  /** set false to ignore `?precedence=pick` even in dev (default: honour it) */
  picker?: boolean;
  /** origins allowed for the hosted/BYOC picker — forwarded to `precedencePicker` */
  pickerAllow?: string[];
}

export async function installPrecedence(opts: InstallOpts = {}): Promise<void> {
  if (opts.picker !== false && precedencePicker({ allow: opts.pickerAllow })) return; // dev picker mode — skip the normal wiring
  configure(opts.endpoint);
  setPlan(opts.plan ?? (opts.planUrl ? await fetchPlan(opts.planUrl, opts.planToken) : undefined));
}

async function fetchPlan(url: string, token?: string): Promise<RuntimePlan> {
  const r = await fetch(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  return r.json();
}

export interface PickerOpts {
  /** additional origins (hostnames) allowed for the hosted/BYOC picker's `at`
   *  (`?precedence=pick&at=<url>`) — e.g. `["precedence.acme.com"]` for a BYOC
   *  server, or the Precedence Cloud hostname. Dev default (no opts, or an
   *  empty list) stays localhost / 127.0.0.1 / [::1] only; this is the one new
   *  attack surface (`<script src="<at>/agent.js">`), so it's deny-by-default. */
  allow?: string[];
}

/** `?precedence=pick&at=<url>` (from `@precedence-dev/wizard`) loads the picker
 *  agent into this page — the overlay code is served from `at`, which must be
 *  localhost or in `opts.allow`. Returns true when it activated. Call this on
 *  its own (e.g. from a Next `instrumentation-client.ts`) if you want the
 *  picker but not the SDK. */
export function precedencePicker(opts: PickerOpts = {}): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get("precedence") !== "pick") return false;
  let at: URL;
  try {
    at = new URL(q.get("at") || "");
  } catch {
    return false;
  }
  const localhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(at.hostname);
  if (!localhost && !(opts.allow ?? []).includes(at.hostname)) return false;
  const agentUrl = new URL("/agent.js", at.origin);
  const sid = q.get("s");
  if (sid) agentUrl.searchParams.set("s", sid);
  const s = document.createElement("script");
  s.src = agentUrl.href;
  document.head.appendChild(s);
  return true;
}
