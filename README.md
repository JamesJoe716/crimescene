<div align="center">

# crimescene

**Your git history already knows which code is rotting. This reads it back to you.**

One command. Zero dependencies. Zero network calls.

[![CI](https://github.com/JamesJoe716/crimescene/actions/workflows/ci.yml/badge.svg)](https://github.com/JamesJoe716/crimescene/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/crimescene.svg)](https://www.npmjs.com/package/crimescene)
[![node](https://img.shields.io/node/v/crimescene.svg)](https://www.npmjs.com/package/crimescene)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```bash
npx crimescene
```

</div>

---

Static analysers tell you what your code *is*. They cannot tell you which parts
you keep going back to at 2am. That information has been sitting in `git log`
the whole time.

`crimescene` reads it and answers three questions no linter can:

|   | Question | What it finds |
|---|----------|---------------|
| 🔥 | **Where do I refactor first?** | Files that change constantly *and* are hard to read. Complexity alone is a bad target — nobody cares about a gnarly file nobody touches. |
| 🚌 | **Who takes the codebase with them if they leave?** | Per-file ownership and bus factor, weighted by how risky that file actually is. |
| 🔗 | **What breaks when I change this?** | Files that keep changing in the same commit while living in different folders. Invisible in the directory tree, expensive when missed. |

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/JamesJoe716/crimescene/main/docs/hotspot-map-dark.svg">
    <img alt="Hotspot map of the express codebase: a treemap where each rectangle is a file, sized by lines of code and coloured by hotspot score" src="https://raw.githubusercontent.com/JamesJoe716/crimescene/main/docs/hotspot-map-light.svg" width="820">
  </picture>
  <p><em>The real <a href="https://github.com/expressjs/express">express</a> codebase. Area = lines of code, colour = hotspot score.</em></p>
</div>

## Try it

```bash
npx crimescene
```

That is the whole setup. It runs in any git repository, writes a self-contained
`crimescene.html` you can open from `file://`, and prints a summary:

```
  express · 5,672 commits, 389 authors, 2009-06-26 → 2026-07-12

  Hotspots — change often, hard to read; refactor from the top
  ┌───────┬──────────────────────────────────────────────────────────┬─────────┬────────┬─────────┐
  │ SCORE │ FILE                                                     │ COMMITS │    LOC │ AUTHORS │
  ├───────┼──────────────────────────────────────────────────────────┼─────────┼────────┼─────────┤
  │  47.7 │ lib/response.js                                          │     392 │    477 │      83 │
  │  46.9 │ test/app.router.js                                       │      91 │    939 │      24 │
  │  42.3 │ test/res.sendFile.js                                     │      70 │    749 │      18 │
  │  28.7 │ test/res.send.js                                         │      69 │    489 │      23 │
  │  23.7 │ test/Router.js                                           │      49 │    505 │      17 │
  │  23.4 │ lib/application.js                                       │     184 │    262 │      41 │
  └───────┴──────────────────────────────────────────────────────────┴─────────┴────────┴─────────┘

  Knowledge risk — one person holds 40% of the risky code
  ┌───────┬────────────────────┬──────────────────────────────────────────────────┬───────┐
  │ OWNED │ AUTHOR             │ FILE                                             │ SCORE │
  ├───────┼────────────────────┼──────────────────────────────────────────────────┼───────┤
  │   96% │ Douglas Christoph… │ test/express.urlencoded.js                       │  14.3 │
  │   98% │ Douglas Christoph… │ test/express.static.js                           │  13.3 │
  │   96% │ Douglas Christoph… │ test/express.json.js                             │  13.2 │
  └───────┴────────────────────┴──────────────────────────────────────────────────┴───────┘

  Change coupling — edited together, but stored apart
  ┌───────┬─────────────────────────────────┬─────────────────────────────────┬────────┐
  │  BOND │ FILE                            │ CHANGES WITH                    │ SHARED │
  ├───────┼─────────────────────────────────┼─────────────────────────────────┼────────┤
  │  100% │ …eparation/views/users/edit.ejs │ …paration/views/users/index.ejs │      6 │
  │  100% │ …paration/views/users/index.ejs │ …eparation/views/users/view.ejs │      6 │
  └───────┴─────────────────────────────────┴─────────────────────────────────┴────────┘
```

5,672 commits analysed in about four seconds.

## What the numbers mean

### Hotspot score

```
hotspot = √( change frequency × complexity )
```

Both terms are normalised against the busiest file in range, so the score is
0–100 relative to *your* repository.

**Change frequency** is how many commits touched the file. **Complexity** is the
sum of indentation depth across its logical lines — deeply nested code is hard
code, in every language, without needing a parser for any of them. The proxy
correlates well with cyclomatic complexity[^1] and costs one pass over the bytes
instead of a per-language AST.

Neither half is interesting alone. A gnarly file nobody edits is not urgent. A
file edited daily that is four lines long is not a problem. The product is the
signal: **complexity you keep paying for**.

### Knowledge risk

For each file, authorship is split between contributors by their share of the
lines changed. From that comes the dominant author, their share, and a bus
factor — the fewest people whose combined share passes 50%.

The headline number weights every file by its hotspot score, so it answers the
question that actually matters: *of the code that is risky, how much does one
person hold?*

### Change coupling

Two files are coupled when they keep appearing in the same commit:

```
coupling(a, b) = commits containing both ÷ commits of the less-changed file
```

Coupling at 100% means one file has never changed without the other. When those
two files live in different modules, that is a design seam in the wrong place —
and it is completely invisible to anything that reads only the current source.

## Usage

```
crimescene [path] [options]

  -o, --out <file>      HTML report path             (default: crimescene.html)
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
```

```bash
# The last year only — most useful on a long-lived repository
npx crimescene --since "1 year ago" --open

# A different repo, without leaving this one
npx crimescene ../other-project

# Machine-readable, for a dashboard
npx crimescene --json report.json --no-html
```

### In CI

`--fail-above` turns the worst hotspot into a build gate, so complexity that
people keep paying for cannot quietly get worse:

```yaml
- run: npx crimescene --no-html --fail-above 70
```

Or publish the report as an artifact on every run — see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml), which does exactly that
for this repository.

### As a library

```bash
npm install crimescene
```

```js
import { analyze, renderReport } from "crimescene";

const report = await analyze({ cwd: "/path/to/repo", since: "1 year ago" });

console.log(report.files[0].path);              // the worst hotspot
console.log(report.totals.knowledgeConcentration); // 0-1
console.log(report.coupling.slice(0, 5));       // strongest coupled pairs

await fs.writeFile("report.html", renderReport(report));
```

The `XrayReport` type is fully typed and stable across the `0.x` line for the
fields documented above.

## What it deliberately does not do

Being honest about this matters more than the feature list:

- **It does not read your code semantically.** Indentation is a proxy. A flat
  3,000-line file of straight-line assignments scores low, and Lisp scores
  oddly. crimescene ranks *which file to open first*; it does not audit what is
  inside.
- **It only scores source files.** Changelogs, lockfiles, `package.json` and
  YAML are the top of every unfiltered churn ranking and none of them are
  refactoring targets, so they are excluded. `--include-all` turns that off, and
  a warning always tells you how many files were skipped.
- **Coupling is computed over the 400 most-changed files.** It is quadratic;
  everything below that cut is stable enough that its coupling would not have
  made the report. The report says so when it applies.
- **Merge commits are ignored**, because their diffs double-count the work
  already attributed to the branch.
- **Renames are followed**, so a renamed file reads as one long history rather
  than two short ones.
- **It never phones home.** No telemetry, no API keys, no network access of any
  kind. The report opens from `file://` on a locked-down laptop.

## How it works

```
git log --numstat  →  per-file churn, authorship, co-change
     ↓
files on disk      →  indentation profile
     ↓
normalise & rank   →  hotspots, bus factor, coupling
     ↓
self-contained HTML + terminal summary
```

Three runtime dependencies: `git`, Node 20+, and your filesystem. The published
package has **zero** npm dependencies — the treemap layout, the glob matcher and
the HTML report are all in the box, which is also why the report is a single
file with no CDN in it.

## Prior art and credit

The three analyses here come from **Adam Tornhill's** research on behavioural
code analysis, published in *Your Code as a Crime Scene* and *Software Design
X-Rays*. The hotspot formula, the indentation complexity proxy, the temporal
coupling measure and the knowledge-map framing are all his ideas. This project
is an independent open-source implementation of them — if you want the depth,
buy the books, and if you want the commercial product with the full analysis
suite, that is [CodeScene](https://codescene.com), which is his too.

The indentation-as-complexity result is from Hindle, Godfrey and Holt.[^1]

[^1]: A. Hindle, M. W. Godfrey, R. C. Holt, *Reading Beside the Lines:
Indentation as a Proxy for Complexity Metrics*, ICPC 2008.

## Contributing

Issues and pull requests are welcome. `npm test` builds the project and runs the
suite, including an end-to-end test that builds a throwaway git repository and
asserts against real `git log` output.

```bash
npm install
npm test
npm run demo     # analyse this repository and open the report
```

## License

[MIT](LICENSE)
