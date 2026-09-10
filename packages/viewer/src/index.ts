/**
 * @precedence-dev/viewer — serve the live picker and get the exported plan back.
 *
 * The picker UI is `browser/agent.js`, a vanilla overlay `@precedence-dev/sdk`
 * injects into a running dev build (opened with `?precedence=pick&at=<server>`).
 * This module is the Node side: `servePlan` runs the local receiver;
 * `@precedence-dev/wizard` drives it.
 */
export { servePlan } from "./serve";
export type { ServeOpts, Catalog } from "./serve";
export { openInBrowser } from "./open";
