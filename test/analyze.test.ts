import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { analyze } from "../src/analyze.js";
import { renderReport } from "../src/report.js";
import type { XrayReport } from "../src/types.js";

/**
 * End-to-end over a repository built on the fly, so the assertions cover the
 * real `git log` output rather than a fixture that can drift from it.
 */

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_DATE: undefined,
  GIT_CONFIG_GLOBAL: path.join(tmpdir(), "crimescene-no-such-gitconfig"),
  GIT_CONFIG_SYSTEM: path.join(tmpdir(), "crimescene-no-such-gitconfig"),
};

let repo: string;
let report: XrayReport;

function run(args: string[], cwd: string, author?: string): void {
  const env = author
    ? { ...GIT_ENV, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@example.com` }
    : GIT_ENV;
  execFileSync("git", args, { cwd, env: env as NodeJS.ProcessEnv, stdio: "pipe" });
}

function write(file: string, body: string): void {
  const target = path.join(repo, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body);
}

function commit(message: string, author = "Alice"): void {
  run(["add", "-A"], repo);
  run(["commit", "-q", "-m", message, "--no-gpg-sign"], repo, author);
}

/** `depth` levels of nesting, so the complexity proxy has something to chew on. */
function nested(depth: number, tag: string): string {
  const lines: string[] = [];
  for (let i = 0; i < depth; i++) lines.push(`${"    ".repeat(i)}if (level${i}) {`);
  lines.push(`${"    ".repeat(depth)}work("${tag}");`);
  for (let i = depth - 1; i >= 0; i--) lines.push(`${"    ".repeat(i)}}`);
  return lines.join("\n") + "\n";
}

before(() => {
  repo = mkdtempSync(path.join(tmpdir(), "crimescene-test-"));
  run(["init", "-q", "-b", "main"], repo);
  run(["config", "user.name", "Test"], repo);
  run(["config", "user.email", "test@example.com"], repo);
  run(["config", "commit.gpgsign", "false"], repo);

  // A file that changes constantly and nests deeply — the archetypal hotspot.
  for (let i = 0; i < 7; i++) {
    write("src/hot.ts", nested(6, `hot-${i}`));
    commit(`touch hot ${i}`, i % 3 === 0 ? "Bob" : "Alice");
  }

  // Deep but stable: complexity without churn must not top the ranking.
  write("src/calm.ts", nested(8, "calm"));
  commit("add calm");
  write("src/calm.ts", nested(8, "calm-2"));
  commit("tweak calm");

  // Two files that always move together, in different folders.
  for (let i = 0; i < 6; i++) {
    write("api/handler.ts", nested(3, `handler-${i}`));
    write("web/client.ts", nested(3, `client-${i}`));
    commit(`sync contract ${i}`, "Carol");
  }

  // Excluded by default despite being the most-changed path in the repo.
  for (let i = 0; i < 9; i++) {
    write("package-lock.json", `{"lockfileVersion": ${i}}\n`);
    commit(`bump lock ${i}`);
  }

  // Renamed halfway through: history must fold into the current path.
  write("src/before.ts", nested(4, "renamed-0"));
  commit("add before");
  write("src/before.ts", nested(4, "renamed-1"));
  commit("edit before");
  run(["mv", "src/before.ts", "src/after.ts"], repo);
  commit("rename before to after");
  write("src/after.ts", nested(4, "renamed-2"));
  commit("edit after");
});

after(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe("analyze", () => {
  it("runs over a real repository", async () => {
    report = await analyze({ cwd: repo, minCommits: 2, minSharedCommits: 3 });
    assert.ok(report.history.commits > 20, "expected the whole history");
    assert.ok(report.files.length > 0, "expected scored files");
  });

  it("ranks the churning file above the merely complex one", () => {
    const hot = report.files.find((f) => f.path === "src/hot.ts");
    const calm = report.files.find((f) => f.path === "src/calm.ts");
    assert.ok(hot, "src/hot.ts should be scored");
    assert.ok(calm, "src/calm.ts should be scored");
    assert.ok(
      hot!.hotspot > calm!.hotspot,
      `hot ${hot!.hotspot} should outrank calm ${calm!.hotspot}`,
    );
    assert.equal(report.files[0]!.path, "src/hot.ts");
  });

  it("excludes lockfiles even when they dominate the churn", () => {
    assert.equal(
      report.files.some((f) => f.path === "package-lock.json"),
      false,
    );
  });

  it("includes lockfiles under includeAll", async () => {
    const loose = await analyze({ cwd: repo, minCommits: 2, includeAll: true });
    assert.ok(loose.files.some((f) => f.path === "package-lock.json"));
  });

  it("folds a rename into a single history", () => {
    const after = report.files.find((f) => f.path === "src/after.ts");
    assert.ok(after, "the renamed file should be scored under its current path");
    // 2 commits before the rename + the rename + 1 after.
    assert.ok(after!.commits >= 3, `expected the pre-rename commits, got ${after!.commits}`);
    assert.equal(
      report.files.some((f) => f.path === "src/before.ts"),
      false,
      "the old path should not appear separately",
    );
  });

  it("finds files that change together across folders", () => {
    const pair = report.coupling.find(
      (c) =>
        (c.a === "api/handler.ts" && c.b === "web/client.ts") ||
        (c.a === "web/client.ts" && c.b === "api/handler.ts"),
    );
    assert.ok(pair, "handler and client should be coupled");
    assert.ok(pair!.shared >= 6, `expected 6 shared commits, got ${pair!.shared}`);
    assert.equal(pair!.degree, 1);
  });

  it("attributes ownership", () => {
    const handler = report.files.find((f) => f.path === "api/handler.ts");
    assert.equal(handler!.mainAuthor, "Carol");
    assert.equal(handler!.mainAuthorShare, 1);
    assert.equal(handler!.busFactor, 1);

    const hot = report.files.find((f) => f.path === "src/hot.ts");
    assert.ok(hot!.authorCount >= 2, "hot.ts had two authors");
  });

  it("reports author summaries", () => {
    const carol = report.authors.find((a) => a.author === "Carol");
    assert.ok(carol, "Carol should be listed");
    assert.equal(carol!.commits, 6);
    assert.ok(carol!.owned >= 2, "Carol owns both coupled files");
  });

  it("keeps knowledge concentration in range", () => {
    assert.ok(report.totals.knowledgeConcentration > 0);
    assert.ok(report.totals.knowledgeConcentration <= 1);
  });

  it("honours --since", async () => {
    // Keep this inside git's date range: past roughly 2099 its parser gives up
    // and silently drops the filter, so a year like 2999 returns everything.
    const future = await analyze({ cwd: repo, since: "2099-12-31", minCommits: 1 }).then(
      () => "resolved",
      (error: unknown) => (error as Error).message,
    );
    assert.match(String(future), /No commits found/);
  });

  it("narrows the range when --since is inside it", async () => {
    const all = await analyze({ cwd: repo, minCommits: 1 });
    const recent = await analyze({ cwd: repo, since: "1970-01-01", minCommits: 1 });
    assert.equal(recent.history.commits, all.history.commits);
    assert.equal(recent.history.since, "1970-01-01");
  });

  it("rejects a directory that is not a repository", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "crimescene-bare-"));
    try {
      await assert.rejects(analyze({ cwd: empty }), /Not a git repository|not a git repository/i);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("renderReport", () => {
  it("produces one self-contained HTML file", () => {
    const html = renderReport(report);
    assert.match(html, /^<!doctype html>/);
    assert.ok(html.includes("</html>"));
    // No network: nothing may reference an external origin.
    assert.equal(/(?:src|href)\s*=\s*["']https?:/i.test(html), false, "found an external reference");
    assert.equal(html.includes("<link"), false, "found an external stylesheet");
  });

  it("escapes the payload so it cannot break out of the script block", () => {
    const hostile: XrayReport = {
      ...report,
      repo: "</script><script>alert(1)</script>",
    };
    const html = renderReport(hostile);
    const payload = html.slice(html.indexOf('<script id="data"'));
    assert.equal(payload.includes("</script><script>alert(1)"), false);
    assert.ok(html.includes("\\u003c/script>"), "the payload should escape its angle brackets");
  });

  it("round-trips the embedded JSON", () => {
    const html = renderReport(report);
    const start = html.indexOf('type="application/json">') + 'type="application/json">'.length;
    const end = html.indexOf("</script>", start);
    const parsed = JSON.parse(html.slice(start, end)) as XrayReport;
    assert.equal(parsed.files.length, report.files.length);
    assert.equal(parsed.files[0]!.path, report.files[0]!.path);
  });
});
