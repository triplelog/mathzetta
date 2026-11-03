// Rules in the CAS: loading rule files, the predicates rules use, and the
// driver that rewrites with them.
//
// A rule file is the usual calcrules YAML (see rules/cas/*.yaml), plus two
// optional sections that need no code:
//
//   operators:                  new functions, so patterns can use them
//     - { symbol: sinc, arity: 1 }
//   messages:                   the wording of the CAS's own steps (solve, factor …)
//     solve.move: "Move every term to the left side."
//
// Rules see expressions in the normal form as drawn (form.js): x/2, 2x - 3, -x,
// √x, ∛x (3 x root), π/6 (=pi 6 /). A word in a pattern is a slot; a fixed
// symbol is written =pi, =e. Literal parts of a pattern are put in normal form
// when the rule is loaded, so `=pi 2 * 3 / sin` and `2 =pi * 3 / sin` are one rule.

import { RuleSet } from '../ruleset.js';
import { parseYaml } from '../yaml.js';
import { definePredicate, getPredicate } from '../predicates.js';
import { defineOperator, isOperator, VARIADIC } from '../ops.js';
import { parse, op, sym, replaceAt, walk, isOp } from '../expr.js';
import { matchAll, matchNode } from '../match.js';
import { instantiate } from '../apply.js';
import { canon, display, normal, add, mul, termsOf, factorsOf, freeSymbols, CONSTANTS, settings, complexParts } from './form.js';
import { fromToken } from './rational.js';
import { approximate } from './approx.js';

// ---- the variable being solved for / differentiated by ---------------------------------

/** Set while a rule mode runs that is about one variable (solve's isolate). */
export const context = { variable: null };

const mentions = (node, v) => v !== null && freeSymbols(node).has(v);

// ---- predicates ---------------------------------------------------------------------------

/** An exact number as the normal form draws it: 3, -2, 1 2 / . */
export function rationalOf(node) {
  if (node.type === 'num') return fromToken(node.token);
  if (isOp(node) && node.op === '/' && node.args.every((a) => a.type === 'num')) {
    const n = fromToken(node.args[0].token);
    const d = fromToken(node.args[1].token);
    return n && d && !d.isZero ? n.div(d) : null;
  }
  return null;
}

const isConstantNode = (node) => freeSymbols(node).size === 0;

/** n = q·π for a rational q (0 is 0·π): q, else null. */
export function piRatio(node) {
  const x = canon(node);
  if (x.k === 'num') return x.q.isZero ? x.q : null;
  if (x.k === 'atom' && x.node.type === 'sym' && x.node.token === 'pi') return fromToken('1');
  if (x.k === 'mul' && x.fs.length === 1 && x.fs[0].b.k === 'atom' && x.fs[0].b.node.token === 'pi' && x.fs[0].e.k === 'num' && x.fs[0].e.q.isOne) return x.c;
  return null;
}

function compareAngle(node, k, test) {
  const q = piRatio(node);
  if (!q) return false;
  const [a, b = '1'] = String(k).split('/');
  return test(q.compare(fromToken(a).div(fromToken(b))));
}

/** The sign of a constant (1, -1, 0), from 30 digits; NaN for anything with unknowns or no value. */
function constantSign(node) {
  if (!isConstantNode(node)) return NaN;
  try {
    const { number } = approximate(node, { digits: 30 });
    return Math.sign(number);
  } catch {
    return NaN;
  }
}

/** Does the normal form start with a minus sign? (-x, -2x, -x + 1 → no: only a single term) */
function minusSign(node) {
  const x = canon(node);
  if (x.k === 'num') return x.q.sign < 0;
  return x.k === 'mul' && x.c.sign < 0;
}

