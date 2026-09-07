#!/usr/bin/env node
/**
 * the precedence-view CLI bakes a `catalog.pcs` into a self-contained HTML
 * viewer (the same page as the live drag-and-drop frontend, with the catalog
 * pre-loaded). For sharing or CI artifacts.
 *
 *   precedence-view catalog.pcs
 *   precedence-view ./build            # first catalog.pcs in a dir
 *   precedence --stdout | precedence-view -
 *
 * `catalog.pcs` is plain JSON; the `.pcs` extension is just a label. A `.json`
 * file is still accepted.
 */
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";

import { loadCatalog } from "./model";
import { renderHtml } from "./render";

interface Opts { input: string; out: string; open: boolean; stdout: boolean; }

const HELP = `precedence-view, a browser for catalog.pcs

  The frontend is index.html: open it and drop a catalog.pcs onto it, or pass
  ?src=<url>. This CLI is the batch path, it bakes the same viewer with a
  catalog already loaded.

USAGE
  precedence-view <catalog.pcs>        a catalog file (.pcs or .json)
  precedence-view <dir>                first catalog.pcs in a dir
  precedence-view -                    read the catalog from stdin

OPTIONS
  --out <file>   HTML output path       (default ./viz/index.html)
  --open         open it when written
  --stdout       write the HTML to stdout
  -h, --help
`;

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n\n${HELP}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { input: "", out: path.join("viz", "index.html"), open: false, stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { process.stdout.write(HELP); process.exit(0); }
    else if (a === "--out") { o.out = argv[++i] ?? fail("missing value for --out"); }
    else if (a === "--open") o.open = true;
    else if (a === "--stdout") o.stdout = true;
    else if (a.startsWith("--")) fail(`unknown option: ${a}`);
    else o.input = a;
  }
  if (!o.input) fail("no input, pass a catalog.pcs, a directory, or -");
  return o;
}

function openInBrowser(file: string): void {
  const target = path.resolve(file);
  const cmd = process.platform === "win32" ? { file: "cmd", args: ["/c", "start", "", target] }
    : process.platform === "darwin" ? { file: "open", args: [target] }
    : { file: "xdg-open", args: [target] };
  execFile(cmd.file, cmd.args, (err) => {
    if (err) process.stderr.write(`note: could not open a browser (${err.message})\n`);
  });
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const { catalog, source, errors } = loadCatalog(opts.input);
  for (const e of errors) process.stderr.write(`error: ${e}\n`);
  if (!catalog) process.exit(1);

  const html = renderHtml(catalog);
  if (opts.stdout) { process.stdout.write(html); return; }

  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  fs.writeFileSync(opts.out, html);
  process.stdout.write(
    `precedence-view -> ${opts.out}\n` +
    `  from ${source}: ${catalog.elements.length} elements, ${catalog.attachPoints ?? "?"} attach points\n`
  );
  if (opts.open) openInBrowser(opts.out);
}

main();
