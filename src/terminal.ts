import type { XrayReport } from "./types.js";

/** ANSI helpers that quietly disable themselves when nobody can see them. */
export function createStyler(enabled: boolean) {
  const wrap = (code: string) => (text: string) =>
    enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
  return {
    enabled,
    bold: wrap("1"),
    dim: wrap("2"),
    red: wrap("31"),
    yellow: wrap("33"),
    green: wrap("32"),
    blue: wrap("34"),
    cyan: wrap("36"),
  };
}

export function colorEnabled(stream: NodeJS.WriteStream): boolean {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (process.env["FORCE_COLOR"] !== undefined && process.env["FORCE_COLOR"] !== "0") return true;
  return Boolean(stream.isTTY);
}

/**
 * Drop the *start* of a path, never the middle.
 *
 * Sibling directories share a long prefix, so trimming the middle renders
 * `examples/a/index.ejs` and `examples/b/index.ejs` as the same string. The
 * distinguishing bytes live at the end; keep those.
 */
function shorten(path: string, width: number): string {
  if (path.length <= width) return path;
  return "…" + path.slice(-(width - 1));
}

/** For names, where the distinguishing part is at the front. */
function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  return text.slice(0, width - 1) + "…";
}

function pad(text: string, width: number, align: "left" | "right" = "left"): string {
  const gap = Math.max(0, width - text.length);
  return align === "right" ? " ".repeat(gap) + text : text + " ".repeat(gap);
}

interface Column {
  label: string;
  align?: "left" | "right";
  width: number;
}

function table(columns: Column[], rows: string[][], style: ReturnType<typeof createStyler>): string {
  const line = (left: string, mid: string, right: string) =>
    style.dim(left + columns.map((c) => "─".repeat(c.width + 2)).join(mid) + right);

  const header =
    style.dim("│ ") +
    columns.map((c) => style.dim(pad(c.label.toUpperCase(), c.width, c.align))).join(style.dim(" │ ")) +
    style.dim(" │");

  const body = rows.map(
    (row) =>
      style.dim("│ ") +
      row.map((cell, i) => padVisible(cell, columns[i]!.width, columns[i]!.align)).join(style.dim(" │ ")) +
      style.dim(" │"),
  );

  return [line("┌", "┬", "┐"), header, line("├", "┼", "┤"), ...body, line("└", "┴", "┘")].join("\n");
}

/** Pad by *visible* width, so embedded ANSI codes do not skew the column. */
function padVisible(cell: string, width: number, align: "left" | "right" = "left"): string {
  // Strip SGR sequences so a coloured cell still occupies one column of width.
  const visible = cell.replace(/\u001b\[[0-9;]*m/g, "");
  const gap = Math.max(0, width - visible.length);
  return align === "right" ? " ".repeat(gap) + cell : cell + " ".repeat(gap);
}

/** Colour a 0-100 hotspot score by severity. */
function scoreColor(score: number, max: number, style: ReturnType<typeof createStyler>): string {
  const text = score.toFixed(1).padStart(5);
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.66) return style.red(text);
  if (ratio >= 0.33) return style.yellow(text);
  return style.dim(text);
}

export function renderTerminal(
  report: XrayReport,
  options: { top: number; style: ReturnType<typeof createStyler>; width: number },
): string {
  const { style, top } = options;
  const width = Math.max(60, Math.min(options.width, 120));
  const out: string[] = [];
  const max = report.files[0]?.hotspot ?? 0;

  out.push("");
  out.push(
    `  ${style.bold(report.repo)} ${style.dim("·")} ${style.dim(
      `${report.history.commits.toLocaleString()} commits, ${report.history.authors} authors, ` +
        `${report.history.from.slice(0, 10)} → ${report.history.to.slice(0, 10)}`,
    )}`,
  );
  out.push("");

  if (report.files.length === 0) {
    out.push(style.yellow("  No files scored. Try --min-commits 1, a wider --since, or --include-all."));
    out.push("");
    return out.join("\n");
  }

  const pathWidth = Math.max(24, width - 44);
  const hotspots = report.files.slice(0, top);
  out.push(`  ${style.bold("Hotspots")} ${style.dim("— change often, hard to read; refactor from the top")}`);
  out.push(
    indent(
      table(
        [
          { label: "score", width: 5, align: "right" },
          { label: "file", width: pathWidth },
          { label: "commits", width: 7, align: "right" },
          { label: "loc", width: 6, align: "right" },
          { label: "authors", width: 7, align: "right" },
        ],
        hotspots.map((file) => [
          scoreColor(file.hotspot, max, style),
          shorten(file.path, pathWidth),
          String(file.commits),
          String(file.code),
          String(file.authorCount),
        ]),
        style,
      ),
    ),
  );
  out.push("");

  const atRisk = report.files
    .filter((file) => file.mainAuthorShare >= 0.8)
    .slice(0, Math.min(top, 5));
  if (atRisk.length > 0) {
    const concentration = Math.round(report.totals.knowledgeConcentration * 100);
    out.push(
      `  ${style.bold("Knowledge risk")} ${style.dim(
        `— one person holds ${concentration}% of the risky code`,
      )}`,
    );
    const authorWidth = 18;
    out.push(
      indent(
        table(
          [
            { label: "owned", width: 5, align: "right" },
            { label: "author", width: authorWidth },
            { label: "file", width: pathWidth - 8 },
            { label: "score", width: 5, align: "right" },
          ],
          atRisk.map((file) => [
            style.red(`${Math.round(file.mainAuthorShare * 100)}%`.padStart(5)),
            truncate(file.mainAuthor, authorWidth),
            shorten(file.path, pathWidth - 8),
            file.hotspot.toFixed(1),
          ]),
          style,
        ),
      ),
    );
    out.push("");
  }

  const coupled = report.coupling.slice(0, Math.min(top, 5));
  if (coupled.length > 0) {
    out.push(
      `  ${style.bold("Change coupling")} ${style.dim("— edited together, but stored apart")}`,
    );
    const half = Math.floor((pathWidth + 6) / 2);
    out.push(
      indent(
        table(
          [
            { label: "bond", width: 5, align: "right" },
            { label: "file", width: half },
            { label: "changes with", width: half },
            { label: "shared", width: 6, align: "right" },
          ],
          coupled.map((pair) => [
            style.cyan(`${Math.round(pair.degree * 100)}%`.padStart(5)),
            shorten(pair.a, half),
            shorten(pair.b, half),
            String(pair.shared),
          ]),
          style,
        ),
      ),
    );
    out.push("");
  }

  for (const warning of report.warnings) {
    out.push(`  ${style.yellow("!")} ${style.dim(warning)}`);
  }
  if (report.warnings.length > 0) out.push("");

  return out.join("\n");
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((line) => "  " + line)
    .join("\n");
}
