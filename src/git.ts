import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Commit, FileChange } from "./types.js";

const execFileAsync = promisify(execFile);

/** Record separator emitted before every commit header line. */
const RS = "\x1e";
/** Field separator inside a commit header line. */
const FS = "\x1f";

export class GitError extends Error {
  override name = "GitError";
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT/.test(message)) {
      throw new GitError("`git` was not found on your PATH. crimescene needs git to read history.");
    }
    throw new GitError(`git ${args.join(" ")} failed:\n${message}`);
  }
}

/** Absolute path to the repository root containing `cwd`. */
export async function repoRoot(cwd: string): Promise<string> {
  try {
    return await git(cwd, ["rev-parse", "--show-toplevel"]);
  } catch (err) {
    if (err instanceof GitError && /not a git repository/i.test(err.message)) {
      throw new GitError(`Not a git repository: ${cwd}`);
    }
    throw err;
  }
}

/** Files currently tracked by git, as repo-relative POSIX paths. */
export async function trackedFiles(cwd: string): Promise<Set<string>> {
  const out = await git(cwd, ["ls-files", "-z"]);
  return new Set(out.split("\0").filter(Boolean));
}

/**
 * `numstat` renders renames in two shapes:
 *   `old/path.ts => new/path.ts`
 *   `src/{old => new}/file.ts`
 * Both collapse to a from/to pair. Non-renames return the same path twice.
 */
export function parseRenamePath(raw: string): { from: string; to: string } {
  const braced = /^(.*)\{(.*?) => (.*?)\}(.*)$/.exec(raw);
  if (braced) {
    const [, prefix = "", from = "", to = "", suffix = ""] = braced;
    return {
      from: tidy(prefix + from + suffix),
      to: tidy(prefix + to + suffix),
    };
  }
  const arrow = raw.indexOf(" => ");
  if (arrow !== -1) {
    return { from: tidy(raw.slice(0, arrow)), to: tidy(raw.slice(arrow + 4)) };
  }
  return { from: raw, to: raw };
}

/** `src/{ => new}/file.ts` leaves a double slash behind once the braces go. */
function tidy(path: string): string {
  return path.replace(/\/{2,}/g, "/").replace(/^\//, "");
}

/**
 * Streams `git log --numstat` and yields one {@link Commit} at a time, newest
 * first. Renames are followed so that every {@link FileChange} uses the file's
 * *current* path — otherwise a renamed file looks like two young files instead
 * of one old one, which is exactly the history a hotspot analysis needs.
 */
export async function* readHistory(
  cwd: string,
  options: { since?: string | undefined } = {},
): AsyncGenerator<Commit> {
  const args = [
    "log",
    "--no-merges",
    "--numstat",
    "--find-renames",
    "--no-color",
    `--pretty=format:${RS}%H${FS}%an${FS}%ae${FS}%aI${FS}%s`,
  ];
  if (options.since) args.push(`--since=${options.since}`);

  const child = spawn("git", args, { cwd, windowsHide: true });
  child.stdout.setEncoding("utf8");

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 8192) stderr += chunk;
  });

  const exited = new Promise<void>((resolve, reject) => {
    child.on("error", (err) =>
      reject(
        /ENOENT/.test(err.message)
          ? new GitError("`git` was not found on your PATH. crimescene needs git to read history.")
          : err,
      ),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new GitError(`git log exited with code ${code}${stderr ? `:\n${stderr.trim()}` : ""}`));
    });
  });
  // Nothing awaits `exited` until the stream drains; without this the rejection
  // would be unhandled for a tick and crash the process.
  exited.catch(() => {});

  /** Newest known name for a path, so renames fold into one history. */
  const aliases = new Map<string, string>();
  const canonical = (path: string): string => aliases.get(path) ?? path;

  let current: Commit | null = null;
  let buffer = "";

  const parseLine = (line: string): Commit | null => {
    if (line.startsWith(RS)) {
      const finished = current;
      const [hash = "", author = "", email = "", date = "", ...rest] = line.slice(1).split(FS);
      current = { hash, author, email, date, subject: rest.join(FS), files: [] };
      return finished;
    }
    if (!current || !line) return null;

    // `<added>\t<deleted>\t<path>`, where added/deleted are `-` for binaries.
    const first = line.indexOf("\t");
    const second = line.indexOf("\t", first + 1);
    if (first === -1 || second === -1) return null;

    const addedRaw = line.slice(0, first);
    const deletedRaw = line.slice(first + 1, second);
    const { from, to } = parseRenamePath(line.slice(second + 1));

    const path = canonical(to);
    if (from !== to) aliases.set(from, path);

    const binary = addedRaw === "-" || deletedRaw === "-";
    const change: FileChange = {
      path,
      added: binary ? 0 : Number(addedRaw) || 0,
      deleted: binary ? 0 : Number(deletedRaw) || 0,
      binary,
    };
    current.files.push(change);
    return null;
  };

  for await (const chunk of child.stdout as AsyncIterable<string>) {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const finished = parseLine(line);
      if (finished) yield finished;
    }
  }
  if (buffer) {
    const finished = parseLine(buffer);
    if (finished) yield finished;
  }
  if (current) yield current;

  await exited;
}
