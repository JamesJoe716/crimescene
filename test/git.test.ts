import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRenamePath } from "../src/git.js";

describe("parseRenamePath", () => {
  it("passes an ordinary path through untouched", () => {
    assert.deepEqual(parseRenamePath("src/index.ts"), { from: "src/index.ts", to: "src/index.ts" });
  });

  it("splits the arrow form", () => {
    assert.deepEqual(parseRenamePath("old/a.ts => new/b.ts"), {
      from: "old/a.ts",
      to: "new/b.ts",
    });
  });

  it("splits the braced form", () => {
    assert.deepEqual(parseRenamePath("src/{old => new}/file.ts"), {
      from: "src/old/file.ts",
      to: "src/new/file.ts",
    });
  });

  it("handles a brace that empties one side", () => {
    assert.deepEqual(parseRenamePath("src/{ => nested}/file.ts"), {
      from: "src/file.ts",
      to: "src/nested/file.ts",
    });
  });

  it("handles a move to the repository root", () => {
    assert.deepEqual(parseRenamePath("{src => }/file.ts"), {
      from: "src/file.ts",
      to: "file.ts",
    });
  });

  it("keeps a filename that merely contains an arrow-like string", () => {
    assert.deepEqual(parseRenamePath("src/a=>b.ts"), { from: "src/a=>b.ts", to: "src/a=>b.ts" });
  });
});
