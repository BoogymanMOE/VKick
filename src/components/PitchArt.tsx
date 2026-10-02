/**
 * The shared pitch surface: one place that paints the static art both the live
 * and the replay views stand on. A pitch missing its penalty areas, spots and
 * corner arcs reads as a diagram, not a ground, so both views render this exact
 * surface and only their own overlays differ.
 *
 * The moving parts (players, ball, trajectory) are composited DOM layers in the
 * caller, scaled to this SVG's 340x180 space — see `.tac-layers` in index.css.
 */
import type { ReactNode } from "react";
import { TACTICAL_VIEWPORT, bandCorners, cornerArcPath, penaltyArcPath, project } from "../lib/pitchView";

const VP = TACTICAL_VIEWPORT;
const INNER_W = VP.width - VP.marginX * 2;
const INNER_H = VP.height - VP.marginY * 2;

/** One chalk colour for every marking; the turf stays the only saturated green. */
const CHALK = "rgba(35,160,102,0.5)";
const CHALK_SOFT = "rgba(35,160,102,0.42)";
const CHALK_DOT = "rgba(35,160,102,0.55)";

export interface PitchArtProps {
  /** Unique prefix for this surface's SVG gradients (two pitches can coexist). */
  id: string;
  /** Side names along the bottom edge, each showing which goal it attacks. */
  homeLabel?: string;
  awayLabel?: string;
  /** Extra `<defs>` the overlay paints need (e.g. a territory gradient). */
  defs?: ReactNode;
  /** A translucent wash painted under the markings (territory / pressure). */
  wash?: ReactNode;
  /** Paint drawn on top of the markings (trails, pins, measures). */
  children?: ReactNode;
}

export function PitchArt({ id, homeLabel, awayLabel, defs, wash, children }: PitchArtProps) {
  const centre = project(0.5, 0.5);
  return (
    <svg viewBox={`0 0 ${VP.width} ${VP.height}`} className="tac-svg" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-grass`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0E251E" />
          <stop offset="0.5" stopColor="#0C2119" />
          <stop offset="1" stopColor="#0A1B15" />
        </linearGradient>
        <radialGradient id={`${id}-spot`} cx="0.5" cy="0.38" r="0.9">
          <stop offset="0" stopColor="rgba(53,224,188,0.14)" />
          <stop offset="1" stopColor="rgba(53,224,188,0)" />
        </radialGradient>
        {defs}
      </defs>

      <rect width={VP.width} height={VP.height} fill={`url(#${id}-grass)`} />
      <polygon points={bandCorners(0, 1, 0, 1)} fill="none" stroke={CHALK_SOFT} strokeWidth="1.5" />
      {Array.from({ length: 8 }, (_, index) => (
        <polygon
          key={index}
          points={bandCorners(index / 8, (index + 1) / 8, 0, 1)}
          fill="#ffffff"
          opacity={index % 2 === 1 ? 0.035 : 0}
        />
      ))}
      <polygon points={bandCorners(0, 1, 0, 1)} fill={`url(#${id}-spot)`} />
      {wash}

      {/* Six-yard boxes, penalty areas and the 9.15m arc off each penalty spot. */}
      <polygon points={bandCorners(0, 0.052, 0.365, 0.635)} fill="none" stroke={CHALK_SOFT} strokeWidth="1" />
      <polygon points={bandCorners(0.948, 1, 0.365, 0.635)} fill="none" stroke={CHALK_SOFT} strokeWidth="1" />
      <polygon points={bandCorners(0, 0.157, 0.204, 0.796)} fill="none" stroke={CHALK} strokeWidth="1.2" />
      <polygon points={bandCorners(0.843, 1, 0.204, 0.796)} fill="none" stroke={CHALK} strokeWidth="1.2" />
      <path d={penaltyArcPath("home")} fill="none" stroke={CHALK} strokeWidth="1.2" />
      <path d={penaltyArcPath("away")} fill="none" stroke={CHALK} strokeWidth="1.2" />
      <circle cx={project(0.11, 0.5).x} cy={project(0.11, 0.5).y} r="1.2" fill={CHALK_DOT} />
      <circle cx={project(0.89, 0.5).x} cy={project(0.89, 0.5).y} r="1.2" fill={CHALK_DOT} />

      {/* The 1m corner arcs, swept onto the field of play. */}
      <path d={cornerArcPath(0, 0)} fill="none" stroke={CHALK} strokeWidth="1" />
      <path d={cornerArcPath(0, 1)} fill="none" stroke={CHALK} strokeWidth="1" />
      <path d={cornerArcPath(1, 0)} fill="none" stroke={CHALK} strokeWidth="1" />
      <path d={cornerArcPath(1, 1)} fill="none" stroke={CHALK} strokeWidth="1" />

      {/* Halfway line, centre circle and centre spot. */}
      <line
        x1={project(0.5, 0).x}
        y1={project(0.5, 0).y}
        x2={project(0.5, 1).x}
        y2={project(0.5, 1).y}
        stroke={CHALK}
        strokeWidth="1.2"
      />
      <ellipse
        cx={centre.x}
        cy={centre.y}
        rx={(9.15 / 105) * INNER_W}
        ry={(9.15 / 68) * INNER_H}
        fill="none"
        stroke={CHALK}
        strokeWidth="1.2"
      />
      <circle cx={centre.x} cy={centre.y} r="1.2" fill={CHALK_DOT} />

      {/* Direction hint, whisper-quiet: which goal each side attacks. */}
      {homeLabel || awayLabel ? (
        <>
          <text x={VP.marginX + 10} y={VP.height - 7} fontSize="7" fill="rgba(147,174,166,0.5)">
            {homeLabel}
          </text>
          <text
            x={VP.marginX + INNER_W - 10}
            y={VP.height - 7}
            fontSize="7"
            textAnchor="end"
            fill="rgba(147,174,166,0.5)"
          >
            {awayLabel}
          </text>
        </>
      ) : null}

      {children}
    </svg>
  );
}