function definePredicates() {
  if (getPredicate('hasVariable')) return;
  definePredicate('hasVariable', (n) => mentions(n, context.variable), 'mentions the variable being solved for');
  definePredicate('freeOfVariable', (n) => context.variable !== null && !mentions(n, context.variable), 'does not mention the variable being solved for');
  definePredicate('isRational', (n) => rationalOf(n) !== null, 'an exact number: 3, -2, 1/2');
  definePredicate('isWhole', (n) => rationalOf(n)?.isInteger ?? false, 'a whole number (any size)');
  definePredicate('isEvenWhole', (n) => { const q = rationalOf(n); return Boolean(q?.isInteger && q.n % 2n === 0n); }, 'an even whole number');
  definePredicate('isOddWhole', (n) => { const q = rationalOf(n); return Boolean(q?.isInteger && q.n % 2n !== 0n); }, 'an odd whole number');
  definePredicate('isPositiveRational', (n) => (rationalOf(n)?.sign ?? 0) > 0, 'an exact number above 0');
  definePredicate('isNegativeRational', (n) => (rationalOf(n)?.sign ?? 0) < 0, 'an exact number below 0');
  definePredicate('isConstant', isConstantNode, 'has no unknowns (numbers, π and e only)');
  definePredicate('notOne', (n) => { const q = rationalOf(n); return !q || !q.isOne; }, 'anything except the number 1');
  definePredicate('notMinusOne', (n) => { const q = rationalOf(n); return !q || !q.equals(fromToken('-1')); }, 'anything except the number -1');
  definePredicate('hasMinusSign', (n) => minusSign(n), 'written with a leading minus: -x, -2x, -π/6');
  // Angles that are rational multiples of π (0 counts): for reducing sin, cos, tan to the first quarter turn
  definePredicate('piMultipleAtLeast', (n, k) => compareAngle(n, k, (c) => c >= 0), 'a multiple of π, at least k·π');
  definePredicate('piMultipleAbove', (n, k) => compareAngle(n, k, (c) => c > 0), 'a multiple of π, above k·π');
  definePredicate('piMultipleBelow', (n, k) => compareAngle(n, k, (c) => c < 0), 'a multiple of π, below k·π');
  definePredicate('piMultipleAtMost', (n, k) => compareAngle(n, k, (c) => c <= 0), 'a multiple of π, at most k·π');
  definePredicate('isPositiveConstant', (n) => constantSign(n) > 0, 'no unknowns, and above 0 (e, π, √2, 3)');
  definePredicate('isNegativeConstant', (n) => constantSign(n) < 0, 'no unknowns, and below 0');
  definePredicate('hasImaginaryPart', (n) => {
    if (!settings.complex) return false;
    const p = complexParts(canon(n));
    return Boolean(p) && !(p.im.k === 'num' && p.im.q.isZero);
  }, 'complex mode: has a nonzero imaginary part (unknowns count as real)');
  definePredicate('isSymbolNode', (n) => n.type === 'sym' && !CONSTANTS.has(n.token), 'a single unknown such as x');
}

// ---- loading ------------------------------------------------------------------------------

/** Literal (slot-free) parts of a pattern, put in normal form so they match what the CAS draws. */
function normalizePattern(text) {
  const tree = parse(text);
  const isLiteral = (n) => (n.type === 'num' ? true : n.type === 'sym' ? n.token.startsWith('=') : n.args.every(isLiteral));
  const unmark = (n) => (n.type === 'sym' ? sym(n.token.slice(1)) : n.type === 'num' ? n : op(n.op, n.args.map(unmark)));
  const mark = (n) => (n.type === 'sym' ? sym(`=${n.token}`) : n.type === 'num' ? n : op(n.op, n.args.map(mark)));
  const fix = (n) => {
    if (n.type !== 'op') return n;
    if (isLiteral(n)) return mark(normal(unmark(n)));
    return op(n.op, n.args.map(fix));
  };
  return fix(tree).s;
}

/**
 * Rule documents (YAML text or parsed objects) → { rules: specs, messages }.
 * Operators they declare are registered first, so their patterns parse.
 */
export function readRuleDocs(docs) {
  definePredicates();
  const specs = [];
  const messages = {};
  for (const d of docs) {
    const doc = typeof d === 'string' ? parseYaml(d) : d;
    const list = Array.isArray(doc) ? doc : doc?.rules ?? [];
    for (const o of (Array.isArray(doc) ? [] : doc?.operators) ?? []) {
      if (!o?.symbol) throw new Error('an operator needs a symbol');
      if (!isOperator(o.symbol)) defineOperator({ symbol: String(o.symbol), arity: o.arity === 'any' ? VARIADIC : Number(o.arity), label: o.label });
    }
    Object.assign(messages, (Array.isArray(doc) ? null : doc?.messages) ?? {});
    for (const spec of list) specs.push(spec);
  }
  return { specs, messages };
}

/**
 * The rule set. A later spec with the id of an earlier one changes it: only the
 * fields it gives, so `{ id: sqrt-of-square, enabled: false }` turns a shipped
 * rule off and `{ id: sin-pi-6, explain: "…" }` rewords one.
 */
