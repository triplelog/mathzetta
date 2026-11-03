// Matching: turn a node into the list of rules that fire on it.
//
// Cost per node is one Map lookup per collapsing (at most 26 for depth-3
// rulesets), and predicates only ever run on candidates whose shape already
// matched exactly.

import { walk, isNum } from './expr.js';
import { keysAt } from './keys.js';

/** Bind a key's `_` positions to a binding's slot spec, or null on conflict. */
function bind(binding, slots) {
  const out = Object.create(null);
  const specs = binding.slots;
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const node = slots[i];
    if (spec.literal !== undefined) {
      if (!isNum(node) || node.value !== spec.literal) return null;
      continue;
    }
    if (spec.token !== undefined) {
      if (node.s !== spec.token) return null;
      continue;
    }
    const prev = out[spec.name];
    // A slot name used twice in a pattern means "the same subtree twice".
    if (prev !== undefined) {
      if (prev.s !== node.s) return null;
    } else {
      out[spec.name] = node;
    }
  }
  return out;
}

function checkRequirements(rule, bound) {
  for (const w of rule.when) {
    const node = bound[w.slot];
    if (node === undefined) return false;
    if (!w.fn(node, ...w.args)) return false;
  }
  for (const r of rule.require) {
    const args = r.args.map((a) => (bound[a] !== undefined ? bound[a] : a));
    if (!r.fn(...args)) return false;
  }
  return true;
}

/** Which rule wins *at a single site*: most specific, then highest priority. */
export function rank(a, b) {
  return b.rule.priority - a.rule.priority || b.rule.depth - a.rule.depth;
}

/**
 * Every rule that applies at this exact node, best candidate first.
 * @returns {Array<{rule, binding, key, bound}>}
 */
export function matchNode(node, ruleset) {
  const out = [];
  if (ruleset.maxDepth === 0) return out;
  for (const { key, slots } of keysAt(node, ruleset.maxDepth)) {
    const candidates = ruleset.candidates(key);
    if (!candidates) continue;
    for (const binding of candidates) {
      const bound = bind(binding, slots);
      if (!bound) continue;
      if (!checkRequirements(binding.rule, bound)) continue;
      out.push({ rule: binding.rule, binding, key, bound });
    }
  }
  return out.sort(rank);
}

/**
 * Every match anywhere in the tree, tagged with its path.
 *
 * Sites come out in traversal order — 'post' for innermost-first, 'pre' for
 * outermost-first — and matches within a site are ranked. Callers must not
 * re-sort globally, or `order` stops meaning anything.
 */
export function matchAll(root, ruleset, { order = 'post' } = {}) {
  const out = [];
  for (const { node, path } of walk(root, order)) {
    for (const m of matchNode(node, ruleset)) {
      out.push({ ...m, node, path });
    }
  }
  return out;
}
