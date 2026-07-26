import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PathFilter, globToRegExp, isCodeFile } from "../src/filter.js";

describe("globToRegExp", () => {
  const matches = (glob: string, path: string) => globToRegExp(glob).test(path);

  it("matches a literal path", () => {
    assert.ok(matches("src/index.ts", "src/index.ts"));
    assert.ok(!matches("src/index.ts", "src/other.ts"));
  });

  it("keeps a single star inside one segment", () => {
    assert.ok(matches("src/*.ts", "src/index.ts"));
    assert.ok(!matches("src/*.ts", "src/deep/index.ts"));
  });

  it("lets a double star cross directories", () => {
    assert.ok(matches("**/node_modules/**", "a/b/node_modules/c/d.js"));
    assert.ok(matches("**/*.min.js", "static/js/app.min.js"));
  });

  it("lets **/ match zero directories", () => {
    assert.ok(matches("**/yarn.lock", "yarn.lock"));
    assert.ok(matches("**/yarn.lock", "packages/web/yarn.lock"));
  });

  it("expands brace alternation", () => {
    assert.ok(matches("**/*.{png,jpg}", "docs/logo.png"));
    assert.ok(matches("**/*.{png,jpg}", "docs/logo.jpg"));
    assert.ok(!matches("**/*.{png,jpg}", "docs/logo.svg"));
  });

  it("does not let a dot act as a wildcard", () => {
    assert.ok(!matches("a.ts", "axts"));
  });

  it("survives an unbalanced brace", () => {
    assert.ok(matches("weird{name.ts", "weird{name.ts"));
  });
});

describe("PathFilter", () => {
  it("drops lockfiles and vendored code by default", () => {
    const filter = new PathFilter();
    assert.equal(filter.accepts("package-lock.json"), false);
    assert.equal(filter.accepts("web/node_modules/react/index.js"), false);
    assert.equal(filter.accepts("static/app.min.js"), false);
    assert.equal(filter.accepts("docs/screenshot.png"), false);
    assert.equal(filter.accepts("src/analyze.ts"), true);
  });

  it("keeps everything under includeAll", () => {
    const filter = new PathFilter({ includeAll: true });
    assert.equal(filter.accepts("package-lock.json"), true);
    assert.equal(filter.accepts("web/node_modules/react/index.js"), true);
  });

  it("honours extra excludes even under includeAll", () => {
    const filter = new PathFilter({ includeAll: true, exclude: ["**/*.md"] });
    assert.equal(filter.accepts("README.md"), false);
    assert.equal(filter.accepts("src/index.ts"), true);
  });

  it("is case-insensitive, because Windows and macOS are", () => {
    const filter = new PathFilter();
    assert.equal(filter.accepts("Docs/Logo.PNG"), false);
  });
});

describe("isCodeFile", () => {
  it("accepts mainstream source files", () => {
    for (const path of [
      "src/index.ts",
      "app/models/user.rb",
      "cmd/server/main.go",
      "lib/render.jsx",
      "styles/app.scss",
      "db/schema.sql",
      "infra/main.tf",
      "scripts/deploy.sh",
    ]) {
      assert.equal(isCodeFile(path), true, `${path} should count as code`);
    }
  });

  it("rejects the churn magnets that would otherwise top the ranking", () => {
    for (const path of [
      "History.md",
      "CHANGELOG.md",
      "package.json",
      "docs/guide.rst",
      ".github/workflows/ci.yml",
      "data/fixtures.csv",
      "config/settings.toml",
      "notes.txt",
    ]) {
      assert.equal(isCodeFile(path), false, `${path} should not count as code`);
    }
  });

  it("accepts extension-less build files", () => {
    assert.equal(isCodeFile("Makefile"), true);
    assert.equal(isCodeFile("docker/Dockerfile"), true);
    assert.equal(isCodeFile("Rakefile"), true);
  });

  it("does not treat a dotfile as an extension", () => {
    assert.equal(isCodeFile(".gitignore"), false);
    assert.equal(isCodeFile("src/.eslintrc"), false);
  });
});
