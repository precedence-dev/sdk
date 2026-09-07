/**
 * Serve the picker locally and hand back the plan the user exports.
 *
 * `precedence-view --serve` and `@precedence/wizard` both use this: start an
 * HTTP server on 127.0.0.1, serve the same `index.html` (catalog baked in,
 * `precedence-post` pointed at `/plan`), open a browser, and resolve once the
 * page POSTs its export back. Same origin, so no CORS. One-shot — the server
 * closes as soon as it has a plan.
 */
import * as http from "http";

import type { Catalog } from "./model";
import { renderHtml } from "./render";
import { openInBrowser } from "./open";

export interface ServeOpts {
  /** open a browser at the served URL (default true) */
  open?: boolean;
  /** give up waiting for the export after this long (default 30 min) */
  timeoutMs?: number;
  /** called once the server is listening, with its URL */
  onListen?: (url: string) => void;
}

const MAX_BODY = 8 * 1024 * 1024;

/** Resolves with the plan object the picker POSTs back. Rejects on timeout. */
export function servePlan(catalog: Catalog, opts: ServeOpts = {}): Promise<unknown> {
  const page = renderHtml(catalog, { postUrl: "/plan" });

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }
      if (req.method === "POST" && req.url === "/plan") {
        let body = "";
        req.on("data", (c) => {
          body += c;
          if (body.length > MAX_BODY) { res.writeHead(413); res.end(); req.destroy(); }
        });
        req.on("end", () => {
          let plan: unknown;
          try { plan = JSON.parse(body); }
          catch { res.writeHead(400, { "content-type": "application/json" }); res.end('{"error":"invalid JSON"}'); return; }
          res.writeHead(200, { "content-type": "application/json" });
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
      if (opts.open !== false) openInBrowser(url);
    });
  });
}
