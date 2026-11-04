// Integration: the rules in rules/cas/integrals.yaml, and three strategies for
// when no rule fits an integral:
//   expand          ∫ (x + 1)² dx → ∫ x² + 2x + 1 dx
//   substitution    ∫ f(ax + b) dx = (1/a) F(ax + b), F from the rules for ∫ f(u) du
//   by parts        ∫ p·e^x, p·sin x, p·cos x (p a polynomial): p·V − ∫ p′·V;
//                   ∫ p·ln x, p·arctan x: the other way round
// A definite integral is the antiderivative's change between the limits.

import { op, sym, isOp, walk, replaceAt, exactNum } from '../expr.js';
import { approximate } from './approx.js';
import { N, isN, add, mul, neg, div, canon, display, normal, factorsOf, freeSymbols, powFactor, Q, CasError } from './form.js';
import { expand, coefficients, mentions, together, factorForm, rationalCoefficients, fromCoefficients, polyDivide, polyDerivative, rationalRoots, evaluateAt } from './poly.js';
import { rewrite } from './rules.js';
import { substitute } from './solve.js';

const MAX_DEPTH = 6;
const isOpenIntegral = (n) => isOp(n) && n.op === 'int' && n.args.length === 2;
const integral = (f, v) => op('int', [f, typeof v === 'string' ? sym(v) : v]);

/**
 * ∫ f dv. cas: { set, format, step(...), differentiate(node, v) → node }.
 * @returns {{ node, steps }} the antiderivative (no + C)
 */
export function antiderivative(cas, f, v, depth = 0) {
  if (depth > MAX_DEPTH) throw new CasError('integration went too deep');
  const steps = [];
  const set = cas.set.view('integrate');
  // the integrand simplified first (sin² + cos² is 1)
  const tidy = rewrite(f, cas.set.view('simplify'), { format: cas.format });
  steps.push(...tidy.steps);
  let current = normal(integral(tidy.node, v));
  for (let round = 0; round < 40; round++) {
    const r = rewrite(current, set, { format: cas.format });
    steps.push(...r.steps);
    current = r.node;
    const open = walk(current, 'pre').find(({ node }) => isOpenIntegral(node));
    if (!open) return { node: current, steps };
    const done = strategy(cas, open.node, depth);
    if (!done) {
      throw new CasError(`no rule for ∫ ${cas.format(open.node.args[0])} d${open.node.args[1].token}`);
    }
    steps.push(...done.steps);
    current = normal(replaceAt(current, open.path, done.node));
  }
  throw new CasError('integration did not finish');
}

function strategy(cas, node, depth) {
  const [g, w] = node.args;
  const v = w.token;
  const x = canon(g);
  // 0. a number hidden in a denominator, 1/(2x² + 2): out of the integral (the rules see only u/c and c·u)
  const content = numberInside(x, v);
  if (content) {
    const next = op('*', [display(N(content.c)), integral(display(content.rest), w)]);
    return { node: next, steps: [cas.step('integrate.constant', 'Take the number out', ['split'], node, next, { c: display(N(content.c)) })] };
  }
  // 1. multiply out
  const expanded = expand(x);
  if (display(expanded).s !== g.s && expanded.k === 'add') {
    const next = integral(display(expanded), w);
    return { node: next, steps: [cas.step('integrate.expand', 'Multiply out', ['expand'], node, next, {})] };
  }
  // 2. a linear substitution
  const linear = linearInside(g, v);
  if (linear) {
    const u = v === 'u' ? 't' : 'u';
    const inner = replaceAll(g, linear.node, sym(u));
    if (!freeSymbols(inner).has(v)) {
      const sub = antiderivative(cas, normal(inner), u, depth + 1);
      const back = normal(substitute(sub.node, u, linear.node));
      const result = display(div(canon(back), linear.a));
      return {
        node: result,
        steps: [
          cas.step('integrate.substitute', 'Substitute', ['substitute'], node, normal(integral(inner, u)), { u: sym(u), inside: linear.node, a: display(linear.a), v }),
          ...sub.steps,
          cas.step('integrate.back', 'Substitute back', ['substitute'], sub.node, result, { u: sym(u), inside: linear.node }),
        ],
      };
    }
  }
  // 3. a fraction of polynomials: divide, then partial fractions
  const fraction = rationalFunction(cas, node, x, v);
  if (fraction) return fraction;
  // 4. by parts
  return byParts(cas, node, x, v, depth);
}

