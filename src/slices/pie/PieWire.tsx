// The pie menu as drawn: a wireframe of neon lines, with no fills and no background, so the work
// shows through. Each wedge is an outline in the pie palette's first colour, the aimed one in its
// second; with Spectrum each wedge takes its own hue. Labels sit over the work, with the thin dark
// label outline when that setting is on. A wedge whose command does not apply is a dim dashed
// outline with no label. A parent carries a short tab past its outer edge, and while it is aimed
// at its three second-ring slices show on the outer ring, which the wire draws past its own box.
// The live pie and the Project panel's preview both draw this.
import type { CSSProperties } from "react";
import { PIE_PALETTES, type PiePaletteId } from "./piePalettes.ts";
import { WEDGES, sliceSpan, type Wedge } from "./pieRecognizer.ts";
import type { PieRing } from "./pieRing.ts";

const sliceLabel = (label: string) => (label.length > SLICE_LABEL_MAX ? `${label.slice(0, SLICE_LABEL_MAX - 1)}…` : label).toUpperCase();

/** The wire's size in CSS px: the first ring's outer edge (128) plus room for the glow. */
export const PIE_WIRE_SIZE = 300;

/** How far from the centre the second ring and its labels reach, in CSS px. */
export const PIE_REACH = 190;

const INNER = 62;
const OUTER = 128;
const HUB = 54;
const HALF_SPAN = 21;
/** The second ring's slices, from just past where it starts (132) out. */
const SLICE_INNER = 138;
const SLICE_OUTER = 180;
/** The tab that marks a parent, just past the first ring's outer edge. */
const TAB = 133;
/** The longest slice label drawn in full; longer ones are cut and end in an ellipsis. */
const SLICE_LABEL_MAX = 12;
/** The dark the label outline is drawn in: the stage's own background. */
const OUTLINE = "#0d1117";

/** The point `r` px out at `deg` clockwise from N. */
function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(rad), r * Math.sin(rad)];
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const pt = (r: number, deg: number) => polar(r, deg).map(fmt).join(" ");

/** A wedge's outline: an annular sector from `r0` to `r1`, between bearings `a0` and `a1`. */
const sector = (r0: number, r1: number, a0: number, a1: number) =>
  `M${pt(r1, a0)}A${r1} ${r1} 0 0 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 0 0 ${pt(r0, a0)}Z`;

/** The resting and aimed colours of wedge `index` (clockwise from N) in `palette`. */
function wedgeColors(palette: PiePaletteId, index: number): [string, string] {
  const colors = (PIE_PALETTES.find((p) => p.id === palette) ?? PIE_PALETTES[0]).colors;
  if (palette === "spectrum") return [`hsl(${(index * 45 + 170) % 360} 100% 62%)`, colors[1]];
  return [colors[0], colors[1]];
}

const glow = (color: string, px: number): CSSProperties => ({ filter: `drop-shadow(0 0 ${px}px ${color})` });

interface PieWireProps {
  ring: PieRing;
  palette: PiePaletteId;
  labelOutline: boolean;
  /** The wedge the pointer aims at, drawn lit; a parent also shows its second ring. */
  aimed: Wedge | null;
  /** The aimed parent's slice the pointer is on, drawn lit; null short of the second ring. */
  aimedSlice?: number | null;
  /** The accessible name. */
  label: string;
  /** "menu" for the live pie, whose wedges are menu items; "preview" for a picture of it. */
  as?: "menu" | "preview";
  className?: string;
}

