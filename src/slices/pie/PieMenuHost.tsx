// The pie menu host: one set of capture-phase listeners on the document opens the pie wherever
// a surface's rules say (pieTriggers.ts), feeds the recognizer (pieRecognizer.ts) and draws the
// wire at the pointer once the display delay passes. Near a window edge the wire is moved in so
// the whole ring, second ring included, shows, and strokes still count from where the button went
// down; each stroke chosen with the pointer is handed on for the stroke log (pieStrokeLog.ts).
// Listening in the capture phase on the document runs before any surface's own handlers, so a press that opens the
// pie never reaches xterm (and the program behind mouse reporting) or a list menu, and the
// contextmenu and auxclick that follow it are cancelled too, which keeps WebView2's native menu
// and middle-click auto-scroll away. Presses that do not open the pie pass through untouched.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { elementOf } from "../overlay/contextMenuPolicy.ts";
import { CLOSED, aimedSlice, aimedWedge, stepPie, type PieEvent, type PiePoint, type PieState } from "./pieRecognizer.ts";
import { pieRing, type PieChoice, type PieRing, type PieTarget, type RecentPaletteCommand } from "./pieRing.ts";
import { strokeRecord, type PieStrokeRecord } from "./pieStrokeLog.ts";
import { opensPie, piePlaceAt } from "./pieTriggers.ts";
import type { PiePaletteId } from "./piePalettes.ts";
import { PIE_REACH, PIE_WIRE_SIZE, PieWire } from "./PieWire.tsx";

interface PieMenuHostProps {
  palette: PiePaletteId;
  labelOutline: boolean;
  /** The Pie display delay setting, in ms: how long a held button waits before the pie draws. */
  displayDelayMs: number;
  /** The palette's most recent commands, newest first, which Palette's slices copy. */
  recentCommands?: readonly RecentPaletteCommand[];
  /** Runs a chosen stroke on what the pie opened over. */
  onChoose: (choice: PieChoice, target: PieTarget) => void;
  /** Called with the record of each stroke chosen with the pointer, for the stroke log. */
  onStroke?: (record: PieStrokeRecord) => void;
}

/** The pie's centre for a press at `at`: moved in from the window's edges so the whole second ring shows. */
function centreFor(at: PiePoint): PiePoint {
  const clamp = (v: number, room: number) => (room < 2 * PIE_REACH ? room / 2 : Math.min(Math.max(v, PIE_REACH), room - PIE_REACH));
  return { x: clamp(at.x, window.innerWidth), y: clamp(at.y, window.innerHeight) };
}

