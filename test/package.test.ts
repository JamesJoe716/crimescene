import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { VERSION } from "../src/analyze.js";

/** From build-test/test/ this resolves to the repository root. */
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  version: string;
  bin: Record<string, string>;
  files: string[];
  dependencies?: Record<string, string>;
  engines: { node: string };
};

describe("package metadata", () => {
  it("keeps VERSION in step with package.json", () => {
    // The CLI prints VERSION and the report embeds it; publishing a mismatch
    // means a bug report cites a version that never existed.
    assert.equal(
      VERSION,
      packageJson.version,
      "src/analyze.ts VERSION and package.json version must match",
    );
  });

  it("ships no runtime dependencies", () => {
    // "Zero dependencies" is a documented promise, not an accident.
    assert.deepEqual(packageJson.dependencies ?? {}, {});
  });

  it("points bin at a file the build actually produces", () => {
    assert.equal(packageJson.bin["crimescene"], "dist/cli.js");
    assert.ok(packageJson.files.includes("dist"));
  });

  it("declares the Node floor the test matrix covers", () => {
    assert.equal(packageJson.engines.node, ">=20");
  });
});
