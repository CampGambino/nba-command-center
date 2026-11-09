import { looksLikeNameHeading, cleanName, displayName } from "../names.js";

/**
 * Tracks player-name headings laid out side by side ("JAMES HARDEN" over one
 * block, "SAM MERRILL" over the next) so each stat line can be credited to the
 * heading it sits under. A new heading replaces any earlier heading it overlaps
 * horizontally; headings reset at every page.
 */
export class HeadingTracker {
  constructor() { this.active = []; }

  reset() { this.active = []; }

  /** Scan a line's cells for name headings; returns true if any were found. */
  scan(line) {
    const found = line.cells.filter((c) => looksLikeNameHeading(c.text));
    // A line counts as a heading row only if *every* cell is a name heading,
    // so "JAMES HARDEN  30,000 PTS (29,496)" style rows never reset headings.
    if (!found.length || found.length !== line.cells.length) return false;
    for (const c of found) {
      const name = displayName(cleanName(c.text));
      this.active = this.active.filter((h) => h.x1 < c.x0 - 20 || h.x0 > c.x1 + 20);
      this.active.push({ name, x0: c.x0, x1: c.x1, cx: c.cx, y: line.y });
    }
    return true;
  }

  /** Heading whose block a span [x0, x1] belongs to (nearest center), or null. */
  owner(x0, x1) {
    if (!this.active.length) return null;
    const mid = (x0 + x1) / 2;
    let best = null, bestD = Infinity;
    for (const h of this.active) {
      const d = Math.abs(h.cx - mid);
      if (d < bestD) { best = h; bestD = d; }
    }
    // Too far from any heading: refuse rather than guess.
    return bestD <= 220 ? best : null;
  }
}
