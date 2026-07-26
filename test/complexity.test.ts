import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeComplexity, detectIndentUnit, looksGenerated } from "../src/complexity.js";

describe("detectIndentUnit", () => {
  it("defaults to 4 when nothing is indented", () => {
    assert.equal(detectIndentUnit([0, 0, 0]), 4);
  });

  it("finds a 2-space unit", () => {
    assert.equal(detectIndentUnit([2, 4, 2, 6, 4]), 2);
  });

  it("prefers the largest unit that fits", () => {
    assert.equal(detectIndentUnit([4, 8, 12, 4]), 4);
  });

  it("is not derailed by a few misaligned continuation lines", () => {
    // 9 clean 4-space lines, 1 stray 5-space line: still 4, not 1.
    assert.equal(detectIndentUnit([4, 4, 8, 8, 12, 4, 8, 4, 12, 5]), 4);
  });
});

describe("analyzeComplexity", () => {
  it("returns zeroes for an empty file", () => {
    const stats = analyzeComplexity("");
    assert.equal(stats.code, 0);
    assert.equal(stats.totalIndent, 0);
  });

  it("scores nesting, not length", () => {
    const flat = analyzeComplexity(["const a = 1;", "const b = 2;", "const c = 3;"].join("\n"));
    const nested = analyzeComplexity(
      ["if (a) {", "    if (b) {", "        if (c) {", "            go();", "        }", "    }", "}"].join(
        "\n",
      ),
    );
    assert.equal(flat.totalIndent, 0);
    assert.ok(nested.totalIndent > flat.totalIndent);
    assert.equal(nested.maxIndent, 3);
  });

  it("treats tabs as one level", () => {
    const tabbed = analyzeComplexity(["fn() {", "\tif x {", "\t\tgo()", "\t}", "}"].join("\n"));
    assert.equal(tabbed.maxIndent, 2);
  });

  it("ignores blank lines and comments", () => {
    const stats = analyzeComplexity(
      ["// a comment", "", "   # another", "code();", "   /* block */"].join("\n"),
    );
    assert.equal(stats.code, 1);
    assert.equal(stats.lines, 5);
  });

  it("counts physical lines even when nothing scores", () => {
    const stats = analyzeComplexity(["// one", "// two", "// three"].join("\n"));
    assert.equal(stats.lines, 3);
    assert.equal(stats.code, 0);
  });

  it("handles CRLF the same as LF", () => {
    const lf = analyzeComplexity(["if (a) {", "    go();", "}"].join("\n"));
    const crlf = analyzeComplexity(["if (a) {", "    go();", "}"].join("\r\n"));
    assert.deepEqual(crlf, lf);
  });
});

describe("looksGenerated", () => {
  it("flags a long line with no newlines", () => {
    assert.equal(looksGenerated("x".repeat(20000)), true);
  });

  it("flags anything with a NUL byte", () => {
    assert.equal(looksGenerated("abc\0def"), true);
  });

  it("leaves ordinary source alone", () => {
    const source = Array.from({ length: 400 }, (_, i) => `const x${i} = ${i};`).join("\n");
    assert.equal(looksGenerated(source), false);
  });
});