export const PieWire = ({ ring, palette, labelOutline, aimed, aimedSlice = null, label, as = "menu", className }: PieWireProps) => {
  const menu = as === "menu";
  const outline = labelOutline ? { stroke: OUTLINE, strokeWidth: 3, strokeLinejoin: "round" as const, paintOrder: "stroke" } : {};
  const [hubColor] = wedgeColors(palette, 0);
  const half = PIE_WIRE_SIZE / 2;
  const parent = aimed ? ring[aimed] : null;
  return (
    <svg
      viewBox={`${-half} ${-half} ${PIE_WIRE_SIZE} ${PIE_WIRE_SIZE}`}
      width={PIE_WIRE_SIZE}
      height={PIE_WIRE_SIZE}
      role={menu ? "menu" : "img"}
      aria-label={label}
      className={className}
      style={{ overflow: "visible", fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace' }}
    >
      {WEDGES.map((wedge, index) => {
        const command = ring[wedge];
        const bearing = index * 45;
        const [rest, lit] = wedgeColors(palette, index);
        const d = sector(INNER, OUTER, bearing - HALF_SPAN, bearing + HALF_SPAN);
        if (!command) {
          return (
            <g key={wedge} data-wedge={wedge} data-dim="true" aria-hidden="true">
              <path d={d} fill="none" stroke={rest} strokeWidth={0.8} strokeDasharray="2 4" opacity={0.3} />
            </g>
          );
        }
        const on = wedge === aimed;
        const color = on ? lit : rest;
        const [lx, ly] = polar(93, bearing);
        const [kx, ky] = polar(116, bearing);
        return (
          <g
            key={wedge}
            data-wedge={wedge}
            data-aimed={on ? "true" : undefined}
            role={menu ? "menuitem" : undefined}
            aria-label={menu ? `${wedge}: ${command.label} (${command.letter.toUpperCase()})` : undefined}
          >
            <path d={d} fill="none" stroke={color} strokeWidth={on ? 2.2 : 1.1} style={glow(color, on ? 9 : 4)} />
            {command.slices && (
              <path data-tab d={`M${pt(TAB, bearing - 12)}A${TAB} ${TAB} 0 0 1 ${pt(TAB, bearing + 12)}`} fill="none" stroke={rest} strokeWidth={1} opacity={0.6} />
            )}
            <text
              x={fmt(lx)}
              y={fmt(ly)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9.5}
              letterSpacing="0.1em"
              fontWeight={on ? 700 : 400}
              fill={on ? "#ffffff" : rest}
              {...outline}
            >
              {command.label.toUpperCase()}
            </text>
            <text x={fmt(kx)} y={fmt(ky)} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill={color} opacity={0.75} {...outline}>
              {command.letter.toUpperCase()}
            </text>
          </g>
        );
      })}
      {aimed && parent?.slices && (
        <g data-second-ring={aimed}>
          {parent.slices.map((slice, c) => {
            const [rest, lit] = wedgeColors(palette, WEDGES.indexOf(aimed));
            const [a0, a1] = sliceSpan(aimed, c);
            // A degree's gap at each edge keeps neighbouring slices' outlines apart.
            const d = sector(SLICE_INNER, SLICE_OUTER, a0 + 1, a1 - 1);
            if (!slice) {
              return (
                <g key={c} data-slice={c} data-dim="true" aria-hidden="true">
                  <path d={d} fill="none" stroke={rest} strokeWidth={0.8} strokeDasharray="2 4" opacity={0.3} />
                </g>
              );
            }
            const on = c === aimedSlice;
            const color = on ? lit : rest;
            const [lx, ly] = polar((SLICE_INNER + SLICE_OUTER) / 2, (a0 + a1) / 2);
            return (
              <g
                key={c}
                data-slice={c}
                data-aimed={on ? "true" : undefined}
                role={menu ? "menuitem" : undefined}
                aria-label={menu ? `${aimed}: ${parent.label} › ${slice.label}` : undefined}
              >
                <path d={d} fill="none" stroke={color} strokeWidth={on ? 2.2 : 1.1} style={glow(color, on ? 9 : 4)} />
                <text
                  x={fmt(lx)}
                  y={fmt(ly)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={8}
                  letterSpacing="0.06em"
                  fontWeight={on ? 700 : 400}
                  fill={on ? "#ffffff" : rest}
                  {...outline}
                >
                  {sliceLabel(slice.label)}
                </text>
              </g>
            );
          })}
        </g>
      )}
      <circle r={HUB} fill="none" stroke={hubColor} strokeWidth={1} style={glow(hubColor, 3)} />
    </svg>
  );
};