/**
 * p/q with exact coefficients: when deg p ≥ deg q, long division (x²/(x² + 1) = 1 - 1/(x² + 1));
 * when q has distinct rational roots, partial fractions (1/(x² - 1) = ½/(x - 1) - ½/(x + 1)).
 */
function rationalFunction(cas, node, x, v) {
  const { num, den } = together(x);
  if (!mentions(den, v)) return null;
  const p = rationalCoefficients(coefficients(num, v));
  const q = rationalCoefficients(coefficients(den, v));
  if (!p || !q || q.length < 2) return null;
  const variable = canon(sym(v));
  const poly = (cs) => fromCoefficients(cs, v);
  if (p.length >= q.length) {
    const { q: quotient, r } = polyDivide(p, q);
    const next = integral(display(add([poly(quotient), div(poly(r), poly(q))])), sym(v));
    return { node: next, steps: [cas.step('integrate.divide', 'Divide the polynomials', ['divide'], node, next, {})] };
  }
  const { roots, rest } = rationalRoots(q);
  const distinct = new Set(roots.map(String)).size === roots.length;
  if (!roots.length || !distinct || rest.length !== 1) return null;
  // A_i = p(r_i) / q′(r_i)
  const dq = polyDerivative(q);
  const terms = roots.map((r) => div(N(evaluateAt(p, r).div(evaluateAt(dq, r))), add([variable, N(r.neg())])));
  const next = integral(display(add(terms)), sym(v));
  return { node: next, steps: [cas.step('integrate.partial-fractions', 'Partial fractions', ['partial-fractions'], node, next, {})] };
}

/** x = c · rest with c a number that isn't 1, counting the number inside a sum below (1/(2x + 2) = ½ · 1/(x + 1)). */
function numberInside(x, v) {
  const { num, den } = together(x);
  const top = factorForm(num);
  const bottom = factorForm(den);
  const c = top.coef.div(bottom.coef);
  if (c.isOne || !mentions(x, v)) return null;
  const rest = mul([...top.factors.map((f) => powFactor(f.base, f.exp)), ...bottom.factors.map((f) => powFactor(f.base, neg(f.exp)))]);
  return { c, rest };
}

/** The linear expression ax + b (not x itself) that every x in g sits inside, or null. */
function linearInside(g, v) {
  const candidates = new Map();
  for (const { node } of walk(g, 'pre')) {
    if (!isOp(node)) continue;
    // inside a function, a power (base or exponent), a root, or a denominator
    const parts = node.op === '^' ? node.args : node.op === '/' ? [node.args[1]] : node.op === 'der' || node.op === 'int' ? []
      : node.args.length === 1 || node.op === 'root' ? [node.args[node.args.length - 1]] : [];
    for (const p of parts) {
      if (p.type === 'sym' || !freeSymbols(p).has(v)) continue;
      const cs = coefficients(canon(p), v);
      if (!cs || Math.max(...cs.keys()) !== 1) continue;
      const a = cs.get(1);
      if (mentions(a, v) || (isN(a) && a.q.isZero)) continue;
      candidates.set(p.s, { node: p, a });
    }
  }
  for (const c of candidates.values()) {
    const left = replaceAll(g, c.node, sym('§'));
    if (!freeSymbols(left).has(v)) return c;
  }
  return null;
}

function replaceAll(node, target, by) {
  if (node.s === target.s) return by;
  if (!isOp(node)) return node;
  return op(node.op, node.args.map((a) => replaceAll(a, target, by)));
}

const isPolynomial = (x, v) => {
  const cs = coefficients(x, v);
  return Boolean(cs) && [...cs.values()].every((c) => !mentions(c, v)) && Math.max(...cs.keys()) >= 1;
};

