import type { FileMetrics } from "./types.js";

/**
 * Treemap layout and colour, shared by both renderers.
 *
 * The HTML report needs this in the browser (it re-lays-out on every drill-down)
 * and the `--svg` renderer needs it in Node. Rather than keep two copies that
 * drift, every function here is written to be *self-contained* — no imports, no
 * references to module scope — so `report.ts` can embed the real source with
 * `Function.prototype.toString()` and the browser runs the exact same code.
 *
 * That constraint is why helpers are inlined instead of factored out. Breaking
 * it does not fail loudly at build time, so `test/treemap.test.ts` asserts that
 * the embedded source still evaluates and agrees with the Node copy.
 */

export interface TreeNode {
  name: string;
  path: string;
  /** Size of the rectangle: lines of code. */
  value: number;
  /** value × hotspot, summed up the tree, so folders get a weighted mean. */
  weight: number;
  files: number;
  children?: TreeNode[];
  file?: FileMetrics;
}

export interface Placed {
  node: TreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Heat ramp for the light surface: near-zero → maximum. */
export const RAMP_LIGHT = ["#fadec9", "#f5c4a0", "#eea474", "#e57f45", "#d15f26", "#a9451a", "#7c3111"];
/** The same hue, stepped for the dark surface, so near-zero recedes there too. */
export const RAMP_DARK = ["#4e200e", "#7a3417", "#a4491f", "#c85f2a", "#e2793f", "#f09a63", "#f9b98e"];

/* -------------------------------------------------------------------------- */
/* Self-contained from here down — see the note at the top of the file.        */
/* -------------------------------------------------------------------------- */

/** Group flat file metrics into a directory tree, sized and weighted. */
export function buildTree(files: FileMetrics[], repoName: string): TreeNode {
  var root: TreeNode = { name: repoName, path: "", children: [], value: 0, weight: 0, files: 0 };

  for (var f = 0; f < files.length; f++) {
    var file = files[f]!;
    var parts = file.path.split("/");
    var node = root;
    for (var i = 0; i < parts.length - 1; i++) {
      var name = parts[i]!;
      var next: TreeNode | null = null;
      var kids = node.children!;
      for (var j = 0; j < kids.length; j++) {
        if (kids[j]!.name === name && kids[j]!.children) {
          next = kids[j]!;
          break;
        }
      }
      if (!next) {
        next = {
          name: name,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
          value: 0,
          weight: 0,
          files: 0,
        };
        kids.push(next);
      }
      node = next;
    }
    node.children!.push({
      name: parts[parts.length - 1]!,
      path: file.path,
      value: Math.max(file.code, 1),
      weight: 0,
      files: 1,
      file: file,
    });
  }

  var roll = function (n: TreeNode): void {
    if (!n.children) {
      n.weight = n.file!.hotspot * n.value;
      return;
    }
    n.value = 0;
    n.weight = 0;
    n.files = 0;
    for (var k = 0; k < n.children.length; k++) {
      roll(n.children[k]!);
      n.value += n.children[k]!.value;
      n.weight += n.children[k]!.weight;
      n.files += n.children[k]!.files;
    }
    n.children.sort(function (a, b) {
      return b.value - a.value;
    });
  };
  roll(root);
  return root;
}

/** Value-weighted mean hotspot, so a folder reads as hot only if its bulk is. */
export function nodeHotspot(node: TreeNode): number {
  return node.value > 0 ? node.weight / node.value : 0;
}

/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk, 2000).
 *
 * Lays children into rows along the shorter edge, extending a row only while
 * doing so improves the worst aspect ratio in it. The result avoids the slivers
 * a naive slice-and-dice produces, which matters because a 2px-wide rectangle
 * is unhoverable and unreadable.
 */
export function squarify(nodes: TreeNode[], rect: Rect): Placed[] {
  var out: Placed[] = [];

  var items = [];
  var total = 0;
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i]!.value > 0) {
      items.push(nodes[i]!);
      total += nodes[i]!.value;
    }
  }
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;

  // Worst aspect ratio in a row, given its total area and the edge it sits on.
  var worst = function (row: { area: number }[], area: number, side: number): number {
    var lo = Infinity;
    var hi = 0;
    for (var k = 0; k < row.length; k++) {
      if (row[k]!.area < lo) lo = row[k]!.area;
      if (row[k]!.area > hi) hi = row[k]!.area;
    }
    var s2 = side * side;
    var a2 = area * area;
    return Math.max((s2 * hi) / a2, a2 / (s2 * lo));
  };

  var factor = (rect.w * rect.h) / total;
  var queue = [];
  for (var q = 0; q < items.length; q++) {
    queue.push({ node: items[q]!, area: items[q]!.value * factor });
  }

  var x = rect.x;
  var y = rect.y;
  var w = rect.w;
  var h = rect.h;

  while (queue.length) {
    var side = Math.min(w, h);
    if (side <= 0) break;

    var row = [];
    var rowArea = 0;
    while (queue.length) {
      var candidate = rowArea + queue[0]!.area;
      if (row.length === 0 || worst(row, rowArea, side) >= worst(row.concat([queue[0]!]), candidate, side)) {
        rowArea = candidate;
        row.push(queue.shift()!);
      } else break;
    }

    var thick = rowArea / side;
    var offset = 0;
    for (var r = 0; r < row.length; r++) {
      var len = row[r]!.area / thick;
      if (w >= h) out.push({ node: row[r]!.node, x: x, y: y + offset, w: thick, h: len });
      else out.push({ node: row[r]!.node, x: x + offset, y: y, w: len, h: thick });
      offset += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
  }
  return out;
}

/** Sample the ramp at t (0-1), interpolating between its steps. */
export function heatColor(t: number, ramp: string[]): string {
  var channels = function (color: string): number[] {
    return [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ];
  };
  var clamped = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  var index = Math.floor(clamped);
  if (index >= ramp.length - 1) return ramp[ramp.length - 1]!;

  var a = channels(ramp[index]!);
  var b = channels(ramp[index + 1]!);
  var f = clamped - index;
  var out = "#";
  for (var c = 0; c < 3; c++) {
    var v = Math.round(a[c]! + (b[c]! - a[c]!) * f).toString(16);
    out += v.length < 2 ? "0" + v : v;
  }
  return out;
}

/**
 * Which ink to put *on* this fill — "dark" for near-black ink, "light" for
 * near-white. A pale fill takes dark ink; a deep fill takes light ink.
 *
 * The obvious inversion here is a bug that shipped once already: reading the
 * name as "how light is this colour" rather than "what goes on top of it" puts
 * white labels on pale rectangles.
 */
export function inkOn(color: string): "dark" | "light" {
  var r = parseInt(color.slice(1, 3), 16);
  var g = parseInt(color.slice(3, 5), 16);
  var b = parseInt(color.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.58 ? "dark" : "light";
}

/** Trim a label to what fits: ~6.1px per character at 11px in the system sans. */
export function clipLabel(text: string, width: number): string {
  var max = Math.floor(width / 6.1);
  if (max < 2) return "";
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + "…";
}

/** The exact source of every shared function, for embedding in the browser. */
export const SHARED_SOURCE = [
  buildTree,
  nodeHotspot,
  squarify,
  heatColor,
  inkOn,
  clipLabel,
]
  .map((fn) => String(fn))
  .join("\n");
