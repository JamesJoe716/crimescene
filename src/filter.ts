/**
 * Path filtering.
 *
 * Lockfiles and vendored bundles are the two things guaranteed to top a churn
 * ranking while being completely useless as refactoring targets, so they are
 * excluded by default. `--include-all` turns the whole list off.
 */

export const DEFAULT_EXCLUDES: string[] = [
  // Dependency and build output
  "**/node_modules/**",
  "**/vendor/**",
  "**/third_party/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/target/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/__pycache__/**",
  "**/site-packages/**",

  // Lockfiles — enormous churn, zero insight
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/Pipfile.lock",
  "**/composer.lock",
  "**/Gemfile.lock",
  "**/go.sum",
  "**/gradle.lockfile",
  "**/*.lock",

  // Minified / generated
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.bundle.js",
  "**/*.pb.go",
  "**/*_pb2.py",
  "**/*.generated.*",
  "**/*.g.dart",

  // Binary and asset formats
  "**/*.{png,jpg,jpeg,gif,bmp,ico,webp,avif,tiff,psd}",
  "**/*.{woff,woff2,ttf,otf,eot}",
  "**/*.{mp3,mp4,wav,ogg,webm,mov,avi}",
  "**/*.{zip,gz,tgz,bz2,xz,7z,rar,jar,war}",
  "**/*.{pdf,doc,docx,xls,xlsx,ppt,pptx}",
  "**/*.{so,dylib,dll,exe,bin,o,a,class,pyc,wasm}",
  "**/*.{db,sqlite,sqlite3}",
  "**/*.snap",
];

/**
 * Extensions the hotspot score is meaningful for.
 *
 * The score multiplies change frequency by nesting depth, which only means
 * something for code you could actually refactor. Run it over a repository
 * unfiltered and the top of the ranking is always the changelog, the lockfile
 * and `package.json` — files with enormous churn and nothing to fix. Data,
 * config and prose are therefore scored only under `--include-all`.
 */
export const CODE_EXTENSIONS = new Set([
  // Web
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "vue", "svelte", "astro",
  "css", "scss", "sass", "less", "styl",
  // JVM / .NET
  "java", "kt", "kts", "scala", "groovy", "clj", "cljs", "cljc",
  "cs", "fs", "fsx", "vb",
  // Systems
  "c", "h", "cc", "cpp", "cxx", "hh", "hpp", "hxx", "rs", "go", "zig", "d", "nim",
  "m", "mm", "swift", "objc",
  // Scripting
  "py", "pyi", "rb", "rake", "php", "pl", "pm", "lua", "tcl", "r", "jl", "dart",
  "ex", "exs", "erl", "hrl", "hs", "ml", "mli", "elm", "cr", "gleam", "v",
  // Shell and build logic
  "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd", "mk", "cmake",
  "gradle", "sbt", "bzl", "bazel", "nix",
  // Templates that carry logic
  "erb", "ejs", "hbs", "mustache", "jinja", "j2", "twig", "blade", "haml", "slim",
  "pug", "jade", "razor", "cshtml", "vbhtml",
  // Query and schema languages
  "sql", "psql", "plsql", "graphql", "gql", "prisma", "proto", "thrift", "capnp",
  // Infrastructure as code
  "tf", "tfvars", "hcl", "sol", "asm", "s",
]);

/** Extension-less files that are still logic. */
export const CODE_FILENAMES = new Set([
  "makefile", "gnumakefile", "dockerfile", "containerfile", "rakefile",
  "gemfile", "guardfile", "vagrantfile", "brewfile", "justfile", "procfile",
  "jenkinsfile", "fastfile", "appfile", "podfile", "cartfile",
]);

/** True when the hotspot score is meaningful for this path. */
export function isCodeFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (CODE_FILENAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return CODE_EXTENSIONS.has(name.slice(dot + 1));
}

/**
 * Compile a glob to a regex. Supports `**`, `*`, `?` and `{a,b}` alternation —
 * the subset that path filters actually use. Adding a glob dependency for this
 * would cost more than it saves.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // `**/` also matches zero directories, so `**/x` matches a top-level `x`.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) {
        out += "\\{";
      } else {
        const alternatives = glob.slice(i + 1, close).split(",");
        out += `(?:${alternatives.map(escapeLiteral).join("|")})`;
        i = close;
      }
    } else {
      out += escapeLiteral(char);
    }
  }
  return new RegExp(`^${out}$`, "i");
}

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class PathFilter {
  private readonly patterns: RegExp[];

  constructor(options: { exclude?: string[]; includeAll?: boolean } = {}) {
    const globs = [...(options.includeAll ? [] : DEFAULT_EXCLUDES), ...(options.exclude ?? [])];
    this.patterns = globs.map(globToRegExp);
  }

  /** True when the path survives every exclude pattern. */
  accepts(path: string): boolean {
    for (const pattern of this.patterns) {
      if (pattern.test(path)) return false;
    }
    return true;
  }
}
