import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { analyzeComplexity, looksGenerated } from "./complexity.js";
import { PathFilter, isCodeFile } from "./filter.js";
import { readHistory, repoRoot, trackedFiles } from "./git.js";
import type {
  AnalyzeOptions,
  AuthorShare,
  AuthorSummary,
  CouplingPair,
  FileMetrics,
  XrayReport,
} from "./types.js";

export const VERSION = "0.2.0";

const DEFAULTS = {
  minCommits: 2,
  maxCommitFiles: 30,
  minSharedCommits: 5,
  minCouplingDegree: 0.35,
} as const;

/**
 * Coupling is quadratic in the number of files, so it is computed over the
 * most-changed files only. Everything below the cut is stable enough that its
 * coupling would not have made the report anyway.
 */
const COUPLING_CANDIDATES = 400;

/** Files larger than this are read for line counts but not scored. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Concurrent file reads. Enough to saturate an SSD, not enough to hit EMFILE. */
const READ_CONCURRENCY = 32;

interface Accumulator {
  path: string;
  commits: number;
  added: number;
  deleted: number;
  first: string;
  last: string;
  authors: Map<string, { churn: number; commits: number }>;
}

interface AuthorAccumulator {
  commits: number;
  added: number;
  deleted: number;
  files: Set<string>;
  first: string;
  last: string;
}

