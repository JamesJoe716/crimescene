import {
  RAMP_DARK,
  RAMP_LIGHT,
  buildTree,
  clipLabel,
  heatColor,
  inkOn,
  nodeHotspot,
  squarify,
} from "./treemap.js";
import type { Placed, Rect, TreeNode } from "./treemap.js";
import type { XrayReport } from "./types.js";

/**
 * A standalone SVG of the hotspot map.
 *
 * The HTML report is for exploring; this is for *showing* — dropping into a
 * README, a slide, or a status page. It is a plain file with no script and no
 * external reference, so GitHub's sanitiser leaves it intact.
 */

export interface SvgOptions {
  theme?: "light" | "dark";
  width?: number;
  height?: number;
  /** Levels of folder nesting to draw before a folder becomes one flat cell. */
  maxDepth?: number;
  /** Draw the repository name and the date range across the top. */
  header?: boolean;
  /** Draw the colour scale along the bottom. */
  legend?: boolean;
}

interface Palette {
  page: string;
  plot: string;
  box: string;
  band: string;
  text1: string;
  text2: string;
  muted: string;
  ring: string;
  /** Near-black ink, for pale fills. */
  inkDark: string;
  /** Near-white ink, for deep fills. */
  inkLight: string;
  ramp: string[];
}

const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    page: "#f9f9f7",
    plot: "#f2f1ed",
    box: "#fcfcfb",
    band: "#f2f1ed",
    text1: "#0b0b0b",
    text2: "#52514e",
    muted: "#898781",
    ring: "rgba(11,11,11,0.10)",
    inkDark: "#0b0b0b",
    inkLight: "#fcfcfb",
    ramp: RAMP_LIGHT,
  },
  dark: {
    page: "#0d0d0d",
    plot: "#222220",
    box: "#1a1a19",
    band: "#222220",
    text1: "#ffffff",
    text2: "#c3c2b7",
    muted: "#898781",
    ring: "rgba(255,255,255,0.10)",
    inkDark: "#1a1a19",
    inkLight: "#ffffff",
    ramp: RAMP_DARK,
  },
};

const FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const GAP = 2;
const BAND = 15;
const PAD = 12;

export function renderSvg(report: XrayReport, options: SvgOptions = {}): string {
  const theme = options.theme ?? "light";
  const palette = PALETTES[theme];
  const width = options.width ?? 1000;
  const height = options.height ?? 600;
  const maxDepth = options.maxDepth ?? 3;
  const header = options.header !== false;
  const legend = options.legend !== false;

  const headerHeight = header ? 46 : 0;
  const legendHeight = legend ? 30 : 0;
  const plot: Rect = {
    x: PAD,
    y: PAD + headerHeight,
    w: width - PAD * 2,
    h: height - PAD * 2 - headerHeight - legendHeight,
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" font-family="${FONT}" ` +
      `role="img" aria-label="${esc(altText(report))}">`,
  );
  parts.push(`<title>${esc(altText(report))}</title>`);
  parts.push(rect(0, 0, width, height, palette.page));

  if (header) {
    parts.push(
      text(PAD + 2, PAD + 17, esc(report.repo), {
        fill: palette.text1,
        size: 16,
        weight: 600,
      }),
    );
    parts.push(
      text(PAD + 2, PAD + 35, esc(subtitle(report)), { fill: palette.muted, size: 11.5 }),
    );
    const worst = report.files[0];
    if (worst) {
      parts.push(
        text(width - PAD - 2, PAD + 35, esc(`hottest: ${worst.path}`), {
          fill: palette.muted,
          size: 11.5,
          anchor: "end",
        }),
      );
    }
  }

  parts.push(round(plot.x, plot.y, plot.w, plot.h, palette.plot, 8));

  const maxHotspot = report.files.reduce((max, file) => (file.hotspot > max ? file.hotspot : max), 0);
  const scale = (hotspot: number) => (maxHotspot > 0 ? hotspot / maxHotspot : 0);
  const tree = buildTree(report.files, report.repo);
  paint(parts, tree, plot, 0, { palette, maxDepth, scale });

  if (legend) {
    const y = height - PAD - legendHeight + 12;
    parts.push(`<defs><linearGradient id="cs-ramp" x1="0" y1="0" x2="1" y2="0">`);
    palette.ramp.forEach((stop, i) => {
      const offset = ((i / (palette.ramp.length - 1)) * 100).toFixed(1);
      parts.push(`<stop offset="${offset}%" stop-color="${stop}"/>`);
    });
    parts.push(`</linearGradient></defs>`);

    const barX = PAD + 34;
    const barW = Math.max(60, width - PAD * 2 - 34 - 34 - 150);
    parts.push(text(PAD + 2, y + 8, "cold", { fill: palette.muted, size: 11 }));
    parts.push(
      `<rect x="${barX}" y="${y}" width="${barW}" height="8" rx="4" fill="url(#cs-ramp)" ` +
        `stroke="${palette.ring}" stroke-width="1"/>`,
    );
    parts.push(text(barX + barW + 8, y + 8, "hot", { fill: palette.muted, size: 11 }));
    parts.push(
      text(width - PAD - 2, y + 8, "area = lines of code · colour = hotspot score", {
        fill: palette.muted,
        size: 11,
        anchor: "end",
      }),
    );
  }

  parts.push("</svg>");
  return parts.join("") + "\n";
}