/** Cancels an event and keeps it from every listener after this one. */
function swallow(e: Event) {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

export const PieMenuHost = ({ palette, labelOutline, displayDelayMs, recentCommands = [], onChoose, onStroke }: PieMenuHostProps) => {
  const [view, setView] = useState<{ state: PieState; ring: PieRing } | null>(null);
  // Read by the listeners, which are installed once.
  const props = useRef({ displayDelayMs, recentCommands, onChoose, onStroke });
  props.current = { displayDelayMs, recentCommands, onChoose, onStroke };

  useEffect(() => {
    let state: PieState = CLOSED;
    let ring: PieRing | null = null;
    let target: PieTarget = { surface: "other" };
    let timer: ReturnType<typeof setTimeout> | null = null;
    // How far the pie's centre was moved in from the press point. Every pointer is moved by the
    // same amount, so strokes still count from where the button went down.
    let shift: PiePoint = { x: 0, y: 0 };
    // The events still to come from a press the pie took: its contextmenu, auxclick or click.
    let swallowFollowers = false;

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const step = (event: PieEvent) => {
      if (!ring) return;
      const before = state;
      const next = stepPie(state, event, ring, props.current.displayDelayMs);
      state = next.state;
      if (state.phase === "closed") clearTimer();
      setView(state.phase === "closed" ? null : { state, ring });
      const command = next.chosen ? ring[next.chosen] : null;
      if (!command) return;
      // A letter has no release point, so only pointer strokes are logged.
      if (before.phase !== "closed" && (event.type === "release" || event.type === "click")) {
        const record = strokeRecord(ring, next, before.origin, event.at, Date.now());
        if (record) props.current.onStroke?.(record);
      }
      const slice = next.slice === null ? null : command.slices?.[next.slice];
      props.current.onChoose(slice ?? { action: command.action }, target);
    };
    const pointOf = (e: MouseEvent): PiePoint => ({ x: e.clientX + shift.x, y: e.clientY + shift.y });

    const onMouseDown = (e: MouseEvent) => {
      if (state.phase === "open" && e.button === 0) {
        swallow(e);
        swallowFollowers = true;
        step({ type: "click", at: pointOf(e) });
        return;
      }
      swallowFollowers = false;
      const el = elementOf(e.target);
      if (!el || e.button === 0) return;
      const place = piePlaceAt(el);
      if (!opensPie(e, place.rules, place.mouseReporting)) return;
      swallow(e);
      swallowFollowers = true;
      target = place.target;
      ring = pieRing(target, props.current.recentCommands);
      const now = performance.now();
      clearTimer();
      const pressedAt = { x: e.clientX, y: e.clientY };
      const centre = centreFor(pressedAt);
      shift = { x: centre.x - pressedAt.x, y: centre.y - pressedAt.y };
      step({ type: "press", at: centre, time: now });
      const delay = props.current.displayDelayMs;
      if (delay > 0) timer = setTimeout(() => step({ type: "tick", time: now + delay }), delay);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (state.phase !== "closed") step({ type: "move", at: pointOf(e) });
    };
    const onMouseUp = (e: MouseEvent) => {
      if (state.phase === "held") {
        swallow(e);
        step({ type: "release", at: pointOf(e), time: performance.now() });
      } else if (swallowFollowers) swallow(e);
    };
    const onFollower = (e: Event) => {
      if (swallowFollowers || state.phase !== "closed") swallow(e);
      if (e.type !== "contextmenu") return;
      // A right-button press has nothing more to come after its contextmenu.
      swallowFollowers = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (state.phase === "closed" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "Escape" && e.key.length !== 1) return;
      swallow(e);
      step({ type: "key", key: e.key });
    };
    const onBlur = () => {
      if (state.phase === "closed") return;
      state = CLOSED;
      clearTimer();
      setView(null);
    };

    const listeners: [string, (e: never) => void][] = [
      ["mousedown", onMouseDown],
      ["mousemove", onMouseMove],
      ["mouseup", onMouseUp],
      ["contextmenu", onFollower],
      ["auxclick", onFollower],
      ["click", onFollower],
      ["keydown", onKeyDown],
    ];
    for (const [type, fn] of listeners) document.addEventListener(type, fn as EventListener, true);
    window.addEventListener("blur", onBlur);
    return () => {
      for (const [type, fn] of listeners) document.removeEventListener(type, fn as EventListener, true);
      window.removeEventListener("blur", onBlur);
      clearTimer();
    };
  }, []);

  if (!view || (view.state.phase === "held" && !view.state.shown) || view.state.phase === "closed") return null;
  const { origin } = view.state;
  return createPortal(
    <div
      className="fixed z-[1000] pointer-events-none"
      style={{ left: origin.x - PIE_WIRE_SIZE / 2, top: origin.y - PIE_WIRE_SIZE / 2, width: PIE_WIRE_SIZE, height: PIE_WIRE_SIZE }}
    >
      <PieWire
        ring={view.ring}
        palette={palette}
        labelOutline={labelOutline}
        aimed={aimedWedge(view.state, view.ring)}
        aimedSlice={aimedSlice(view.state, view.ring)}
        label="Pie menu"
      />
    </div>,
    document.body
  );
};