/** Run the full analysis over a git repository. */
export async function analyze(options: AnalyzeOptions = {}): Promise<XrayReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const minCommits = options.minCommits ?? DEFAULTS.minCommits;
  const maxCommitFiles = options.maxCommitFiles ?? DEFAULTS.maxCommitFiles;
  const minShared = options.minSharedCommits ?? DEFAULTS.minSharedCommits;
  const minDegree = options.minCouplingDegree ?? DEFAULTS.minCouplingDegree;
  const progress = options.onProgress ?? (() => {});
  const warnings: string[] = [];

  const root = await repoRoot(cwd);
  progress(`Reading history of ${path.basename(root)}`);

  const filter = new PathFilter({
    ...(options.exclude ? { exclude: options.exclude } : {}),
    ...(options.includeAll ? { includeAll: true } : {}),
  });
  const tracked = await trackedFiles(root);

  const files = new Map<string, Accumulator>();
  const authors = new Map<string, AuthorAccumulator>();
  const pathIds = new Map<string, number>();
  const commitSets: number[][] = [];

  let commitCount = 0;
  let newest = "";
  let oldest = "";

  for await (const commit of readHistory(root, { since: options.since })) {
    commitCount++;
    if (!newest) newest = commit.date;
    oldest = commit.date;
    if (commitCount % 2000 === 0) progress(`Read ${commitCount.toLocaleString()} commits`);

    const author = authors.get(commit.author) ?? {
      commits: 0,
      added: 0,
      deleted: 0,
      files: new Set<string>(),
      first: commit.date,
      last: commit.date,
    };
    author.commits++;
    if (commit.date < author.first) author.first = commit.date;
    if (commit.date > author.last) author.last = commit.date;
    authors.set(commit.author, author);

    const touched: number[] = [];
    for (const change of commit.files) {
      if (change.binary) continue;
      // Only files that still exist matter: a hotspot you cannot open is noise.
      if (!tracked.has(change.path) || !filter.accepts(change.path)) continue;

      author.added += change.added;
      author.deleted += change.deleted;
      author.files.add(change.path);

      let entry = files.get(change.path);
      if (!entry) {
        entry = {
          path: change.path,
          commits: 0,
          added: 0,
          deleted: 0,
          first: commit.date,
          last: commit.date,
          authors: new Map(),
        };
        files.set(change.path, entry);
      }
      entry.commits++;
      entry.added += change.added;
      entry.deleted += change.deleted;
      if (commit.date < entry.first) entry.first = commit.date;
      if (commit.date > entry.last) entry.last = commit.date;

      const share = entry.authors.get(commit.author) ?? { churn: 0, commits: 0 };
      share.churn += change.added + change.deleted;
      share.commits++;
      entry.authors.set(commit.author, share);

      let id = pathIds.get(change.path);
      if (id === undefined) {
        id = pathIds.size;
        pathIds.set(change.path, id);
      }
      touched.push(id);
    }
    if (touched.length > 1 && touched.length <= maxCommitFiles) commitSets.push(touched);
  }

  if (commitCount === 0) {
    const message = options.since
      ? `No commits found since "${options.since}".`
      : "No commits found. Is this an empty repository?";
    throw new Error(message);
  }

  const changed = [...files.values()].filter((entry) => entry.commits >= minCommits);
  const eligible = options.includeAll ? changed : changed.filter((entry) => isCodeFile(entry.path));

  const nonCode = changed.length - eligible.length;
  if (nonCode > 0) {
    warnings.push(
      `Skipped ${nonCode.toLocaleString()} non-code ${nonCode === 1 ? "file" : "files"} ` +
        `(docs, config, data). Pass --include-all to score them too.`,
    );
  }
  if (eligible.length === 0 && changed.length === 0) {
    warnings.push(
      `Every file has fewer than ${minCommits} commits in range. Try --min-commits 1 or a wider --since.`,
    );
  }
  progress(`Scoring ${eligible.length.toLocaleString()} files`);

  const complexity = await readComplexity(root, eligible.map((entry) => entry.path));
  for (const skipped of complexity.skipped) {
    files.delete(skipped);
  }
  const scored = eligible.filter((entry) => complexity.stats.has(entry.path));

  const maxCommits = Math.max(1, ...scored.map((entry) => entry.commits));
  const maxComplexity = Math.max(
    1,
    ...scored.map((entry) => complexity.stats.get(entry.path)!.totalIndent),
  );
  const now = Date.now();

  const metrics: FileMetrics[] = scored.map((entry) => {
    const stats = complexity.stats.get(entry.path)!;
    const churnScore = entry.commits / maxCommits;
    const complexityScore = stats.totalIndent / maxComplexity;
    const hotspot = Math.sqrt(churnScore * complexityScore) * 100;

    const totalChurn = [...entry.authors.values()].reduce((sum, a) => sum + a.churn, 0);
    const shares: AuthorShare[] = [...entry.authors.entries()]
      .map(([author, value]) => ({
        author,
        churn: value.churn,
        commits: value.commits,
        // A file of pure deletions can total zero churn; fall back to commits.
        share: totalChurn > 0 ? value.churn / totalChurn : value.commits / entry.commits,
      }))
      .sort((a, b) => b.share - a.share || a.author.localeCompare(b.author));

    let covered = 0;
    let busFactor = 0;
    for (const share of shares) {
      covered += share.share;
      busFactor++;
      if (covered > 0.5) break;
    }

    const main = shares[0];
    return {
      path: entry.path,
      commits: entry.commits,
      added: entry.added,
      deleted: entry.deleted,
      churn: entry.added + entry.deleted,
      lines: stats.lines,
      code: stats.code,
      complexity: stats.totalIndent,
      maxIndent: stats.maxIndent,
      hotspot: round(hotspot, 1),
      firstChange: entry.first,
      lastChange: entry.last,
      ageDays: Math.max(0, Math.round((now - Date.parse(entry.last)) / 86_400_000)),
      authors: shares.slice(0, 10).map((s) => ({ ...s, share: round(s.share, 4) })),
      authorCount: shares.length,
      mainAuthor: main?.author ?? "unknown",
      mainAuthorShare: round(main?.share ?? 0, 4),
      busFactor: Math.max(1, busFactor),
    };
  });

  metrics.sort((a, b) => b.hotspot - a.hotspot || a.path.localeCompare(b.path));

  const coupling = computeCoupling({
    commitSets,
    pathIds,
    commitsByPath: new Map(scored.map((entry) => [entry.path, entry.commits])),
    minShared,
    minDegree,
    warnings,
  });

  const authorSummaries = summariseAuthors(authors, metrics);
  const knowledge = knowledgeConcentration(metrics);

  return {
    tool: { name: "crimescene", version: VERSION },
    repo: path.basename(root),
    generatedAt: new Date().toISOString(),
    history: {
      commits: commitCount,
      authors: authors.size,
      from: oldest,
      to: newest,
      since: options.since ?? null,
    },
    totals: {
      files: metrics.length,
      lines: metrics.reduce((sum, m) => sum + m.lines, 0),
      code: metrics.reduce((sum, m) => sum + m.code, 0),
      churn: metrics.reduce((sum, m) => sum + m.churn, 0),
      knowledgeConcentration: knowledge,
    },
    files: metrics,
    coupling,
    authors: authorSummaries,
    warnings,
  };
}

