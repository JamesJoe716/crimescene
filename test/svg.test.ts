import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderSvg } from "../src/svg.js";
import type { FileMetrics, XrayReport } from "../src/types.js";

function fileAt(path: string, code: number, hotspot: number): FileMetrics {
  return {
    path,
    commits: 5,
    added: 10,
    deleted: 4,
    churn: 14,
    lines: code + 5,
    code,
    complexity: code * 2,
    maxIndent: 4,
    hotspot,
    firstChange: "2024-01-01T00:00:00Z",
    lastChange: "2024-06-01T00:00:00Z",
    ageDays: 30,
    authors: [{ author: "Ada", churn: 14, commits: 5, share: 1 }],
    authorCount: 1,
    mainAuthor: "Ada",
    mainAuthorShare: 1,
    busFactor: 1,
  };
}

const report: XrayReport = {
  tool: { name: "crimescene", version: "0.1.0" },
  repo: "demo",
  generatedAt: "2026-01-01T00:00:00Z",
  history: {
    commits: 1234,
    authors: 7,
    from: "2020-03-04T00:00:00Z",
    to: "2026-01-01T00:00:00Z",
    since: null,
  },
  totals: { files: 4, lines: 400, code: 380, churn: 56, knowledgeConcentration: 0.42 },
  files: [
    fileAt("src/hot.ts", 300, 100),
    fileAt("src/warm.ts", 120, 44),
    // Deliberately not named "cold": the legend prints that word, and a path
    // containing it would make the legend-off assertion below pass by accident.
    fileAt("lib/util/quiet.ts", 60, 3),
    fileAt("README.ts", 20, 0),
  ],
  coupling: [],
  authors: [],
  warnings: [],
};

describe("renderSvg", () => {
  it("produces a standalone SVG document", () => {
    const svg = renderSvg(report);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok(svg.trimEnd().endsWith("</svg>"));
  });

  it("carries no script and no external reference", () => {
    const svg = renderSvg(report);
    assert.equal(/<script/i.test(svg), false, "GitHub strips SVGs that contain script");
    assert.equal(/href|xlink:|<image/i.test(svg), false, "must not reference anything external");
    assert.equal(/<foreignObject/i.test(svg), false);
  });

  it("draws one rectangle per file plus chrome", () => {
    const svg = renderSvg(report);
    const rects = svg.match(/<rect /g) ?? [];
    assert.ok(rects.length >= report.files.length, `only ${rects.length} rects for 4 files`);
  });

  it("uses the light ramp on light and the dark ramp on dark", () => {
    assert.ok(renderSvg(report, { theme: "light" }).includes("#7c3111"));
    assert.ok(renderSvg(report, { theme: "dark" }).includes("#f9b98e"));
  });

  it("names the repository and the hottest file in the accessible label", () => {
    const svg = renderSvg(report);
    assert.match(svg, /aria-label="[^"]*demo[^"]*"/);
    assert.ok(svg.includes("src/hot.ts"));
  });

  it("escapes text rather than letting it break the markup", () => {
    const hostile: XrayReport = { ...report, repo: '<script>alert("x")</script>&' };
    const svg = renderSvg(hostile);
    assert.equal(svg.includes("<script>"), false);
    assert.ok(svg.includes("&lt;script&gt;"));
    assert.ok(svg.includes("&amp;"));
  });

  it("honours the header and legend switches", () => {
    const bare = renderSvg(report, { header: false, legend: false });
    assert.equal(bare.includes("cold"), false);
    assert.equal(bare.includes("1,234 commits"), false);

    const full = renderSvg(report);
    assert.ok(full.includes("cold"));
    assert.ok(full.includes("1,234 commits"));
  });

  it("survives an empty repository without producing broken geometry", () => {
    const empty: XrayReport = { ...report, files: [], totals: { ...report.totals, files: 0 } };
    const svg = renderSvg(empty);
    assert.ok(svg.includes("</svg>"));
    assert.equal(/(?:width|height)="-/.test(svg), false, "no negative dimensions");
    assert.equal(/NaN|Infinity/.test(svg), false, "no NaN leaked into the geometry");
  });

  it("never emits NaN geometry at awkward sizes", () => {
    for (const size of [
      { width: 200, height: 150 },
      { width: 1600, height: 400 },
      { width: 300, height: 1200 },
    ]) {
      const svg = renderSvg(report, size);
      assert.equal(/NaN|Infinity|="-\d/.test(svg), false, `broken geometry at ${size.width}x${size.height}`);
    }
  });
});
