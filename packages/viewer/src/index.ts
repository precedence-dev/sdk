/**
 * @precedence/viewer programmatic entry.
 *
 * The picker UI itself is `index.html` (self-contained). This module is for
 * driving it from Node: bake a catalog into the page (`renderHtml`), or serve
 * it and get the exported plan back (`servePlan`).
 */
export { loadCatalog } from "./model";
export type { Catalog, LoadResult } from "./model";
export { renderHtml } from "./render";
export { servePlan } from "./serve";
export type { ServeOpts } from "./serve";
export { openInBrowser } from "./open";
