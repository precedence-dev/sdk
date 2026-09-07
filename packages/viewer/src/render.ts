/**
 * the precedence-view renderer (CLI path) bakes a catalog into a copy of `index.html`.
 *
 * The viewer (CSS + all the tree / editor / export logic) lives ONLY in
 * `index.html`, which is also the live drag-and-drop frontend. When its
 * `<script id="precedence-catalog-data">` blob is non-empty it skips the drop screen and
 * opens that catalog directly. The CLI just fills that one tag.
 */
import * as fs from "fs";
import * as path from "path";

import type { Catalog } from "./model";

const TEMPLATE = path.join(__dirname, "..", "index.html");
const DATA_TAG = /<script id="precedence-catalog-data"[^>]*>[\s\S]*?<\/script>/;

/** escape for embedding in <script>: `<`/`>` and the JS line terminators U+2028/9 */
function embed(data: unknown): string {
  const hazards = new RegExp("[<>\\u2028\\u2029]", "g");
  return JSON.stringify(data).replace(hazards, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function renderHtml(catalog: Catalog): string {
  let template: string;
  try {
    template = fs.readFileSync(TEMPLATE, "utf8");
  } catch {
    throw new Error(`precedence-view: cannot read the viewer template at ${TEMPLATE}`);
  }
  if (!DATA_TAG.test(template)) {
    throw new Error('precedence-view: index.html has no <script id="precedence-catalog-data"> tag to fill');
  }
  return template.replace(
    DATA_TAG,
    `<script id="precedence-catalog-data" type="application/json">${embed(catalog)}</script>`
  );
}
