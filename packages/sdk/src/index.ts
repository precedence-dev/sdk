/**
 * @precedence/sdk — the runtime half of Precedence: what makes
 * @precedence/instrument's `emit: "runtime"` mode work. Framework-agnostic,
 * zero dependencies, ~1 KB. Call `installPrecedence` once at your app root.
 *
 * (A dev-time outcome picker used to live here as a React component; it was
 * removed to keep this package framework-neutral. See git history / the
 * @precedence/viewer static picker.)
 */
export { installPrecedence, installFromPlan, PM_ID_KEY } from "./runtime";
export type { InstallOpts, RuntimePlan, PlanEvent, PlanAnchor } from "./runtime";
