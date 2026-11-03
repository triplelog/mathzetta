// Structure keys.
//
// The core idea of the library: at any node, collapse operator subtrees into
// opaque operands in every possible combination. Each combination is a "key"
// describing a shape, and rules are indexed by exactly that shape.
//
//   3 4 5 6 - * +   ( 3 + 4*(5-6) )
//     -> "_ _ +"            3 + <4*(5-6)>
//     -> "_ _ _ * +"        3 + <4>*<5-6>
//     -> "_ _ _ _ - * +"    the whole shape
//
// Looking a rule up is then a single Map hit per key. The operands are
// deliberately anonymous here; anything a rule needs to know about them lives
// in its requirements instead.
//
// The number of collapsings grows brutally with depth (2, 5, 26, 677, 458330
// for a balanced binary tree), so generation is always capped at the depth of
// the deepest pattern in the ruleset. With rules of depth <= 3 that is at most
// 26 keys per node.

import { OP } from './expr.js';

export const SLOT = '_';

/** Hard ceiling per node; only reachable with a pathological maxDepth. */
export const MAX_COLLAPSINGS = 4096;

const cache = new WeakMap();

/**
 * All ways of collapsing `node`, as `{ key, slots }` where `slots` holds the
 * subtrees that landed in each `_` position, left to right.
 *
 * Always includes the fully collapsed `{ key: '_', slots: [node] }`, which is
 * what makes a parent able to treat this whole subtree as one operand.
 */
export function collapsings(node, maxDepth) {
  let byDepth = cache.get(node);
  if (!byDepth) cache.set(node, (byDepth = new Map()));
  const hit = byDepth.get(maxDepth);
  if (hit) return hit;
  const out = compute(node, maxDepth);
  byDepth.set(maxDepth, out);
  return out;
}

function compute(node, maxDepth) {
  const collapsed = { key: SLOT, slots: [node] };
  if (node.type !== OP || maxDepth <= 0) return [collapsed];

  const childSets = node.args.map((a) => collapsings(a, maxDepth - 1));
  const out = [collapsed];

  // Odometer over the per-child collapsing lists.
  const counter = new Array(childSets.length).fill(0);
  for (;;) {
    let key = '';
    const slots = [];
    for (let i = 0; i < childSets.length; i++) {
      const pick = childSets[i][counter[i]];
      key += pick.key + ' ';
      for (const s of pick.slots) slots.push(s);
    }
    out.push({ key: key + node.op, slots });
    if (out.length >= MAX_COLLAPSINGS) break;

    let i = childSets.length - 1;
    for (; i >= 0; i--) {
      if (++counter[i] < childSets[i].length) break;
      counter[i] = 0;
    }
    if (i < 0) break;
  }
  return out;
}

/**
 * Collapsings usable for rule lookup: everything except the fully collapsed
 * form, which carries no structure to match against.
 */
export function keysAt(node, maxDepth) {
  const all = collapsings(node, maxDepth);
  const out = [];
  for (const c of all) if (c.key !== SLOT) out.push(c);
  return out;
}

/** The full-depth skeleton of a tree — what a rule pattern is indexed under. */
export function shapeKey(node) {
  if (node.type !== OP) return SLOT;
  return `${node.args.map(shapeKey).join(' ')} ${node.op}`;
}

/** Leaves left to right; these line up 1:1 with the `_`s in shapeKey. */
export function shapeLeaves(node, out = []) {
  if (node.type !== OP) out.push(node);
  else for (const a of node.args) shapeLeaves(a, out);
  return out;
}
