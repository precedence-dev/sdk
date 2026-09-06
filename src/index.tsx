"use client";
/**
 * <PrecedenceDevtools /> — drop it in your root layout, same pattern as
 * @tanstack/react-query-devtools: a real component in your own tree, not a
 * script injected across a page boundary. No CORS, no bookmarklet, no
 * cross-origin fiber walk — the fiber it reads is its own app's.
 *
 * Tree-shaken out of production the same way every dev-only devtools
 * component is: gate the import/render behind `process.env.NODE_ENV !==
 * "production"` in your own layout (see README) — this package doesn't do
 * that for you, since it can't know your bundler's env-replacement setup.
 */
import { useEffect, useRef, useState } from "react";
import type { Catalog, OutcomeBranch, UiElement } from "./catalog";
import { fiberSource, findElement, flattenBranches } from "./resolve";

export interface PrecedenceDevtoolsProps {
  /** where to fetch catalog.pcs from; default assumes it's in your public/ dir */
  catalogUrl?: string;
  /** where the finished plan is POSTed; default matches @precedence/wizard's local server */
  planEndpoint?: string;
}

interface PlanEntry { name: string; properties: Set<string>; allProps: string[]; fingerprint: OutcomeBranch["fingerprint"]; }

export function PrecedenceDevtools({
  catalogUrl = "/precedence-catalog.pcs",
  planEndpoint = "http://127.0.0.1:51820/plan",
}: PrecedenceDevtoolsProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<UiElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const planRef = useRef<Map<string, PlanEntry>>(new Map());
  const panelRef = useRef<HTMLDivElement>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!open || catalog) return;
    fetch(catalogUrl).then((r) => r.json()).then(setCatalog).catch(() => setNotice(`Couldn't fetch ${catalogUrl}`));
  }, [open, catalog, catalogUrl]);

  useEffect(() => {
    if (!picking) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!catalog) { setNotice("Catalog not loaded yet."); return; }
      const src = fiberSource(target);
      if (!src) {
        setNotice("Can't resolve this element — no React dev source info on this build (likely SWC/Next.js or React 19). This needs the classic Babel dev transform, or the stamp loader wired into your bundler config.");
        setSelected(null);
        return;
      }
      const el = findElement(catalog, src.fileName, src.lineNumber);
      if (!el) {
        setNotice(`No catalog entry at ${src.fileName}:${src.lineNumber} (not a tracked handler, or outside the scanned dirs).`);
        setSelected(null);
        return;
      }
      setNotice(null);
      setSelected(el);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [picking, catalog]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "p") setOpen((o) => !o);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function addToPlan(b: OutcomeBranch): void {
    if (planRef.current.has(b.id)) return;
    planRef.current.set(b.id, {
      name: b.suggestedName,
      properties: new Set(b.candidateProps.map((p) => p.name)),
      allProps: b.candidateProps.map((p) => p.name),
      fingerprint: b.fingerprint,
    });
    forceRender((n) => n + 1);
  }
  function removeFromPlan(id: string): void { planRef.current.delete(id); forceRender((n) => n + 1); }
  function renameEntry(id: string, name: string): void {
    const e = planRef.current.get(id);
    if (e) e.name = name;
    forceRender((n) => n + 1);
  }

  async function save(): Promise<void> {
    const events = [...planRef.current.entries()].map(([id, e]) => ({
      name: e.name, properties: [...e.properties], anchors: [{ id, fingerprint: e.fingerprint }],
    }));
    await fetch(planEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }) });
    setSaved(true);
  }

  const planSize = planRef.current.size;

  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 2147483647, font: "13px -apple-system, Segoe UI, sans-serif" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: 44, height: 44, borderRadius: "50%", background: "#4f46e5", color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.2)" }}
        title="Precedence picker (Alt+Shift+P)"
      >P</button>
      {open && (
        <div ref={panelRef} style={{ position: "absolute", bottom: 52, right: 0, width: 320, maxHeight: 480, overflow: "auto", background: "#fff", border: "1px solid #ddd", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.15)", color: "#1a1a1a" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #eee", fontWeight: 600 }}>
            Precedence picker
            <div style={{ fontWeight: 400, fontSize: 11, color: "#888", marginTop: 2 }}>Alt+Shift+P to toggle</div>
          </div>
          <div style={{ padding: 12 }}>
            <button onClick={() => setPicking((p) => !p)} style={{ padding: "6px 10px", cursor: "pointer" }}>
              {picking ? "Stop picking" : "Pick an element"}
            </button>
            {notice && <div style={{ color: "#c00", marginTop: 8, fontSize: 12 }}>{notice}</div>}
            {selected && (
              <div style={{ marginTop: 10 }}>
                <div><b>{selected.component}</b> &middot; {selected.tag}</div>
                {selected.actions.map((action) =>
                  flattenBranches(action.branches).map((b) => (
                    <div key={b.id}
                      onClick={() => addToPlan(b)}
                      style={{ padding: "6px 8px", marginTop: 6, border: "1px solid #eee", borderRadius: 4, cursor: "pointer", display: "flex", justifyContent: "space-between" }}
                    >
                      <span>{action.name} &rarr; {b.suggestedName}</span>
                      <span style={{ color: "#888", fontSize: 11 }}>{planRef.current.has(b.id) ? "added" : "+ add"}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <div style={{ padding: "0 12px 12px" }}>
            <b>Plan ({planSize})</b>
            {[...planRef.current.entries()].map(([id, e]) => (
              <div key={id} style={{ background: "#fafafa", border: "1px solid #ddd", borderRadius: 6, padding: 8, marginTop: 8 }}>
                <input type="text" value={e.name} onChange={(ev) => renameEntry(id, ev.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: 4 }} />
                <button onClick={() => removeFromPlan(id)} style={{ color: "#c00", background: "none", border: "none", cursor: "pointer", fontSize: 11, marginTop: 4 }}>remove</button>
              </div>
            ))}
            <button onClick={save} disabled={planSize === 0} style={{ width: "100%", padding: 8, marginTop: 10, cursor: "pointer" }}>
              {saved ? "Saved" : "Save & continue"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
