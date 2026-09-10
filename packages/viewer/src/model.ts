/**
 * the precedence-view model locates and validates a `catalog.pcs` (plain JSON;
 * a `.json` file is accepted too). No parsing; the viewer just renders what
 * the analyzer emitted.
 */
import * as fs from "fs";
import * as path from "path";

export interface Catalog {
  tool: string;
  elements: unknown[];
  attachPoints?: number;
  groups?: unknown[];
  [k: string]: unknown;
}

export interface LoadResult {
  catalog: Catalog | null;
  source: string;
  errors: string[];
}

function isCatalog(v: unknown): v is Catalog {
  return !!v && typeof v === "object" && Array.isArray((v as { elements?: unknown }).elements);
}

/** read a catalog from a file, a directory (first *catalog*.pcs, then *.json), or "-" (stdin) */
export function loadCatalog(input: string): LoadResult {
  const errors: string[] = [];

  let text: string;
  let source: string;
  try {
    if (input === "-") {
      text = fs.readFileSync(0, "utf8");
      source = "stdin";
    } else if (fs.statSync(input).isDirectory()) {
      const hit = fs.readdirSync(input)
        .filter((f) => /catalog.*\.(pcs|json)$|\.catalog\.(pcs|json)$/i.test(f))
        .sort((a, b) => (a.endsWith(".pcs") ? 0 : 1) - (b.endsWith(".pcs") ? 0 : 1) || a.localeCompare(b))[0];
      if (!hit) return { catalog: null, source: input, errors: [`no catalog.pcs in ${input}`] };
      source = path.join(input, hit);
      text = fs.readFileSync(source, "utf8");
    } else {
      source = input;
      text = fs.readFileSync(input, "utf8");
    }
  } catch (e) {
    return { catalog: null, source: input, errors: [`cannot read ${input}: ${e instanceof Error ? e.message : e}`] };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { catalog: null, source, errors: [`${source}: not valid JSON (${e instanceof Error ? e.message : e})`] };
  }
  if (!isCatalog(json)) {
    return { catalog: null, source, errors: [`${source}: not a catalog.pcs (no "elements" array)`] };
  }
  return { catalog: json, source, errors };
}
