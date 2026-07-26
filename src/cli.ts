#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { VERSION, analyze } from "./analyze.js";
import { GitError } from "./git.js";
import { renderReport } from "./report.js";
import { renderMarkdown } from "./markdown.js";
import { renderSvg } from "./svg.js";
import { colorEnabled, createStyler, renderTerminal } from "./terminal.js";

const HELP = `
  crimescene — X-ray a codebase from its git history.

  Usage
    $ crimescene [path] [options]

  Options
    -o, --out <file>      HTML report path             (default: crimescene.html)
        --svg <file>      Also write a static hotspot map, for embedding
        --md <file>       Also write a Markdown summary, for CI and PR comments
        --svg-theme <t>   light or dark                (default: light)
        --json <file>     Also write the raw analysis as JSON
        --since <when>    Only look at commits after this; anything git accepts
                          e.g. "1 year ago", "2024-01-01", "v2.0.0"
        --top <n>         Rows in the terminal summary (default: 12)
        --min-commits <n> Ignore files changed fewer than n times (default: 2)
        --exclude <glob>  Extra path to ignore; repeatable
        --include-all     Keep lockfiles, vendored code and build output
        --open            Open the report when it is done
        --no-html         Terminal (and --json) only
        --fail-above <n>  Exit 1 if the worst hotspot scores above n — for CI
    -q, --quiet           Only errors
    -h, --help            This text
    -v, --version         Print the version

  Examples
    $ npx crimescene
    $ npx crimescene ../some-repo --since "1 year ago" --open
    $ npx crimescene --json report.json --no-html
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      svg: { type: "string" },
      md: { type: "string" },
      "svg-theme": { type: "string" },
      json: { type: "string" },
      since: { type: "string" },
      top: { type: "string" },
      "min-commits": { type: "string" },
      exclude: { type: "string", multiple: true },
      "include-all": { type: "boolean" },
      open: { type: "boolean" },
      "no-html": { type: "boolean" },
      "fail-above": { type: "string" },
      quiet: { type: "boolean", short: "q" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const style = createStyler(colorEnabled(process.stderr));
  const quiet = Boolean(values.quiet);
  const cwd = path.resolve(positionals[0] ?? ".");
  const top = positiveInt(values.top, 12, "--top");
  const minCommits = positiveInt(values["min-commits"], 2, "--min-commits");
  const failAbove = values["fail-above"] === undefined ? null : Number(values["fail-above"]);
  if (failAbove !== null && !Number.isFinite(failAbove)) {
    throw new UsageError(`--fail-above expects a number, got "${values["fail-above"]}"`);
  }
  const svgTheme = values["svg-theme"] ?? "light";
  if (svgTheme !== "light" && svgTheme !== "dark") {
    throw new UsageError(`--svg-theme expects "light" or "dark", got "${svgTheme}"`);
  }
  if (values["svg-theme"] !== undefined && values.svg === undefined) {
    throw new UsageError("--svg-theme has no effect without --svg");
  }

  const spinner = createSpinner(!quiet && process.stderr.isTTY);
  const report = await analyze({
    cwd,
    since: values.since,
    minCommits,
    exclude: values.exclude ?? [],
    includeAll: Boolean(values["include-all"]),
    onProgress: spinner.update,
  });
  spinner.stop();

  if (!values["no-html"]) {
    const target = path.resolve(values.out ?? "crimescene.html");
    await writeFile(target, renderReport(report), "utf8");
    if (!quiet) {
      process.stderr.write(`\n  ${style.green("✓")} ${style.bold("Report")}  ${target}\n`);
    }
    if (values.open) await openInBrowser(target);
  }

  if (values.svg) {
    const target = path.resolve(values.svg);
    await writeFile(target, renderSvg(report, { theme: svgTheme }), "utf8");
    if (!quiet) {
      process.stderr.write(`  ${style.green("✓")} ${style.bold("SVG")}     ${target}\n`);
    }
  }

  if (values.md) {
    const target = path.resolve(values.md);
    await writeFile(target, renderMarkdown(report, { top }), "utf8");
    if (!quiet) {
      process.stderr.write(`  ${style.green("✓")} ${style.bold("Markdown")} ${target}\n`);
    }
  }

  if (values.json) {
    const target = path.resolve(values.json);
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (!quiet) {
      process.stderr.write(`  ${style.green("✓")} ${style.bold("JSON")}    ${target}\n`);
    }
  }

  if (!quiet) {
    process.stdout.write(
      renderTerminal(report, { top, style, width: process.stdout.columns || 100 }),
    );
  }

  const worst = report.files[0]?.hotspot ?? 0;
  if (failAbove !== null && worst > failAbove) {
    process.stderr.write(
      `  ${style.red("✗")} worst hotspot ${worst.toFixed(1)} is above the --fail-above limit of ${failAbove}\n\n`,
    );
    return 1;
  }
  return 0;
}

class UsageError extends Error {
  override name = "UsageError";
}

function positiveInt(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(`${flag} expects a positive integer, got "${raw}"`);
  }
  return value;
}

function createSpinner(active: boolean) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let index = 0;
  let message = "";
  let timer: NodeJS.Timeout | null = null;

  const paint = () => {
    process.stderr.write(`\r\u001b[2K  ${frames[index++ % frames.length]} ${message}`);
  };
  return {
    update(next: string) {
      message = next;
      if (!active) return;
      if (!timer) {
        timer = setInterval(paint, 80);
        timer.unref();
      }
      paint();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (active) process.stderr.write("\r\u001b[2K");
    },
  };
}

/** Best-effort; a failure to open a browser is never worth failing the run. */
async function openInBrowser(target: string): Promise<void> {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  try {
    const child = spawn(command as string, args as string[], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* ignore */
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const style = createStyler(colorEnabled(process.stderr));
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n  ${style.red("✗")} ${message}\n`);
    if (error instanceof UsageError) {
      process.stderr.write(`  Run ${style.bold("crimescene --help")} for usage.\n\n`);
    } else if (!(error instanceof GitError)) {
      process.stderr.write(
        `  If this looks like a bug, please report it:\n` +
          `  https://github.com/JamesJoe716/crimescene/issues\n\n`,
      );
    } else {
      process.stderr.write("\n");
    }
    process.exitCode = 1;
  },
);
