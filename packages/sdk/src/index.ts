/**
 * @precedence-dev/sdk — the client half of Precedence. Framework-agnostic, zero
 * dependencies.
 *
 * `@precedence-dev/instrument` bakes a complete `precedence.track("event", {
 * psc_id, ...props })` call at every tracked site (`psc_id` is a short hash of
 * the anchor). This package collects those (plus hand-written `precedence.track`
 * / `identify`), buffers, batches, and delivers them to one destination.
 *
 *   import { installPrecedence, precedence } from "@precedence-dev/sdk";
 *
 *   installPrecedence({ endpoint: "https://collect.example.com/e" });
 *   // optional: + planUrl to rename / disable / retune events without a rebuild
 *   precedence.identify("u_123", { email: "…" });
 *
 * The `?precedence=pick&at=<localhost>` picker hook lives here too; the overlay
 * itself is served by `@precedence-dev/viewer`.
 */
export { installPrecedence, precedence, precedencePicker, PSC_ID_KEY, PSC_V_KEY, pscId } from "./runtime";
export type {
  InstallOpts,
  RuntimePlan,
  PlanEvent,
  PlanAnchor,
  Endpoint,
  PrecedenceEvent,
  PrecedenceContext,
} from "./runtime";
