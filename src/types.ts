/** A single file touched by a commit. */
export interface FileChange {
  path: string;
  added: number;
  deleted: number;
  /** git reported `-` for the line counts, i.e. the blob is binary. */
  binary: boolean;
}

/** One commit from `git log`, with its numstat payload. */
export interface Commit {
  hash: string;
  author: string;
  email: string;
  /** Author date, ISO-8601. */
  date: string;
  subject: string;
  files: FileChange[];
}

/** Indentation-based complexity proxy for one file. See src/complexity.ts. */
export interface ComplexityStats {
  /** Physical lines, including blanks. */
  lines: number;
  /** Lines that carry logic (non-blank, non-comment by heuristic). */
  code: number;
  /** Sum of indentation depth over all code lines — the complexity proxy. */
  totalIndent: number;
  maxIndent: number;
  meanIndent: number;
  stdevIndent: number;
}

export interface AuthorShare {
  author: string;
  /** Lines added + deleted by this author in this file. */
  churn: number;
  commits: number;
  share: number;
}

/** Everything crimescene knows about one file. */
export interface FileMetrics {
  path: string;
  /** Number of commits that touched the file. */
  commits: number;
  added: number;
  deleted: number;
  /** added + deleted. */
  churn: number;
  lines: number;
  code: number;
  complexity: number;
  maxIndent: number;
  /** 0-100. Geometric mean of normalised churn and normalised complexity. */
  hotspot: number;
  firstChange: string;
  lastChange: string;
  /** Days since the last commit that touched this file. */
  ageDays: number;
  authors: AuthorShare[];
  authorCount: number;
  /** Author with the largest share of the file's churn. */
  mainAuthor: string;
  /** 0-1. 1.0 means a single person wrote every line ever changed here. */
  mainAuthorShare: number;
  /** Fewest authors whose combined share exceeds 50% of the file's churn. */
  busFactor: number;
}

/** Two files that keep changing in the same commit. */
export interface CouplingPair {
  a: string;
  b: string;
  /** Commits that touched both files. */
  shared: number;
  aCommits: number;
  bCommits: number;
  /** shared / min(aCommits, bCommits), 0-1. */
  degree: number;
}

export interface AuthorSummary {
  author: string;
  commits: number;
  added: number;
  deleted: number;
  files: number;
  firstCommit: string;
  lastCommit: string;
  /** Files where this author owns the largest share of churn. */
  owned: number;
}

export interface XrayReport {
  tool: { name: string; version: string };
  repo: string;
  generatedAt: string;
  history: {
    commits: number;
    authors: number;
    /** Author date of the oldest commit in range. */
    from: string;
    /** Author date of the newest commit in range. */
    to: string;
    since: string | null;
  };
  totals: {
    /** Files analysed after filtering. */
    files: number;
    lines: number;
    code: number;
    churn: number;
    /**
     * 0-1. Share of the codebase's hotspot weight owned by the single most
     * dominant author. High values mean a real bus-factor problem.
     */
    knowledgeConcentration: number;
  };
  files: FileMetrics[];
  coupling: CouplingPair[];
  authors: AuthorSummary[];
  /** Non-fatal problems worth telling the user about. */
  warnings: string[];
}

export interface AnalyzeOptions {
  /** Repository path. Defaults to cwd. */
  cwd?: string;
  /** Passed to `git log --since`. Accepts anything git accepts. */
  since?: string | undefined;
  /** Ignore files with fewer than this many commits. Default 2. */
  minCommits?: number;
  /** Extra exclude globs, on top of the defaults. */
  exclude?: string[];
  /** Skip the built-in exclude list (lockfiles, vendored code, assets...). */
  includeAll?: boolean;
  /** Commits touching more files than this are ignored for coupling. Default 30. */
  maxCommitFiles?: number;
  /** Minimum shared commits before a coupling pair is reported. Default 5. */
  minSharedCommits?: number;
  /** Minimum coupling degree (0-1) before a pair is reported. Default 0.35. */
  minCouplingDegree?: number;
  /** Called with human-readable progress messages. */
  onProgress?: (message: string) => void;
}
