#!/usr/bin/env node
/**
 * the precedence-view CLI. Two modes:
 *
 *   precedence-view catalog.pcs [--open]        bake a self-contained HTML copy
 *   precedence-view catalog.pcs --serve         serve the picker, write the export
 *
 * `catalog.pcs` is plain JSON; the `.pcs` extension is just a label. A `.json`
 * file is still accepted. `-` reads the catalog from stdin.
 */
import * as fs from "fs";
import * as path from "path";

import { loadCatalog } from "./model";
import { renderHtml } from "./render";
import { servePlan } from "./serve";
import { openInBrowser } from "./open";

interface Opts { input: string; out: string; open: boolean; stdout: boolean; serve: boolean; }

const HELP = `precedence-view, a browser for catalog.pcs

USAGE
  precedence-view <catalog.pcs>        a catalog file (.pcs or .json), a dir, or -
  precedence-view <catalog.pcs> --serve

OPTIONS
  --serve        serve the picker on 127.0.0.1 and write the exported plan
  --out <file>   bake mode: HTML output (default ./viz/index.html)
                 serve mode: plan output (default ./.precedence/plan.json, - for stdout)
  --open         bake mode: open the file when written (serve mode always opens)
  --stdout       bake mode: write the HTML to stdout
  -h, --help
`;

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n\n${HELP}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { input: "", out: "", open: false, stdout: false, serve: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { process.stdout.write(HELP); process.exit(0); }
    else if (a === "--serve") o.serve = true;
    else if (a === "--out") { o.out = argv[++i] ?? fail("missing value for --out"); }
    else if (a === "--open") o.open = true;
    else if (a === "--stdout") o.stdout = true;
    else if (a.startsWith("--")) fail(`unknown option: ${a}`);
    else o.input = a;
  }
  if (!o.input) fail("no input, pass a catalog.pcs, a directory, or -");
  return o;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { catalog, source, errors } = loadCatalog(opts.input);
  for (const e of errors) process.stderr.write(`error: ${e}\n`);
  if (!catalog) process.exit(1);

  if (opts.serve) {
    const out = opts.out || path.join(".precedence", "plan.json");
    process.stderr.write(`  from ${source}: ${catalog.elements.length} elements, ${catalog.attachPoints ?? "?"} attach points\n`);
    const plan = await servePlan(catalog, { onListen: (url) => process.stderr.write(`  picker: ${url}\n  waiting for the export...\n`) });
    const json = JSON.stringify(plan, null, 2) + "\n";
    if (out === "-") { process.stdout.write(json); return; }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, json);
    process.stderr.write(`  wrote ${out}\n`);
    return;
  }

  const html = renderHtml(catalog);
  if (opts.stdout) { process.stdout.write(html); return; }
  const out = opts.out || path.join("viz", "index.html");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, html);
  process.stdout.write(
    `precedence-view -> ${out}\n` +
    `  from ${source}: ${catalog.elements.length} elements, ${catalog.attachPoints ?? "?"} attach points\n`,
  );
  if (opts.open) openInBrowser(out);
}

main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
