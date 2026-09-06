/**
 * The subset of @precedence/cli's catalog.pcs shape this package actually
 * reads. Defined locally, not imported from @precedence/cli — that package
 * is private, and this one has to be installable into any app with zero
 * access to it. catalog.pcs is just data; this is its (public) shape.
 */
export interface CandidateProp { name: string; }
export interface Fingerprint { handler: string; conditionKey: string; }
export interface OutcomeBranch {
  id: string;
  path: string;
  suggestedName: string;
  fingerprint: Fingerprint;
  candidateProps: CandidateProp[];
  children: OutcomeBranch[];
}
export interface Action { name: string; branches: OutcomeBranch[]; }
export interface UiElement {
  file: string;
  line: number;
  component: string;
  tag: string;
  actions: Action[];
}
export interface Catalog { tool: string; elements: UiElement[]; }