interface PaintContext {
  palette: Palette;
  maxDepth: number;
  scale: (hotspot: number) => number;
}

function paint(out: string[], node: TreeNode, area: Rect, depth: number, ctx: PaintContext): void {
  const expandable = Boolean(node.children && node.children.length > 0);
  const canExpand = expandable && depth < ctx.maxDepth && area.w > 42 && area.h > 42;

  if (!canExpand) {
    leaf(out, node, area, expandable, ctx);
    return;
  }

  out.push(
    `<rect x="${fixed(area.x)}" y="${fixed(area.y)}" width="${fixed(area.w)}" height="${fixed(area.h)}" ` +
      `rx="3" fill="${ctx.palette.box}" stroke="${ctx.palette.ring}" stroke-width="1"/>`,
  );

  let band = 0;
  if (depth > 0 && area.h > BAND * 2.4 && area.w > 60) {
    band = BAND;
    out.push(rect(area.x + 1, area.y + 1, area.w - 2, band, ctx.palette.band));
    const label = clipLabel(node.name, area.w - 12);
    if (label) {
      out.push(
        text(area.x + 6, area.y + band - 4, esc(label), {
          fill: ctx.palette.text2,
          size: 11,
          weight: 600,
        }),
      );
    }
  }

  const inner: Rect = {
    x: area.x + GAP,
    y: area.y + band + GAP,
    w: area.w - GAP * 2,
    h: area.h - band - GAP * 2,
  };
  for (const cell of squarify(node.children!, inner) as Placed[]) {
    paint(
      out,
      cell.node,
      { x: cell.x + GAP / 2, y: cell.y + GAP / 2, w: cell.w - GAP, h: cell.h - GAP },
      depth + 1,
      ctx,
    );
  }
}

function leaf(out: string[], node: TreeNode, area: Rect, isFolder: boolean, ctx: PaintContext): void {
  if (area.w <= 0.5 || area.h <= 0.5) return;

  const score = node.file ? node.file.hotspot : nodeHotspot(node);
  const fill = heatColor(ctx.scale(score), ctx.palette.ramp);
  const radius = area.w > 8 && area.h > 8 ? 3 : 0;

  out.push(
    `<rect x="${fixed(area.x)}" y="${fixed(area.y)}" width="${fixed(area.w)}" height="${fixed(area.h)}" ` +
      `rx="${radius}" fill="${fill}" stroke="${ctx.palette.ring}" stroke-width="1"/>`,
  );

  if (area.w > 54 && area.h > 18) {
    const label = clipLabel(isFolder ? `${node.name}/` : node.name, area.w - 10);
    if (label) {
      out.push(
        text(area.x + 5, area.y + 13, esc(label), {
          fill: inkOn(fill) === "dark" ? ctx.palette.inkDark : ctx.palette.inkLight,
          size: 11,
        }),
      );
    }
  }
}

function subtitle(report: XrayReport): string {
  return (
    `${report.history.commits.toLocaleString("en-US")} commits · ` +
    `${report.history.authors} authors · ` +
    `${report.history.from.slice(0, 10)} → ${report.history.to.slice(0, 10)} · ` +
    `${report.totals.files.toLocaleString("en-US")} files`
  );
}

function altText(report: XrayReport): string {
  const worst = report.files[0];
  return (
    `Hotspot map of ${report.repo}: ${report.totals.files} files sized by lines of code and ` +
    `coloured by hotspot score` +
    (worst ? `. The hottest file is ${worst.path}, scoring ${worst.hotspot.toFixed(1)}.` : ".")
  );
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${fixed(x)}" y="${fixed(y)}" width="${fixed(w)}" height="${fixed(h)}" fill="${fill}"/>`;
}

function round(x: number, y: number, w: number, h: number, fill: string, radius: number): string {
  return `<rect x="${fixed(x)}" y="${fixed(y)}" width="${fixed(w)}" height="${fixed(h)}" rx="${radius}" fill="${fill}"/>`;
}

function text(
  x: number,
  y: number,
  body: string,
  style: { fill: string; size: number; weight?: number; anchor?: "start" | "end" },
): string {
  const anchor = style.anchor ? ` text-anchor="${style.anchor}"` : "";
  const weight = style.weight ? ` font-weight="${style.weight}"` : "";
  return `<text x="${fixed(x)}" y="${fixed(y)}" fill="${style.fill}" font-size="${style.size}"${weight}${anchor}>${body}</text>`;
}

/** Two decimals is plenty for layout and keeps the file small. */
function fixed(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function esc(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char,
  );
}
