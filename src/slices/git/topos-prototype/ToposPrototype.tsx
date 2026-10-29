// PROTOTYPE (#351). Shell around the graph canvas: knobs for the open
// questions, a worker session, a performance HUD with a scroll benchmark, and
// the floating preset switcher. Throwaway: lives on the ticket-351 branch only.

import { useCallback, useEffect, useRef, useState } from "react";
import { GraphViewport, type ViewportStats } from "./GraphViewport";
import {
  CHUNK_CHOICES, COMMIT_CHOICES, CONCURRENCY_CHOICES, PRESETS, knobsToSearch, matchingPreset, parseKnobs, type Knobs,
} from "./knobs";
import type { OpenRequest, WorkerEvent } from "./protocol";
import { GraphStore } from "./store";

const PAGE_SIZE = 512;
const DATA_URL = new URL("./data/", window.location.href).href;

interface LoadStats {
  phase: "loading" | "streaming" | "done" | "failed";
  error?: string;
  sourceMs: number;
  firstRowsMs: number;
  totalMs: number;
  workerLayoutMs: number;
  mainIngestMs: number;
  maxIngestMs: number;
  bytes: number;
  pages: number;
  maxLanes: number;
}

const emptyLoad = (): LoadStats => ({
  phase: "loading", sourceMs: 0, firstRowsMs: 0, totalMs: 0, workerLayoutMs: 0, mainIngestMs: 0, maxIngestMs: 0, bytes: 0, pages: 0, maxLanes: 0,
});

interface BenchResult {
  id: number;
  label: string;
  frames: number;
  avgFps: number;
  p95: number;
  max: number;
  slow: number;
}

function useKnobs(): [Knobs, (patch: Partial<Knobs>) => void] {
  const [knobs, setKnobs] = useState(() => parseKnobs(window.location.search));
  const update = useCallback((patch: Partial<Knobs>) => {
    setKnobs((prev) => {
      const next = { ...prev, ...patch };
      window.history.replaceState(null, "", `${window.location.pathname}${knobsToSearch(next)}`);
      return next;
    });
  }, []);
  return [knobs, update];
}

