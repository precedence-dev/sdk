/**
 * Main entry: the runtime half only, no React. `import { PrecedenceDevtools }
 * from "@precedence/sdk/devtools"` is the separate, React-dependent subpath —
 * split so installing the runtime doesn't pull JSX-requiring code into a
 * bundle that never renders it.
 */
export { installPrecedence, installFromPlan } from "./runtime";
export type { InstallOpts, RuntimePlan, PlanEvent } from "./runtime";
