import type { ComplexityStats } from "./types.js";

/**
 * Indentation as a complexity proxy.
 *
 * Deeply nested code is complex code, in every language, without needing a
 * parser for any of them. The metric correlates well with cyclomatic
 * complexity (Hindle et al., "Reading Beside the Lines", ICPC 2008) and it
 * costs one pass over the bytes instead of a per-language AST.
 *
 * The trade-off is honest: a flat 3000-line file of straight-line assignments
 * scores low, and a Lisp scores oddly. For ranking *which file to open first*
 * across a mixed-language repo, that is a price worth paying.
 */

const EMPTY: ComplexityStats = {
  lines: 0,
  code: 0,
  totalIndent: 0,
  maxIndent: 0,
  meanIndent: 0,
  stdevIndent: 0,
};

/** Nesting deeper than this is almost certainly a parse artefact, not code. */
const MAX_DEPTH = 20;

/** Line-comment openers common enough to be worth stripping, by first char. */
const COMMENT_PREFIXES = [
  "//",
  "/*",
  "*/",
  "*",
  "#",
  "--",
  ";",
  "%",
  "<!--",
  '"""',
  "'''",
  "rem ",
];

function isComment(trimmed: string): boolean {
  for (const prefix of COMMENT_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true;
  }
  return false;
}

/** Width of the leading whitespace, counting a tab as `tabWidth` columns. */
function leadingWidth(line: string, tabWidth: number): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += tabWidth;
    else break;
  }
  return width;
}

/**
 * Guess how many columns make up one level of nesting.
 *
 * Picks the largest candidate that cleanly divides at least 80% of the
 * indented lines, so a handful of continuation lines misaligned by a space
 * cannot drag the whole file down to a unit of 1.
 */
export function detectIndentUnit(widths: number[]): number {
  const positive = widths.filter((w) => w > 0);
  if (positive.length === 0) return 4;

  for (const candidate of [8, 4, 3, 2]) {
    const divisible = positive.filter((w) => w % candidate === 0).length;
    if (divisible / positive.length >= 0.8) return candidate;
  }
  return 1;
}

/** Compute the indentation profile of a source file. */
export function analyzeComplexity(source: string, tabWidth = 4): ComplexityStats {
  if (!source) return { ...EMPTY };

  const lines = source.split(/\r\n|\r|\n/);
  const widths: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || isComment(trimmed.toLowerCase())) continue;
    widths.push(leadingWidth(line, tabWidth));
  }

  if (widths.length === 0) {
    return { ...EMPTY, lines: lines.length };
  }

  const unit = detectIndentUnit(widths);
  const depths = widths.map((w) => Math.min(Math.round(w / unit), MAX_DEPTH));

  let total = 0;
  let max = 0;
  for (const depth of depths) {
    total += depth;
    if (depth > max) max = depth;
  }
  const mean = total / depths.length;
  const variance = depths.reduce((sum, d) => sum + (d - mean) ** 2, 0) / depths.length;

  return {
    lines: lines.length,
    code: depths.length,
    totalIndent: total,
    maxIndent: max,
    meanIndent: round(mean),
    stdevIndent: round(Math.sqrt(variance)),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Heuristic: minified bundles and blobs should not be ranked as source. */
export function looksGenerated(source: string): boolean {
  if (source.includes("\0")) return true;
  const head = source.slice(0, 64 * 1024);
  const newlines = (head.match(/\n/g) ?? []).length;
  // A 64 KB chunk with almost no newlines is a bundle, a data URI or a blob.
  return head.length > 4096 && newlines < head.length / 500;
}
