/**
 * @precedence/sdk — the runtime half of Precedence: what makes
 * @precedence/instrument's `emit: "runtime"` mode work. Framework-agnostic,
 * zero dependencies, ~1 KB. Call `installPrecedence` once at your app root.
 *
 * It also carries a ~15-line hook: when the page is opened with
 * `?precedence=pick&at=<localhost url>` (by `@precedence/wizard`), it loads the
 * picker agent from that URL. All the overlay code lives in @precedence/viewer,
 * not here.
 */
export { installPrecedence, installFromPlan, precedencePicker, PM_ID_KEY } from "./runtime";
export type { InstallOpts, RuntimePlan, PlanEvent, PlanAnchor } from "./runtime";
