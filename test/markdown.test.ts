import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMarkdown } from "../src/markdown.js";
import type { FileMetrics, XrayReport } from "../src/types.js";

function fileAt(path: string, hotspot: number, share = 1, author = "Ada"): FileMetrics {
  return {
    path,
    commits: 12,
    added: 30,
    deleted: 9,
    churn: 39,
    lines: 120,
    code: 100,
    complexity: 240,
    maxIndent: 5,
    hotspot,
    firstChange: "2023-01-01T00:00:00Z",
    lastChange: "2026-01-01T00:00:00Z",
    ageDays: 7,
    authors: [{ author, churn: 39, commits: 12, share }],
    authorCount: 2,
    mainAuthor: author,
    mainAuthorShare: share,
    busFactor: 1,
  };
}

const report: XrayReport = {
  tool: { name: "crimescene", version: "0.2.0" },
  repo: "demo",
  generatedAt: "2026-02-02T00:00:00Z",
  history: { commits: 4321, authors: 9, from: "2019-05-05T00:00:00Z", to: "2026-02-01T00:00:00Z", since: null },
  totals: { files: 3, lines: 360, code: 300, churn: 117, knowledgeConcentration: 0.61 },
  files: [fileAt("src/hot.ts", 91.2), fileAt("src/mid.ts", 40, 0.5, "Grace"), fileAt("src/low.ts", 4, 0.2, "Alan")],
  coupling: [{ a: "src/hot.ts", b: "src/mid.ts", shared: 9, aCommits: 12, bCommits: 10, degree: 0.9 }],
  authors: [],
  warnings: ["Skipped 4 non-code files (docs, config, data)."],
};

describe("renderMarkdown", () => {
  it("leads with the repository and the range", () => {
    const md = renderMarkdown(report);
    assert.ok(md.includes("**demo**"));
    assert.ok(md.includes("4,321 commits"));
    assert.ok(md.includes("2019-05-05 → 2026-02-01"));
  });

  it("emits well-formed tables", () => {
    const md = renderMarkdown(report);
    for (const line of md.split("\n")) {
      if (!line.startsWith("|") || /^\|[-: |]+\|$/.test(line)) continue;
      const cells = line.split("|").length;
      assert.ok(cells >= 3, `row has too few cells: ${line}`);
    }
    assert.ok(md.includes("| Score | File | Commits | LOC | Authors | Last touched |"));
  });

  it("honours --top", () => {
    const rows = (md: string) => md.split("\n").filter((l) => l.includes("`src/")).length;
    assert.ok(rows(renderMarkdown(report, { top: 1 })) < rows(renderMarkdown(report, { top: 10 })));
  });

  it("links paths when a blob base is given, and not otherwise", () => {
    // The footer links the project itself, so check the file path specifically
    // rather than looking for any link at all.
    assert.ok(renderMarkdown(report).includes("`src/hot.ts`"));
    assert.equal(renderMarkdown(report).includes("[`src/hot.ts`]("), false);

    const linked = renderMarkdown(report, { blobBase: "https://example.com/blob/main" });
    assert.ok(linked.includes("[`src/hot.ts`](https://example.com/blob/main/src/hot.ts)"));
  });

  it("escapes a pipe so an author name cannot split the row", () => {
    const hostile: XrayReport = {
      ...report,
      files: [fileAt("src/a.ts", 90, 1, "Eve | Injected | Column")],
    };
    const md = renderMarkdown(hostile);
    assert.ok(md.includes("Eve \\| Injected \\| Column"));
  });

  it("shifts heading levels", () => {
    assert.ok(renderMarkdown(report, { headingLevel: 1 }).startsWith("# 🔬 crimescene"));
    assert.ok(renderMarkdown(report, { headingLevel: 3 }).startsWith("### 🔬 crimescene"));
  });

  it("omits sections it has no data for", () => {
    const bare: XrayReport = { ...report, coupling: [], warnings: [] };
    const md = renderMarkdown(bare);
    assert.equal(md.includes("Change coupling"), false);
    assert.equal(md.includes("<details>"), false);
  });

  it("says so plainly when nothing scored", () => {
    const empty: XrayReport = { ...report, files: [], totals: { ...report.totals, files: 0 } };
    const md = renderMarkdown(empty);
    assert.ok(md.includes("No files scored"));
    assert.equal(md.includes("Hotspots"), false);
  });
});
