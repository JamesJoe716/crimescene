/**
 * Programmatic API.
 *
 *   import { analyze, renderReport } from "crimescene";
 *   const report = await analyze({ cwd: "/path/to/repo", since: "1 year ago" });
 *   console.log(report.files[0].path);
 */
export { VERSION, analyze } from "./analyze.js";
export { renderReport } from "./report.js";
export { renderMarkdown } from "./markdown.js";
export type { MarkdownOptions } from "./markdown.js";
export { renderSvg } from "./svg.js";
export type { SvgOptions } from "./svg.js";
export {
  RAMP_DARK,
  RAMP_LIGHT,
  buildTree,
  heatColor,
  nodeHotspot,
  squarify,
} from "./treemap.js";
export type { Placed, Rect, TreeNode } from "./treemap.js";
export { analyzeComplexity, detectIndentUnit, looksGenerated } from "./complexity.js";
export { DEFAULT_EXCLUDES, PathFilter, globToRegExp } from "./filter.js";
export { GitError, parseRenamePath, readHistory, repoRoot, trackedFiles } from "./git.js";
export type {
  AnalyzeOptions,
  AuthorShare,
  AuthorSummary,
  Commit,
  ComplexityStats,
  CouplingPair,
  FileChange,
  FileMetrics,
  XrayReport,
} from "./types.js";
