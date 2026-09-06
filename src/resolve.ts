/**
 * Resolve a clicked DOM node to a catalog element via React's dev-mode fiber
 * (`_debugSource`: file + line, set by the classic Babel/React dev
 * transform). The honest limit: some builds (Next.js's default SWC
 * compiler, React 19) don't set `_debugSource` at all, and this returns null
 * rather than guessing when that's the case. @precedence/cli's README
 * documents this as the "fiber" rung between the stamp loader and a
 * file-scoped fallback.
 */
import type { Catalog, UiElement } from "./catalog";

export function fiberSource(node: unknown): { fileName: string; lineNumber: number } | null {
  let n = node as (Record<string, unknown> & { parentElement?: unknown }) | null;
  while (n) {
    const key = Object.keys(n).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (key) {
      let fiber = n[key] as { _debugSource?: { fileName: string; lineNumber: number }; return?: unknown } | undefined;
      while (fiber) {
        if (fiber._debugSource) return fiber._debugSource;
        fiber = fiber.return as typeof fiber;
      }
    }
    n = (n.parentElement as typeof n) || null;
  }
  return null;
}

export function findElement(catalog: Catalog, fileName: string, line: number): UiElement | null {
  const norm = fileName.replace(/\\/g, "/");
  for (const el of catalog.elements) {
    if (norm.slice(-el.file.length) !== el.file) continue;
    if (Math.abs(el.line - line) > 2) continue;
    return el;
  }
  return null;
}

export function flattenBranches<T extends { children: T[] }>(bs: T[], out: T[] = []): T[] {
  for (const b of bs) { out.push(b); flattenBranches(b.children, out); }
  return out;
}

/**
 * The activation handshake: `@precedence/wizard` opens
 * `<your-dev-url>?precedence=pick` directly, and this component checks for
 * that query param on mount to open itself with click-picking already armed
 * — no injected script, no separate install step.
 */
export function shouldAutoActivate(search: string): boolean {
  return new URLSearchParams(search).get("precedence") === "pick";
}
