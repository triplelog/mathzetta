// Building the replacement expression for a match.

import { op, num, replaceAt, isOp, isNum } from './expr.js';
import { getOperator } from './ops.js';

/** Fill an output template's slots with the matched subtrees. */
export function instantiate(template, bound) {
  switch (template.kind) {
    case 'slot': {
      const node = bound[template.name];
      if (!node) throw new Error(`output references unbound slot "${template.name}"`);
      return node;
    }
    case 'const':
      return template.node;
    case 'op':
      return op(template.op, template.args.map((a) => instantiate(a, bound)));
    default:
      throw new Error(`bad output template: ${JSON.stringify(template)}`);
  }
}

/**
 * Collapse numeric subtrees bottom-up. Operators whose `fold` returns null
 * (1/3, sqrt(2), sin(1)) are left exactly as they are.
 */
export function foldNumeric(node) {
  if (!isOp(node)) return node;
  const args = node.args.map(foldNumeric);
  const changed = args.some((a, i) => a !== node.args[i]);
  const next = changed ? op(node.op, args) : node;
  const def = getOperator(next.op);
  if (!def || !def.fold || !next.args.every(isNum)) return next;
  const value = def.fold(...next.args.map((a) => a.value));
  return value === null || value === undefined || !Number.isFinite(value) ? next : num(value);
}

/** Fill `{slot}` and `{result}` placeholders in a rule's explanation text. */
export function renderExplanation(rule, bound, result) {
  if (!rule.explain) return '';
  return rule.explain.replace(/\{(\w+)\}/g, (whole, name) => {
    if (name === 'result') return result ? result.s : whole;
    const node = bound[name];
    return node ? node.s : whole;
  });
}

/** The expression this match produces, without touching the surrounding tree. */
export function rewriteOf(match) {
  const built = instantiate(match.rule.outputTemplate, match.bound);
  return match.rule.fold ? foldNumeric(built) : built;
}

/**
 * Apply a match found by matchAll (it carries a `path`).
 * @returns {{expr, before, after, rule, path, explanation}}
 */
export function applyMatch(root, match) {
  const after = rewriteOf(match);
  return {
    expr: replaceAt(root, match.path, after),
    before: match.node,
    after,
    rule: match.rule,
    path: match.path,
    explanation: renderExplanation(match.rule, match.bound, after),
  };
}