export function ToposPrototype() {
  const [knobs, setKnob] = useKnobs();
  const [repos, setRepos] = useState<string[]>([]);
  const [store, setStore] = useState(() => new GraphStore(PAGE_SIZE));
  const [version, setVersion] = useState(0);
  const [load, setLoad] = useState<LoadStats>(emptyLoad);
  const [bench, setBench] = useState<BenchResult[]>([]);
  const [benchRunning, setBenchRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stats = useRef<ViewportStats>({ buildMs: 0, visibleEdges: 0, windowRows: 0, renders: 0, graphLanes: 0 });
  const worker = useRef<Worker | null>(null);
  const session = useRef(0);

  useEffect(() => {
    fetch(new URL("index.json", DATA_URL))
      .then((r) => (r.ok ? r.json() : []))
      .then((names: unknown) => setRepos(Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : []))
      .catch(() => setRepos([]));
  }, []);

  useEffect(() => {
    const w = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    return () => w.terminate();
  }, []);

  // One live session; a new one cancels the old, and stale messages are dropped by sessionId.
  useEffect(() => {
    const w = worker.current;
    if (!w) return;
    const sessionId = ++session.current;
    const fresh = new GraphStore(PAGE_SIZE);
    const stat = emptyLoad();
    const t0 = performance.now();
    let pending = 0;
    setStore(fresh);
    setLoad({ ...stat });
    setVersion(0);
    scrollRef.current?.scrollTo({ top: 0 });

    const flush = () => {
      pending = 0;
      setVersion((v) => v + 1);
      setLoad({ ...stat });
    };
    w.onmessage = (e: MessageEvent<WorkerEvent>) => {
      const ev = e.data;
      if (ev.sessionId !== session.current) return;
      if (ev.event === "started") {
        stat.sourceMs = ev.sourceMs;
        stat.phase = "streaming";
      } else if (ev.event === "rows") {
        const ms = fresh.ingest(ev.format, ev.body);
        if (stat.pages === 0) stat.firstRowsMs = performance.now() - t0;
        stat.pages++;
        stat.mainIngestMs += ms;
        stat.maxIngestMs = Math.max(stat.maxIngestMs, ms);
        stat.workerLayoutMs += ev.layoutMs;
        stat.bytes += ev.bytes;
        stat.maxLanes = fresh.maxLanes;
      } else if (ev.event === "done") {
        stat.phase = "done";
        stat.totalMs = performance.now() - t0;
        stat.maxLanes = ev.maxLanes;
      } else {
        stat.phase = "failed";
        stat.error = ev.error;
      }
      if (pending === 0) pending = requestAnimationFrame(flush);
    };
    const source: OpenRequest["source"] = knobs.source === "syn"
      ? { kind: "synthetic", commits: knobs.commits, concurrency: knobs.concurrency, seed: 351 }
      : { kind: "repo", name: knobs.source, dataUrl: DATA_URL };
    w.postMessage({ type: "open", sessionId, source, clash: knobs.clash, payload: knobs.payload, pageSize: PAGE_SIZE } satisfies OpenRequest);
    return () => {
      cancelAnimationFrame(pending);
      w.postMessage({ type: "close", sessionId });
    };
  }, [knobs.source, knobs.commits, knobs.concurrency, knobs.clash, knobs.payload]);

  const runBench = useCallback((label: string, step: (el: HTMLDivElement, dt: number) => void, seconds: number) => {
    const el = scrollRef.current;
    if (!el || benchRunning) return;
    setBenchRunning(true);
    el.scrollTop = 0;
    const deltas: number[] = [];
    let prev = performance.now();
    const end = prev + seconds * 1000;
    const tick = (now: number) => {
      deltas.push(now - prev);
      step(el, now - prev);
      prev = now;
      if (now < end) {
        requestAnimationFrame(tick);
        return;
      }
      deltas.shift();
      const sorted = [...deltas].sort((a, b) => a - b);
      const sum = deltas.reduce((a, b) => a + b, 0);
      setBench((b) => [{
        id: now,
        label,
        frames: deltas.length,
        avgFps: (deltas.length * 1000) / sum,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        slow: deltas.filter((d) => d > 20).length,
      }, ...b].slice(0, 6));
      setBenchRunning(false);
    };
    requestAnimationFrame((now) => { prev = now; requestAnimationFrame(tick); });
  }, [benchRunning]);

  // ←/→ cycle the presets, except while a form control has focus.
  const presetIndex = matchingPreset(knobs);
  const cycle = useCallback((dir: number) => {
    const from = presetIndex < 0 ? (dir > 0 ? -1 : 0) : presetIndex;
    const next = (from + dir + PRESETS.length) % PRESETS.length;
    setKnob(PRESETS[next].knobs);
  }, [presetIndex, setKnob]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, select, textarea, [contenteditable]") || t.getAttribute("role") === "listbox")) return;
      if (e.key === "ArrowLeft") cycle(-1);
      if (e.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycle]);

  return (
    <div className={`topos-root topos-${knobs.theme}`}>
      <aside className="topos-panel" aria-label="Prototype controls">
        <h1 className="text-sm font-semibold">Topos graph prototype <span className="topos-badge">#351</span></h1>
        <p className="topos-note">Throwaway. Every open question from the ticket is a control below.</p>

        <Section title="Data">
          <Select label="Source" value={knobs.source} onChange={(v) => setKnob({ source: v })}
            options={[["syn", "Synthetic history"], ...repos.map((r): [string, string] => [r, `Repo: ${r}`])]} />
          {knobs.source === "syn" && (
            <>
              <Select label="Commits" value={String(knobs.commits)} onChange={(v) => setKnob({ commits: Number(v) })}
                options={COMMIT_CHOICES.map((c): [string, string] => [String(c), c.toLocaleString()])} />
              <Select label="Live branches" value={String(knobs.concurrency)} onChange={(v) => setKnob({ concurrency: Number(v) })}
                options={CONCURRENCY_CHOICES.map((c): [string, string] => [String(c), c === 30 ? "30 (stress)" : String(c)])} />
            </>
          )}
          <Select label="Payload" value={knobs.payload} onChange={(v) => setKnob({ payload: v as Knobs["payload"] })}
            options={[["columnar", "Typed arrays (ArrayBuffer)"], ["json", "JSON objects"]]} />
        </Section>

        <Section title="Ribbons">
          <Select label="Edge style" value={knobs.style} onChange={(v) => setKnob({ style: v as Knobs["style"] })}
            options={[["scurve", "S-curve"], ["elbow", "Rounded elbow"]]} />
          {knobs.style === "scurve"
            ? <Range label="Curve factor k" value={knobs.k} min={0.4} max={0.9} step={0.01} onChange={(v) => setKnob({ k: v })} />
            : <Range label="Corner radius ρ" value={knobs.rho} min={1} max={14} step={0.5} onChange={(v) => setKnob({ rho: v })} />}
          <Range label="Row height H" value={knobs.H} min={18} max={40} step={1} onChange={(v) => setKnob({ H: v })} />
          <Range label="Lane width W" value={knobs.W} min={10} max={28} step={1} onChange={(v) => setKnob({ W: v })} />
          <Range label="Node radius R" value={knobs.R} min={2.5} max={8} step={0.5} onChange={(v) => setKnob({ R: v })} />
          {knobs.style === "scurve" && knobs.k * knobs.H < knobs.R && <p className="topos-warn">k·H &lt; R: the curve leaves the node from its side.</p>}
        </Section>

        <Section title="Column and color">
          <Select label="Graph width" value={knobs.width} onChange={(v) => setKnob({ width: v as Knobs["width"] })}
            options={[["global", "Global maximum"], ["visible", "Visible rows"], ["resizable", "User-resizable"]]} />
          {knobs.width !== "resizable" && <Range label="Lane cap" value={knobs.cap} min={2} max={60} step={1} onChange={(v) => setKnob({ cap: v })} />}
          <Select label="Clash probing" value={knobs.clash} onChange={(v) => setKnob({ clash: v as Knobs["clash"] })}
            options={[["off", "Off (pure hash)"], ["derived", "Derived + anonymous tracks"], ["all", "All non-default tracks"]]} />
          <Select label="Theme" value={knobs.theme} onChange={(v) => setKnob({ theme: v as Knobs["theme"] })}
            options={[["dark", "Dark"], ["light", "Light"]]} />
          <label className="topos-check">
            <input type="checkbox" checked={knobs.sticky} onChange={(e) => setKnob({ sticky: e.target.checked })} />
            Sticky branch badges
          </label>
        </Section>

        <Section title="Windowing">
          <Select label="Re-render every" value={String(knobs.chunk)} onChange={(v) => setKnob({ chunk: Number(v) })}
            options={CHUNK_CHOICES.map((c): [string, string] => [String(c), `${c} row${c === 1 ? "" : "s"}`])} />
          <Range label="Overscan rows" value={knobs.overscan} min={0} max={60} step={1} onChange={(v) => setKnob({ overscan: v })} />
        </Section>

        <Hud load={load} store={store} stats={stats} H={knobs.H} />

        <Section title="Scroll benchmark">
          <div className="flex flex-wrap gap-1">
            <button type="button" className="topos-btn" disabled={benchRunning}
              onClick={() => runBench("steady 3000 px/s", (el, dt) => { el.scrollTop += (3000 * dt) / 1000; }, 5)}>Steady</button>
            <button type="button" className="topos-btn" disabled={benchRunning}
              onClick={() => runBench("fling 15000 px/s", (el, dt) => { el.scrollTop += (15000 * dt) / 1000; }, 5)}>Fling</button>
            <button type="button" className="topos-btn" disabled={benchRunning}
              onClick={() => runBench("random jumps", (el) => { el.scrollTop = Math.random() * el.scrollHeight; }, 5)}>Jumps</button>
          </div>
          <table className="topos-table">
            <thead><tr><th>Run</th><th>fps</th><th>p95</th><th>max</th><th>&gt;20ms</th></tr></thead>
            <tbody>
              {bench.map((b) => (
                <tr key={b.id}>
                  <td>{b.label}</td><td>{b.avgFps.toFixed(0)}</td><td>{b.p95.toFixed(1)}</td><td>{b.max.toFixed(0)}</td><td>{b.slow}/{b.frames}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </aside>

      <main className="topos-main">
        <GraphViewport store={store} version={version} knobs={knobs} scrollRef={scrollRef} stats={stats} />
      </main>

      <div className="topos-switcher" role="group" aria-label="Preset switcher">
        <button type="button" aria-label="Previous preset" onClick={() => cycle(-1)}>←</button>
        <span>{presetIndex >= 0 ? `${PRESETS[presetIndex].key} (${PRESETS[presetIndex].name})` : "Custom"}</span>
        <button type="button" aria-label="Next preset" onClick={() => cycle(1)}>→</button>
      </div>
    </div>
  );
}

function Hud({ load, store, stats, H }: { load: LoadStats; store: GraphStore; stats: React.RefObject<ViewportStats>; H: number }) {
  const [fps, setFps] = useState({ fps: 0, p95: 0, view: { ...stats.current } });
  useEffect(() => {
    const deltas: number[] = [];
    let prev = performance.now();
    let raf = requestAnimationFrame(function loop(now) {
      deltas.push(now - prev);
      if (deltas.length > 120) deltas.shift();
      prev = now;
      raf = requestAnimationFrame(loop);
    });
    const id = setInterval(() => {
      const sorted = [...deltas].sort((a, b) => a - b);
      const avg = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
      setFps({ fps: avg > 0 ? 1000 / avg : 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, view: { ...stats.current } });
    }, 500);
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, [stats]);

  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  const rows: [string, string][] = [
    ["Phase", load.phase + (load.error ? `: ${load.error}` : "")],
    ["Rows / edges", `${store.rows.toLocaleString()} / ${store.edges.toLocaleString()}`],
    ["Peak lanes", String(load.maxLanes)],
    ["Source load", `${load.sourceMs.toFixed(0)} ms`],
    ["First page on screen", `${load.firstRowsMs.toFixed(0)} ms`],
    ["All pages", load.phase === "done" ? `${load.totalMs.toFixed(0)} ms` : "…"],
    ["Worker lane pass", `${load.workerLayoutMs.toFixed(0)} ms`],
    ["Main-thread ingest", `${load.mainIngestMs.toFixed(0)} ms (max page ${load.maxIngestMs.toFixed(1)})`],
    ["Payload", `${kb(load.bytes)} in ${load.pages} pages`],
    ["FPS (idle/scroll)", `${fps.fps.toFixed(0)} (p95 ${fps.p95.toFixed(1)} ms)`],
    ["Window rows", String(fps.view.windowRows)],
    ["Visible edges", String(fps.view.visibleEdges)],
    ["Path build", `${fps.view.buildMs.toFixed(2)} ms`],
    ["Lanes drawn", String(fps.view.graphLanes)],
    ["Viewport renders", String(fps.view.renders)],
    ["Spacer height", `${((store.rows * H) / 1e6).toFixed(1)}M px (Chromium max ≈ 33.5M)`],
  ];
  return (
    <Section title="Measurements">
      <dl className="topos-hud">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="topos-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <label className="topos-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="topos-field">
      <span>{label} <b>{value}</b></span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
