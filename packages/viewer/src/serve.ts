/**
 * Serve the live picker locally and hand back the plan the user exports.
 *
 * `@precedence-dev/wizard` uses this: start an HTTP server on 127.0.0.1, open
 * the user's running dev app at `?precedence=pick&at=<this server>` so its
 * `@precedence-dev/sdk` loads `agent.js` (the in-page picker), and resolve once
 * the picker POSTs a plan to `/plan`. One-shot — the server closes as soon as
 * it has a plan.
 *
 * Routes:
 *   GET  /agent.js    the in-page picker agent (loaded by @precedence-dev/sdk)
 *   GET  /catalog     the catalog JSON (the agent fetches this)
 *   GET  /plan        the existing plan, so the agent shows what's tracked
 *   POST /plan        the export — resolves servePlan()
 *
 * Every route carries `Access-Control-Allow-Origin: *` because the agent runs
 * on the dev server's origin, not this one.
 */
import * as http from "http";
import * as fs from "fs";
import * as path from "path";

import { openInBrowser } from "./open";

/** the loose shape servePlan needs — really `@precedence-dev/cli`'s Catalog */
export interface Catalog {
  tool: string;
  elements: unknown[];
  attachPoints?: number;
  groups?: unknown[];
  [k: string]: unknown;
}

export interface ServeOpts {
  /** open a browser at the served URL (default true). The wizard passes false
   *  and opens the user's app itself from `onListen`. */
  open?: boolean;
  /** open this URL instead of the served one — e.g. the app at `?precedence=pick` */
  openUrl?: string;
  /** give up waiting for the export after this long (default 30 min) */
  timeoutMs?: number;
  /** called once the server is listening, with its URL */
  onListen?: (url: string) => void;
  /** the existing plan, served at `GET /plan` so the picker shows what's already
   *  tracked and merges rather than replaces */
  plan?: unknown;
}

const MAX_BODY = 8 * 1024 * 1024;
const AGENT = path.join(__dirname, "..", "browser", "agent.js");
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };

/** Resolves with the plan object the in-page picker POSTs back. Rejects on timeout. */
export function servePlan(catalog: Catalog, opts: ServeOpts = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = (req.url || "").split("?")[0];

      if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }

      if (req.method === "GET" && url === "/agent.js") {
        let js: string;
        try { js = fs.readFileSync(AGENT, "utf8"); }
        catch { res.writeHead(500); res.end("// agent.js missing"); return; }
        res.writeHead(200, { ...CORS, "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        res.end(js);
        return;
      }
      if (req.method === "GET" && url === "/catalog") {
        res.writeHead(200, { ...CORS, "content-type": "application/json" });
        res.end(JSON.stringify(catalog));
        return;
      }
      if (req.method === "GET" && url === "/plan") {
        res.writeHead(200, { ...CORS, "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(opts.plan ?? { events: [] }));
        return;
      }
      if (req.method === "POST" && url === "/plan") {
        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > MAX_BODY) { res.writeHead(413, CORS); res.end(); req.destroy(); }
        });
        req.on("end", () => {
          let plan: unknown;
          try { plan = JSON.parse(body); }
          catch { res.writeHead(400, { ...CORS, "content-type": "application/json" }); res.end('{"error":"invalid JSON"}'); return; }
          res.writeHead(200, { ...CORS, "content-type": "application/json" });
          res.end('{"ok":true}');
          done(() => resolve(plan));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const timer = setTimeout(
      () => done(() => reject(new Error("timed out waiting for the picker — nothing was exported"))),
      opts.timeoutMs ?? 30 * 60_000,
    );
    let settled = false;
    function done(then: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      then();
    }

    server.on("error", (err) => done(() => reject(err)));
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const url = `http://127.0.0.1:${port}/`;
      opts.onListen?.(url);
      if (opts.open !== false) openInBrowser(opts.openUrl || url);
    });
  });
}
