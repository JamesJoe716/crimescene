import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RAMP_DARK,
  RAMP_LIGHT,
  SHARED_SOURCE,
  buildTree,
  clipLabel,
  heatColor,
  inkOn,
  nodeHotspot,
  squarify,
} from "../src/treemap.js";
import type { TreeNode } from "../src/treemap.js";
import type { FileMetrics } from "../src/types.js";

function fileAt(path: string, code: number, hotspot: number): FileMetrics {
  return {
    path,
    commits: 1,
    added: 0,
    deleted: 0,
    churn: 0,
    lines: code,
    code,
    complexity: 0,
    maxIndent: 0,
    hotspot,
    firstChange: "2024-01-01T00:00:00Z",
    lastChange: "2024-01-01T00:00:00Z",
    ageDays: 0,
    authors: [],
    authorCount: 1,
    mainAuthor: "someone",
    mainAuthorShare: 1,
    busFactor: 1,
  };
}

describe("buildTree", () => {
  it("groups paths into folders and rolls sizes up", () => {
    const tree = buildTree(
      [fileAt("src/a.ts", 100, 50), fileAt("src/b.ts", 50, 10), fileAt("test/c.ts", 25, 0)],
      "repo",
    );
    assert.equal(tree.value, 175);
    assert.equal(tree.files, 3);
    assert.deepEqual(
      tree.children!.map((c) => c.name),
      ["src", "test"],
      "children sort by size, largest first",
    );
    const src = tree.children![0]!;
    assert.equal(src.value, 150);
    assert.equal(src.files, 2);
  });

  it("gives a file of zero lines a floor of one, so it still gets a rectangle", () => {
    const tree = buildTree([fileAt("empty.ts", 0, 5)], "repo");
    assert.equal(tree.value, 1);
  });

  it("weights a folder's hotspot by size, not by file count", () => {
    // One big cold file plus one tiny hot one must read as mostly cold.
    const tree = buildTree([fileAt("d/big.ts", 900, 0), fileAt("d/tiny.ts", 100, 100)], "repo");
    const folder = tree.children![0]!;
    assert.equal(Math.round(nodeHotspot(folder)), 10);
  });
});

describe("squarify", () => {
  const node = (value: number): TreeNode => ({ name: String(value), path: "", value, weight: 0, files: 1 });

  it("tiles the rectangle exactly", () => {
    const rect = { x: 0, y: 0, w: 400, h: 300 };
    const placed = squarify([100, 60, 40, 30, 20, 10, 5].map(node), rect);
    const area = placed.reduce((sum, p) => sum + p.w * p.h, 0);
    assert.ok(Math.abs(area - rect.w * rect.h) < 1, `covered ${area} of ${rect.w * rect.h}`);
  });

  it("stays inside its bounds", () => {
    const rect = { x: 10, y: 20, w: 300, h: 200 };
    for (const cell of squarify([50, 30, 12, 8, 3].map(node), rect)) {
      assert.ok(cell.x >= rect.x - 0.001 && cell.y >= rect.y - 0.001, "no cell starts outside");
      assert.ok(cell.x + cell.w <= rect.x + rect.w + 0.001, "no cell overflows right");
      assert.ok(cell.y + cell.h <= rect.y + rect.h + 0.001, "no cell overflows bottom");
    }
  });

  it("avoids slivers — that is the whole point of squarifying", () => {
    const placed = squarify([120, 90, 70, 55, 40, 30, 22, 15, 10, 6].map(node), {
      x: 0,
      y: 0,
      w: 800,
      h: 500,
    });
    const worst = Math.max(...placed.map((p) => Math.max(p.w / p.h, p.h / p.w)));
    assert.ok(worst < 6, `worst aspect ratio was ${worst.toFixed(2)}`);
  });

  it("drops zero-sized nodes instead of dividing by zero", () => {
    const placed = squarify([10, 0, 5, 0].map(node), { x: 0, y: 0, w: 100, h: 100 });
    assert.equal(placed.length, 2);
  });

  it("returns nothing for a degenerate rectangle", () => {
    assert.deepEqual(squarify([node(10)], { x: 0, y: 0, w: 0, h: 50 }), []);
    assert.deepEqual(squarify([], { x: 0, y: 0, w: 50, h: 50 }), []);
  });
});

