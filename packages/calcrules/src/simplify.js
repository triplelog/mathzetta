// Driving rules to a fixed point.
//
// Rewrite systems built from user-supplied rules are not confluent and not
// guaranteed to terminate — commutativity and distribution will happily
// ping-pong forever. Two guards handle that: a step cap, and a visited set of
// canonical expression strings that stops the moment a shape repeats.

import { parse } from './expr.js';
import { matchAll, matchNode } from './match.js';
import { applyMatch, rewriteOf, renderExplanation } from './apply.js';

const asExpr = (e) => (typeof e === 'string' ? parse(e) : e);

/**
 * Everything that could be applied right now, each with the expression it
 * would produce. This is what the playground lists. Ordered by site, then by
 * rule preference within a site.
 */
export function findMatches(expr, ruleset, { order = 'post' } = {}) {
  const root = asExpr(expr);
  const matches = matchAll(root, ruleset, { order });
  // A commutative rule registers several bindings, and more than one can fire
  // on the same node with the same outcome. Offering "2x + 3x -> 5x" twice is
  // just noise, so collapse matches that agree on site, rule and result.
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const after = rewriteOf(m);
    // a rule that matched but changes nothing (fold: true on 1/3, which has no exact decimal) isn't on offer
    if (after.s === m.node.s) continue;
    const sig = `${m.path.join('.')}|${m.rule.id}|${after.s}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(describe(root, m, after));
  }
  return out;
}

function describe(root, m, after) {
  const out = { ...m, after, explanation: renderExplanation(m.rule, m.bound, after) };
  // Splicing `after` back into the tree is the expensive part and a listing
  // usually never needs it, so build it only when something asks.
  let result;
  Object.defineProperty(out, 'result', {
    enumerable: true,
    get() {
      if (!result) result = m.path.length === 0 ? after : applyMatch(root, m).expr;
      return result;
    },
  });
  return out;
}

/** Matches at one specific node, ranked. */
export function matchesAt(node, ruleset) {
  return matchNode(node, ruleset);
}

/**
 * Apply exactly one rule.
 * @param {object} opts.order   'post' = innermost first, 'pre' = outermost
 * @param {(matches) => object|undefined} [opts.choose] pick a specific match
 * @param {Set<string>} [opts.avoid] expression strings already visited
 */
export function step(expr, ruleset, { order = 'post', choose, avoid } = {}) {
  const root = asExpr(expr);
  const matches = matchAll(root, ruleset, { order });
  if (matches.length === 0) return null;

  if (choose) {
    const picked = choose(matches);
    return picked ? applyMatch(root, picked) : null;
  }
  for (const m of matches) {
    const applied = applyMatch(root, m);
    // Skip rules that rewrite to the same thing, or back somewhere we've been.
    if (applied.expr.s === root.s) continue;
    if (avoid && avoid.has(applied.expr.s)) continue;
    return applied;
  }
  return null;
}

/**
 * Rewrite until nothing applies.
 * @returns {{expr, steps, stopped: 'fixpoint'|'cycle'|'maxSteps', start}}
 */
export function simplify(expr, ruleset, { maxSteps = 100, order = 'post' } = {}) {
  const start = asExpr(expr);
  let current = start;
  const seen = new Set([current.s]);
  const steps = [];
  let stopped = 'fixpoint';

  for (let i = 0; i < maxSteps; i++) {
    const applied = step(current, ruleset, { order, avoid: seen });
    if (!applied) {
      // Distinguish "nothing applies" from "everything that applies leads back somewhere we've been";
      // a match that rewrites to the same thing (fold: true on 1/3) is no rewrite at all.
      const root = current;
      stopped = matchAll(current, ruleset, { order }).some((m) => applyMatch(root, m).expr.s !== root.s) ? 'cycle' : 'fixpoint';
      break;
    }
    steps.push({
      ruleId: applied.rule.id,
      ruleName: applied.rule.name,
      path: applied.path,
      from: current.s,
      to: applied.expr.s,
      before: applied.before.s,
      after: applied.after.s,
      explanation: applied.explanation,
    });
    current = applied.expr;
    seen.add(current.s);
  }

  // Ran the whole budget: say so only if work actually remains.
  if (steps.length === maxSteps && step(current, ruleset, { order, avoid: seen })) {
    stopped = 'maxSteps';
  }

  return { expr: current, start, steps, stopped };
}

/** Convenience: postfix in, postfix out. */
export function simplifyText(text, ruleset, opts) {
  return simplify(parse(text), ruleset, opts).expr.s;
}
