/**
 * Programmatic API.
 *
 *   import { analyze, renderReport } from "crimescene";
 *   const report = await analyze({ cwd: "/path/to/repo", since: "1 year ago" });
 *   console.log(report.files[0].path);
 */
export { VERSION, analyze } from "./analyze.js";
export { renderReport } from "./report.js";
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