describe("heatColor", () => {
  it("pins the ends of the ramp", () => {
    assert.equal(heatColor(0, RAMP_LIGHT), RAMP_LIGHT[0]);
    assert.equal(heatColor(1, RAMP_LIGHT), RAMP_LIGHT[RAMP_LIGHT.length - 1]);
  });

  it("clamps out-of-range input", () => {
    assert.equal(heatColor(-5, RAMP_LIGHT), RAMP_LIGHT[0]);
    assert.equal(heatColor(99, RAMP_DARK), RAMP_DARK[RAMP_DARK.length - 1]);
  });

  it("always returns a well-formed hex colour", () => {
    for (let i = 0; i <= 20; i++) {
      const colour = heatColor(i / 20, RAMP_LIGHT);
      assert.match(colour, /^#[0-9a-f]{6}$/, `t=${i / 20} produced ${colour}`);
    }
  });

  it("runs light-to-dark on light and dark-to-light on dark", () => {
    const luma = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    assert.ok(luma(heatColor(0, RAMP_LIGHT)) > luma(heatColor(1, RAMP_LIGHT)));
    assert.ok(luma(heatColor(0, RAMP_DARK)) < luma(heatColor(1, RAMP_DARK)));
  });
});

describe("inkOn", () => {
  it("puts dark ink on a pale fill and light ink on a deep one", () => {
    assert.equal(inkOn("#fadec9"), "dark");
    assert.equal(inkOn("#7c3111"), "light");
  });
});

describe("clipLabel", () => {
  it("leaves a label that fits alone", () => {
    assert.equal(clipLabel("index.ts", 200), "index.ts");
  });

  it("ellipsises a label that does not", () => {
    const clipped = clipLabel("a-very-long-file-name.ts", 60);
    assert.ok(clipped.endsWith("…"));
    assert.ok(clipped.length < "a-very-long-file-name.ts".length);
  });

  it("gives up rather than emit a lone ellipsis", () => {
    assert.equal(clipLabel("index.ts", 6), "");
  });
});

/**
 * `report.ts` ships `SHARED_SOURCE` — the literal text of these functions — into
 * the browser. Nothing at build time checks that the text still evaluates, or
 * that it still behaves like the copy Node imported, so check both here.
 */
describe("SHARED_SOURCE", () => {
  const evaluate = () => {
    const factory = new Function(
      `${SHARED_SOURCE}\nreturn { buildTree, nodeHotspot, squarify, heatColor, inkOn, clipLabel };`,
    );
    return factory() as {
      buildTree: typeof buildTree;
      nodeHotspot: typeof nodeHotspot;
      squarify: typeof squarify;
      heatColor: typeof heatColor;
      inkOn: typeof inkOn;
      clipLabel: typeof clipLabel;
    };
  };

  it("evaluates as plain JavaScript", () => {
    assert.doesNotThrow(evaluate, "the embedded source must run in a browser as-is");
  });

  it("carries no TypeScript syntax that a browser would reject", () => {
    assert.equal(/\binterface\b|\bimplements\b|: (?:number|string|boolean)\b/.test(SHARED_SOURCE), false);
    assert.equal(SHARED_SOURCE.includes("!."), false, "non-null assertions must be erased");
  });

  it("references nothing from module scope", () => {
    // A stray reference to an import or a module const would throw here, since
    // new Function() only sees globals.
    const shared = evaluate();
    assert.doesNotThrow(() => shared.squarify([{ value: 5 } as TreeNode], { x: 0, y: 0, w: 10, h: 10 }));
  });

  it("lays out identically to the copy Node imported", () => {
    const shared = evaluate();
    // A deterministic spread of sizes, no RNG, so a failure is reproducible.
    const sizes = Array.from({ length: 30 }, (_, i) => ((i * 37) % 97) + 1);
    const nodes = sizes.map((value) => ({ name: "n", path: "", value, weight: 0, files: 1 }) as TreeNode);
    const rect = { x: 3, y: 7, w: 640, h: 410 };
    assert.deepEqual(shared.squarify(nodes, rect), squarify(nodes, rect));
  });

  it("builds an identical tree to the copy Node imported", () => {
    const shared = evaluate();
    const files = [
      fileAt("src/deep/a.ts", 120, 80),
      fileAt("src/deep/b.ts", 30, 12),
      fileAt("src/c.ts", 75, 44),
      fileAt("readme/d.ts", 10, 3),
    ];
    assert.deepEqual(shared.buildTree(files, "repo"), buildTree(files, "repo"));
  });

  it("colours identically to the copy Node imported", () => {
    const shared = evaluate();
    for (let i = 0; i <= 20; i++) {
      assert.equal(shared.heatColor(i / 20, RAMP_DARK), heatColor(i / 20, RAMP_DARK));
    }
    assert.equal(shared.inkOn("#e57f45"), inkOn("#e57f45"));
    assert.equal(shared.clipLabel("some/file.ts", 44), clipLabel("some/file.ts", 44));
  });
});