/** Read every candidate from disk and measure it, bounded concurrency. */
async function readComplexity(root: string, paths: string[]) {
  const stats = new Map<string, ReturnType<typeof analyzeComplexity>>();
  const skipped: string[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < paths.length) {
      const relative = paths[cursor++]!;
      const absolute = path.join(root, relative);
      try {
        const info = await stat(absolute);
        if (!info.isFile() || info.size > MAX_FILE_BYTES || info.size === 0) {
          skipped.push(relative);
          continue;
        }
        const source = await readFile(absolute, "utf8");
        if (looksGenerated(source)) {
          skipped.push(relative);
          continue;
        }
        stats.set(relative, analyzeComplexity(source));
      } catch {
        // Unreadable, a broken symlink, or a path the OS rejects. Not fatal.
        skipped.push(relative);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, paths.length) }, () => worker()),
  );
  return { stats, skipped };
}

function computeCoupling(input: {
  commitSets: number[][];
  pathIds: Map<string, number>;
  commitsByPath: Map<string, number>;
  minShared: number;
  minDegree: number;
  warnings: string[];
}): CouplingPair[] {
  const { commitSets, pathIds, commitsByPath, minShared, minDegree, warnings } = input;

  const ranked = [...commitsByPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, COUPLING_CANDIDATES);
  if (commitsByPath.size > COUPLING_CANDIDATES) {
    warnings.push(
      `Coupling was computed over the ${COUPLING_CANDIDATES} most-changed files ` +
        `out of ${commitsByPath.size.toLocaleString()}.`,
    );
  }

  const idToPath = new Map<number, string>();
  const candidates = new Set<number>();
  for (const [file] of ranked) {
    const id = pathIds.get(file);
    if (id === undefined) continue;
    candidates.add(id);
    idToPath.set(id, file);
  }

  const pairs = new Map<string, number>();
  for (const set of commitSets) {
    const relevant = set.filter((id) => candidates.has(id)).sort((a, b) => a - b);
    for (let i = 0; i < relevant.length; i++) {
      for (let j = i + 1; j < relevant.length; j++) {
        const key = `${relevant[i]}:${relevant[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const result: CouplingPair[] = [];
  for (const [key, shared] of pairs) {
    if (shared < minShared) continue;
    const [left, right] = key.split(":");
    const a = idToPath.get(Number(left));
    const b = idToPath.get(Number(right));
    if (!a || !b) continue;
    const aCommits = commitsByPath.get(a) ?? 0;
    const bCommits = commitsByPath.get(b) ?? 0;
    const degree = shared / Math.max(1, Math.min(aCommits, bCommits));
    if (degree < minDegree) continue;
    result.push({ a, b, shared, aCommits, bCommits, degree: round(degree, 4) });
  }

  result.sort((x, y) => y.degree - x.degree || y.shared - x.shared);
  return result.slice(0, 200);
}

function summariseAuthors(
  authors: Map<string, AuthorAccumulator>,
  metrics: FileMetrics[],
): AuthorSummary[] {
  const owned = new Map<string, number>();
  for (const file of metrics) {
    owned.set(file.mainAuthor, (owned.get(file.mainAuthor) ?? 0) + 1);
  }
  return [...authors.entries()]
    .map(([author, value]) => ({
      author,
      commits: value.commits,
      added: value.added,
      deleted: value.deleted,
      files: value.files.size,
      firstCommit: value.first,
      lastCommit: value.last,
      owned: owned.get(author) ?? 0,
    }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 50);
}

/**
 * How much of the *risky* code one person holds.
 *
 * Each file contributes its hotspot score, split between authors by their
 * share of the file's churn. The result is the largest single slice — 0.6 means
 * one person is the primary knowledge holder for 60% of the dangerous code.
 */
function knowledgeConcentration(metrics: FileMetrics[]): number {
  const byAuthor = new Map<string, number>();
  let total = 0;
  for (const file of metrics) {
    for (const share of file.authors) {
      const weight = file.hotspot * share.share;
      byAuthor.set(share.author, (byAuthor.get(share.author) ?? 0) + weight);
      total += weight;
    }
  }
  if (total === 0) return 0;
  return round(Math.max(0, ...byAuthor.values()) / total, 4);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
