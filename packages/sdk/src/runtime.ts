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
   *  Omit for baked-only. */
  planUrl?: string;
  /** an already-loaded plan overlay, instead of `planUrl` */
  plan?: RuntimePlan;
  /** set false to ignore `?precedence=pick` even in dev (default: honour it) */
  picker?: boolean;
}

export async function installPrecedence(opts: InstallOpts = {}): Promise<void> {
  if (opts.picker !== false && precedencePicker()) return; // dev picker mode — skip the normal wiring
  configure(opts.endpoint);
  setPlan(opts.plan ?? (opts.planUrl ? await fetch(opts.planUrl).then((r) => r.json()) : undefined));
}

/** `?precedence=pick&at=<url>` (from `@precedence-dev/wizard`) loads the picker
 *  agent into this page — the only overlay code is served from `at`, which must
 *  be localhost. Returns true when it activated. Call this on its own (e.g. from
 *  a Next `instrumentation-client.ts`) if you want the picker but not the SDK. */
export function precedencePicker(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get("precedence") !== "pick") return false;
  let at: URL;
  try {
    at = new URL(q.get("at") || "");
  } catch {
    return false;
  }
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(at.hostname)) return false;
  const s = document.createElement("script");
  s.src = new URL("/agent.js", at.origin).href;
  document.head.appendChild(s);
  return true;
}