function byParts(cas, node, x, v, depth) {
  if (depth >= MAX_DEPTH) return null;
  const fs = factorsOf(x);
  const poly = fs.filter((f) => isPolynomial(f, v) || !mentions(f, v));
  const rest = fs.filter((f) => !poly.includes(f));
  if (rest.length !== 1) return null;
  const p = mul(poly);
  const h = rest[0];
  if (!mentions(p, v)) return null;
  const hNode = display(h);
  const kind = isOp(hNode) ? hNode.op : '';
  let u;
  let dv;
  if (kind === 'ln' || kind === 'arctan' || kind === 'arcsin') {
    u = h;
    dv = p;
  } else {
    u = p;
    dv = h;
  }
  let V;
  try {
    V = antiderivative(cas, display(dv), v, depth + 1);
  } catch {
    return null;
  }
  const du = canon(cas.differentiate(display(u), v));
  const uV = mul([u, canon(V.node)]);
  const remaining = integral(display(mul([du, canon(V.node)])), sym(v));
  const next = normal(op('-', [display(uV), remaining]));
  return {
    node: next,
    steps: [cas.step('integrate.parts', 'Integration by parts', ['parts'], node, next, { u: display(u), dv: display(dv), V: V.node, du: display(du), v })],
  };
}

/**
 * ∫ from a to b: F(b) − F(a). The integrand f is sampled between numeric limits
 * first: F(b) − F(a) is wrong across a point where f has no value (∫ 1/x from -1 to 1).
 */
export function definite(cas, F, v, a, b, f) {
  for (const bound of [a, b]) {
    if (freeSymbols(bound).has('∞') || /∞|infinity/.test(bound.s)) throw new CasError('integrals to infinity need limits, which this CAS does not do yet');
  }
  if (f && !freeSymbols(a).size && !freeSymbols(b).size) {
    const lo = approximate(a, { digits: 20 }).number;
    const hi = approximate(b, { digits: 20 }).number;
    const others = [...freeSymbols(f)].filter((s) => s !== v);
    // where a denominator is zero (1/x at 0, tan x at π/2): found by solving, so a pole between
    // the limits is caught wherever it falls; sampling below catches the rest (ln of a negative)
    if (!others.length) {
      const [low, high] = lo <= hi ? [lo, hi] : [hi, lo];
      for (const d of denominators(f, v)) {
        let roots = [];
        try { roots = cas.solve(op('=', [d, exactNum('0')]), v, { steps: false }).solutions; } catch { continue; }
        for (const root of roots) {
          const r = approximate(root, { digits: 20 });
          if (!Number.isFinite(r.number) || r.im || r.number < low || r.number > high) continue;
          if (r.number > low && r.number < high) {
            throw new CasError(`the integrand has no value at ${v} = ${cas.format(root)}, between the limits, so F(b) - F(a) would be wrong`);
          }
          // at a limit the integral may still converge (∫ 1/√x from 0 to 1 = 2): only if F has a value there
          let value = NaN;
          try { value = approximate(normal(substitute(F, v, root)), { digits: 15 }).number; } catch { /* no value */ }
          if (!Number.isFinite(value)) {
            throw new CasError(`the integral diverges at ${v} = ${cas.format(root)}: F has no value at that limit`);
          }
        }
      }
    }
    for (let i = 0; !others.length && i <= 64; i++) {
      const t = lo + ((hi - lo) * (i + 0.5)) / 65;
      try {
        const y = approximate(substitute(f, v, exactNum(t.toFixed(15))), { digits: 15 }).number;
        if (!Number.isFinite(y)) throw new CasError('not finite');
      } catch (error) {
        throw new CasError(`the integrand has no value at ${v} = ${t.toPrecision(6)}, between the limits, so F(b) - F(a) would be wrong`);
      }
    }
  }
  const at = (bound) => normal(substitute(F, v, bound));
  const value = normal(op('-', [at(b), at(a)]));
  const shown = op('-', [at(b), at(a)]);
  return { value, step: cas.step('integrate.evaluate', 'Between the limits', ['evaluate'], F, shown, { a, b, F, v }) };
}

/** The parts of f that divide (a denominator, a negative power's base, tan's cos …) and mention v. */
function denominators(f, v) {
  const out = [];
  const POLES = { tan: 'cos', sec: 'cos', csc: 'sin', cot: 'sin' };
  walk(f, 'pre').forEach(({ node: n }) => {
    if (!isOp(n)) return;
    let d = null;
    if (n.op === '/') d = n.args[1];
    else if (n.op === '^' && n.args[1].type === 'num' && n.args[1].value < 0) d = n.args[0];
    else if (n.op === '^' && isOp(n.args[1]) && n.args[1].op === 'neg') d = n.args[0];
    else if (POLES[n.op]) d = op(POLES[n.op], [n.args[0]]);
    if (d && freeSymbols(d).has(v) && !out.some((x) => x.s === d.s)) out.push(d);
  });
  return out;
}

export { N, Q, add, neg };