export function buildRuleSet(specs) {
  const byId = new Map();
  for (const spec of specs) {
    const id = spec.id ?? spec.name;
    if (!id) throw new Error(`a rule needs an id (pattern ${spec.pattern})`);
    byId.set(String(id), { ...(byId.get(String(id)) ?? {}), ...spec });
  }
  const prepared = [...byId.values()].map((spec) => {
    const out = { ...spec };
    try {
      if (out.pattern !== undefined) out.pattern = normalizePattern(String(out.pattern));
    } catch (error) {
      throw new Error(`rule "${out.id}": bad pattern "${out.pattern}": ${error.message}`);
    }
    // `step: hidden` is a tag the step filter knows
    if (out.step === 'hidden') out.tags = [...(out.tags ?? []), 'hidden'];
    return out;
  });
  return RuleSet.fromSpecs(prepared, { strict: true });
}

// ---- the driver ----------------------------------------------------------------------------

/** Fill {slot} and {result} in a rule's explanation, with each part as text. */
export function explain(rule, bound, result, format) {
  if (!rule.explain) return '';
  return rule.explain.replace(/\{(\w+)\}/g, (whole, name) => {
    if (name === 'result') return result ? format(result) : whole;
    return bound[name] ? format(bound[name]) : whole;
  }).trim();
}

const isSum = (n) => isOp(n) && (n.op === '+' || n.op === '-');
const isProduct = (n) => isOp(n) && (n.op === '*' || n.op === '/');

/**
 * Every rewrite available now, best first: matches at each node, and matches on
 * any two terms of a longer sum (or two factors of a product), so a rule for
 * sin²u + cos²u also fires inside sin²x + cos²x + 1.
 * Each candidate is { rule, bound, path, before, after, next } — next is the whole new expression.
 */
export function* candidates(root, set, { order = 'pre' } = {}) {
  for (const m of matchAll(root, set, { order })) {
    const after = instantiate(m.rule.outputTemplate, m.bound);
    yield { rule: m.rule, bound: m.bound, path: m.path, before: m.node, after, next: () => normal(replaceAt(root, m.path, after)) };
  }
  for (const { node, path } of walk(root, order)) {
    const sum = isSum(node);
    if (!sum && !isProduct(node)) continue;
    const parts = sum ? termsOf(canon(node)) : factorsOf(canon(node));
    if (parts.length < 3) continue;
    const join = sum ? add : mul;
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const pair = display(join([parts[i], parts[j]]));
        for (const m of matchNode(pair, set)) {
          const after = instantiate(m.rule.outputTemplate, m.bound);
          const rest = parts.filter((_, k) => k !== i && k !== j);
          yield {
            rule: m.rule, bound: m.bound, path, before: pair, after,
            next: () => normal(replaceAt(root, path, display(join([canon(after), ...rest])))),
          };
        }
      }
    }
  }
}

/**
 * Rewrite with one mode's rules until none applies (or it would go somewhere it has been).
 * @returns {{ node, steps }} steps: { id, name, tags, from, to, path, before, after, explanation }
 */
export function rewrite(start, set, { format, order = 'pre', maxSteps = 200, variable = null } = {}) {
  const saved = context.variable;
  context.variable = variable;
  try {
    let current = normal(start);
    const seen = new Set([current.s]);
    const steps = [];
    for (let i = 0; i < maxSteps; i++) {
      let moved = null;
      for (const c of candidates(current, set, { order })) {
        const next = c.next();
        if (next.s === current.s || seen.has(next.s)) continue;
        moved = { c, next };
        break;
      }
      if (!moved) break;
      const { c, next } = moved;
      steps.push({
        id: c.rule.id, name: c.rule.name, tags: c.rule.tags,
        from: current.s, to: next.s, path: c.path, before: c.before.s, after: c.after.s,
        explanation: explain(c.rule, c.bound, normal(c.after), format),
      });
      current = next;
      seen.add(current.s);
    }
    return { node: current, steps };
  } finally {
    context.variable = saved;
  }
}

/** One coded step (solve, factor …), worded by the messages table. */
export function codedStep(id, name, tags, from, to, message, values, format, path = []) {
  const explanation = (message ?? '').replace(/\{(\w+)\}/g, (whole, k) => {
    const v = values?.[k];
    if (v === undefined) return whole;
    return typeof v === 'string' ? v : format(v);
  });
  return { id, name, tags, from: from.s, to: to.s, path, before: from.s, after: to.s, explanation };
}

export { normal, mentions };
