// Solving equations for one unknown, and linear systems.
//
// The order of attack, for L = R:
//   1. everything with the unknown on the left, the rest on the right (move)
//   2. one term with the unknown: divide by its coefficient, then undo the
//      outermost function with an isolate rule (rules/cas/solve.yaml), and repeat
//   3. several terms: a polynomial (factor over the rationals, the quadratic
//      formula, rational roots), a product equal to 0 (each factor), a fraction
//      (clear the denominator), or a polynomial in e^x, sin x … (substitute)
//   4. if allowed (approximate), numeric roots
// Every answer is checked in the original equation; answers that don't fit
// (√ squared, ln of a negative, a zero denominator) are dropped, with a step.

import { op, sym, isOp, walk, replaceAt, exactNum } from '../expr.js';
import {
  N, isN, add, mul, neg, div, pow, canon, display, normal, termsOf, splitCoef, factorsOf, freeSymbols, keyOf, Q, CasError, settings, imaginaryUnit,
} from './form.js';
import { coefficients, rationalCoefficients, factorForm, drawFactored, together, mentions, rationalRoots } from './poly.js';
import { rewrite } from './rules.js';
import { approximate } from './approx.js';

const eq = (l, r) => op('=', [l, r]);
const ZERO_NODE = normal(op('+', [sym('x'), op('neg', [sym('x')])]));
const isEquation = (n) => isOp(n) && n.op === '=';

/**
 * @param {object} cas  { set, step(id, name, tags, from, to, values), format }
 * @returns {{ solutions: node[], unsolved: node[], steps }}
 */
export function solveEquation(cas, input, v, options = {}) {
  const steps = [];
  const record = (id, name, tags, from, to, values = {}) => steps.push(cas.step(id, name, tags, from, to, values));
  record.raw = (s) => steps.push(s);
  const original = isEquation(input) ? input : eq(input, ZERO_NODE);
  const start = eq(normal(original.args[0]), normal(original.args[1]));
  if (start.s !== original.s) record('normal', 'Work out each side', ['tidy', 'arithmetic'], original, start);
  const found = [];
  const unsolved = [];
  const numericFound = new Set();
  found.numeric = numericFound;
  solveBranch(cas, start, v, options, record, found, unsolved, 0);

  // Check each answer in the original equation, and keep each once.
  const out = [];
  const seen = new Set();
  const tidy = (n) => rewrite(n, cas.set.view('simplify'), { format: cas.format }).node;
  // numeric roots stay as their decimals (the normal form would make them fractions)
  for (const value of found.map((n) => (numericFound.has(n) ? n : tidy(n)))) {
    const k = value.s;
    if (seen.has(k)) continue;
    seen.add(k);
    // numeric roots are as close as their digits, not exact: they are not checked
    const why = numericFound.has(value) ? null : check(original, v, value);
    if (why) {
      record('solve.reject', 'Check the answer', ['check'], eq(sym(v), value), eq(sym(v), value), { value, reason: why });
      continue;
    }
    out.push(value);
  }
  out.sort(byValue);
  return { solutions: out, unsolved, steps, always: unsolved.some((e) => e.always) };
}

/** Real answers first, smallest first; then complex ones by real part, then imaginary. */
function byValue(a, b) {
  const x = numeric(a);
  const y = numeric(b);
  if (x === null || y === null) return a.s < b.s ? -1 : 1;
  return (Math.abs(x.im) > 0) - (Math.abs(y.im) > 0) || x.re - y.re || x.im - y.im;
}

function numeric(node) {
  if (freeSymbols(node).size) return null;
  try {
    const { re, im } = approximate(node, { digits: 20 });
    return { re, im };
  } catch {
    return null;
  }
}

/** Why value doesn't solve the original equation, or null when it does (or can't be told numerically). */
function check(original, v, value) {
  const [L, R] = original.args;
  const others = new Set([...freeSymbols(L), ...freeSymbols(R), ...freeSymbols(value)]);
  others.delete(v);
  if (others.size) return null;
  const at = (n) => substitute(n, v, value);
  try {
    const l = approximate(at(L), { digits: 40 });
    const r = approximate(at(R), { digits: 40 });
    const size = Math.max(1, Math.hypot(l.re, l.im), Math.hypot(r.re, r.im));
    if (Math.hypot(l.re - r.re, l.im - r.im) > 1e-12 * size) return 'it does not make the two sides equal';
    return null;
  } catch (error) {
    return `the original equation has no value there (${error.message})`;
  }
}

export function substitute(node, v, value) {
  if (node.type === 'sym') return node.token === v ? value : node;
  if (!isOp(node)) return node;
  return op(node.op, node.args.map((a) => substitute(a, v, value)));
}

const MAX_DEPTH = 24;

function solveBranch(cas, equation, v, options, record, found, unsolved, depth) {
  if (depth > MAX_DEPTH) return giveUp(cas, equation, v, options, record, found, unsolved);
  // more than one answer written as ± or "or": split them
  const split = splitAnswers(equation);
  if (split.length > 1) {
    record('solve.split', 'Two cases', ['split'], equation, split.reduce((acc, e) => (acc ? op('|', [acc, e]) : e), null));
    for (const e of split) solveBranch(cas, e, v, options, record, found, unsolved, depth + 1);
    return;
  }
  // ±0 is one answer, 0: carry on with it (x² = 0 has the solution 0)
  if (split.length === 1 && split[0].s !== equation.s) return solveBranch(cas, split[0], v, options, record, found, unsolved, depth + 1);
  const [L, R] = equation.args;
  // done: x = value
  if (L.type === 'sym' && L.token === v && !mentions(canon(R), v)) {
    found.push(R);
    return;
  }
  const E = add([canon(L), neg(canon(R))]);
  if (!mentions(E, v)) {
    if (isN(E) && E.q.isZero) {
      record('solve.always', 'Always true', ['check'], equation, equation, { v });
      unsolved.push(Object.assign(Object.create(equation), { always: true }));
      return;
    }
    record('solve.never', 'No solution', ['check'], equation, equation, { v });
    return;
  }
  const withV = termsOf(E).filter((t) => mentions(t, v));
  const without = termsOf(E).filter((t) => !mentions(t, v));
  const D = add(withV);
  const F = neg(add(without));

  // complex: a polynomial has as many roots as its degree, so x⁴ = 16 goes to the polynomial methods (±2, ±2i)
  if (settings.complex) {
    const cs = coefficients(E, v);
    if (cs && [...cs.values()].every((c) => !mentions(c, v)) && Math.max(...cs.keys()) >= 2) {
      const zero = eq(display(E), ZERO_NODE);
      if (zero.s !== equation.s) record('solve.one-side', 'Everything on one side', ['move'], equation, zero, { v });
      return solvePolynomial(cas, E, cs, v, options, record, found, unsolved, depth, zero);
    }
  }
  if (withV.length === 1) return isolate(cas, equation, D, F, v, options, record, found, unsolved, depth);

  // several terms with the unknown
  const zero = eq(display(E), ZERO_NODE);
  const cs = coefficients(E, v);
  if (cs && [...cs.values()].every((c) => !mentions(c, v)) && Math.max(...cs.keys()) >= 2) {
    if (zero.s !== equation.s) record('solve.one-side', 'Everything on one side', ['move'], equation, zero, { v });
    return solvePolynomial(cas, E, cs, v, options, record, found, unsolved, depth, zero);
  }
  // a product is 0 when a factor is
  const f = factorForm(E);
  const vFactors = f.factors.filter((g) => mentions(g.base, v) && !(isN(g.exp) && g.exp.q.sign < 0));
  if (vFactors.length >= 2 || (vFactors.length === 1 && f.factors.length > 1)) {
    const factored = eq(drawFactored(f), ZERO_NODE);
    if (zero.s !== equation.s) record('solve.one-side', 'Everything on one side', ['move'], equation, zero, { v });
    if (factored.s !== zero.s) record('solve.factor', 'Factor', ['factor'], zero, factored, {});
    const cases = vFactors.map((g) => eq(display(g.base), ZERO_NODE));
    if (cases.length > 1) record('solve.zero-product', 'A product is zero when a factor is', ['split'], factored, cases.reduce((acc, e) => (acc ? op('|', [acc, e]) : e), null), {});
    for (const c of cases) solveBranch(cas, c, v, options, record, found, unsolved, depth + 1);
    return;
  }
  // a fraction: multiply out the denominator
  const t = together(E);
  if (mentions(t.den, v)) {
    const cleared = eq(display(t.num), ZERO_NODE);
    record('solve.clear-denominator', 'Clear the denominator', ['move'], equation, cleared, { den: display(t.den) });
    return solveBranch(cas, cleared, v, options, record, found, unsolved, depth + 1);
  }
  // one root (or absolute value) among polynomial terms: get it alone, then undo it
  const algebraic = withV.filter((t) => !isPolynomialIn(t, v));
  if (algebraic.length === 1 && /\b(sqrt|root|abs)\b/.test(display(algebraic[0]).s)) {
    return isolate(cas, equation, algebraic[0], neg(add(termsOf(E).filter((t) => t !== algebraic[0]))), v, options, record, found, unsolved, depth);
  }
  // a polynomial in e^x, sin x, ln x …: substitute
  const sub = substitution(E, v);
  if (sub) {
    const u = sub.symbol;
    record('solve.substitute', 'Substitute', ['substitute'], zero, eq(display(sub.poly), ZERO_NODE), { u: sym(u), kernel: display(sub.kernel) });
    const inner = [];
    solveBranch(cas, eq(display(sub.poly), ZERO_NODE), u, options, record, inner, unsolved, depth + 1);
    for (const value of inner) solveBranch(cas, eq(display(sub.kernel), value), v, options, record, found, unsolved, depth + 1);
    return;
  }
  return giveUp(cas, zero, v, options, record, found, unsolved);
}

/** One term D with the unknown, = F: divide by its constant factors, then undo its outer function. */
function isolate(cas, equation, D, F, v, options, record, found, unsolved, depth) {
  let current = eq(display(D), display(F));
  if (current.s !== equation.s) record('solve.move', 'Move the terms', ['move'], equation, current, { v });
  // divide by everything that doesn't mention the unknown
  const { coef, rest } = splitCoef(D);
  const parts = rest ? factorsOf(rest) : [];
  const constant = mul([N(coef), ...parts.filter((f) => !mentions(f, v))]);
  if (!(isN(constant) && constant.q.isOne)) {
    const g = mul(parts.filter((f) => mentions(f, v)));
    const next = eq(display(g), display(div(F, constant)));
    // x/2 = 3: multiply by 2 (rather than divide by 1/2)
    const byReciprocal = isN(constant) && !constant.q.isInteger && (constant.q.n === 1n || constant.q.n === -1n);
    record(byReciprocal ? 'solve.multiply' : 'solve.divide', byReciprocal ? 'Multiply both sides' : 'Divide both sides', ['move'], current, next,
      { by: display(byReciprocal ? N(constant.q.inv()) : constant), v });
    current = next;
  }
  if (current.args[0].type === 'sym' && current.args[0].token === v) {
    found.push(current.args[1]);
    return;
  }
  // a product (or fraction) equal to 0: each factor on top can be the 0
  const rhs = canon(current.args[1]);
  if (isN(rhs) && rhs.q.isZero) {
    const lhs = canon(current.args[0]);
    const top = factorsOf(lhs).filter((f) => mentions(f, v) && !isDenominator(f));
    if (top.length > 1 || top.length < factorsOf(lhs).filter((f) => mentions(f, v)).length) {
      const cases = top.map((f) => eq(display(baseOf(f)), ZERO_NODE));
      record('solve.zero-product', 'A product is zero when a factor is', ['split'], current, cases.reduce((acc, e) => (acc ? op('|', [acc, e]) : e), null), {});
      for (const c of cases) solveBranch(cas, c, v, options, record, found, unsolved, depth + 1);
      return;
    }
  }
  // undo the outermost function with a rule
  const r = rewrite(current, cas.set.view('isolate'), { format: cas.format, maxSteps: 1, variable: v });
  if (r.steps.length) {
    steps(record, r.steps);
    return solveBranch(cas, r.node, v, options, record, found, unsolved, depth + 1);
  }
  // the unknown in a power's exponent and base, inside an unknown function …
  return giveUp(cas, current, v, options, record, found, unsolved);
}

const isDenominator = (f) => f.k === 'mul' && f.c.isOne && f.fs.length === 1 && isN(f.fs[0].e) && f.fs[0].e.q.sign < 0;
const baseOf = (f) => (f.k === 'mul' && f.c.isOne && f.fs.length === 1 && isN(f.fs[0].e) && f.fs[0].e.q.sign > 0 ? f.fs[0].b : f);
const isPolynomialIn = (x, v) => {
  const cs = coefficients(x, v);
  return Boolean(cs) && [...cs.values()].every((c) => !mentions(c, v));
};

function steps(record, list) {
  for (const s of list) record.raw(s);
}

function splitAnswers(equation) {
  const out = [];
  const visit = (e) => {
    if (isOp(e) && e.op === '|') { e.args.forEach(visit); return; }
    if (!isEquation(e)) { out.push(e); return; }
    // the first ± on the right gives two equations
    const R = e.args[1];
    const at = walk(R, 'pre').find(({ node }) => isOp(node) && node.op === 'pm');
    if (!at) { out.push(e); return; }
    const inside = at.node.args[0];
    const plus = normal(replaceAt(R, at.path, inside));
    const minus = normal(replaceAt(R, at.path, op('neg', [inside])));
    visit(eq(e.args[0], plus));
    if (minus.s !== plus.s) visit(eq(e.args[0], minus));
  };
  visit(equation);
  return out;
}

function solvePolynomial(cas, E, cs, v, options, record, found, unsolved, depth, zero) {
  const degree = Math.max(...cs.keys());
  const rational = rationalCoefficients(cs);
  // complex: a xⁿ + b = 0 has n roots, |r|^(1/n)·(cos θ + i sin θ) with θ = (arg r + 2πk)/n
  if (settings.complex && degree >= 3 && degree <= 64 && rational && rational.every((c, d) => d === 0 || d === degree || c.isZero) && !rational[0].isZero) {
    const r = rational[0].neg().div(rational[degree]);
    const size = pow(N(r.abs()), N(new Q(1n, BigInt(degree))));
    const roots = [];
    for (let k = 0; k < degree; k++) {
      // θ = (arg r + 2πk)/n, as a multiple of π: (0 or 1 + 2k)/n
      const turn = N(new Q(BigInt((r.sign < 0 ? 1 : 0) + 2 * k), BigInt(degree)));
      const angle = mul([turn, canon(sym('pi'))]);
      const value = op('*', [display(size), op('+', [op('cos', [display(angle)]), op('*', [sym('i'), op('sin', [display(angle)])])])]);
      roots.push(rewrite(value, cas.set.view('simplify'), { format: cas.format }).node);
    }
    record('solve.roots', 'All n roots', ['complex'], zero, roots.map((x) => eq(sym(v), x)).reduce((acc, e) => (acc ? op('|', [acc, e]) : e)), { v, n: String(degree), last: String(degree - 1), r: display(N(r)) });
    found.push(...roots);
    return;
  }
  // factor when the rationals allow it
  if (rational) {
    const { roots } = rationalRoots(rational);
    if (roots.length) {
      const f = factorForm(E);
      const factored = eq(drawFactored(f), ZERO_NODE);
      if (f.factors.length > 1 || f.factors.some((g) => !(isN(g.exp) && g.exp.q.isOne))) {
        record('solve.factor', 'Factor', ['factor'], zero, factored, {});
        const cases = f.factors.filter((g) => mentions(g.base, v)).map((g) => eq(display(g.base), ZERO_NODE));
        if (cases.length > 1) record('solve.zero-product', 'A product is zero when a factor is', ['split'], factored, cases.reduce((acc, e) => (acc ? op('|', [acc, e]) : e), null), {});
        for (const c of cases) solveBranch(cas, c, v, options, record, found, unsolved, depth + 1);
        return;
      }
    }
  }
  if (degree === 2) {
    const a = cs.get(2);
    const b = cs.get(1) ?? N(Q.ZERO);
    const c = cs.get(0) ?? N(Q.ZERO);
    const D = add([pow(b, N(Q.of(2))), mul([N(Q.of(-4)), a, c])]);
    if (isN(D) && D.q.sign < 0 && !settings.complex) {
      record('solve.no-real', 'No real solutions', ['quadratic'], zero, zero, { D: display(D) });
      return;
    }
    const twoA = mul([N(Q.of(2)), a]);
    const root = pow(D, N(Q.HALF));
    const plus = display(div(add([neg(b), root]), twoA));
    const minus = display(div(add([neg(b), neg(root)]), twoA));
    const answers = plus.s === minus.s ? eq(sym(v), plus) : op('|', [eq(sym(v), plus), eq(sym(v), minus)]);
    const imaginary = settings.complex && isN(D) && D.q.sign < 0;
    record(imaginary ? 'solve.quadratic-complex' : 'solve.quadratic', 'The quadratic formula', ['quadratic'], zero, answers, { a: display(a), b: display(b), c: display(c), D: display(D), root: display(root), v });
    found.push(plus);
    if (minus.s !== plus.s) found.push(minus);
    return;
  }
  return giveUp(cas, zero, v, options, record, found, unsolved);
}

/** E as a polynomial in one kernel: e^x (e^(2x) = (e^x)²), sin x, ln x, √x … */
function substitution(E, v) {
  const node = display(E);
  const kernels = new Map();
  for (const { node: n } of walk(node, 'pre')) {
    if (!isOp(n) || !freeSymbols(n).has(v)) continue;
    if (n.op === '^' && !freeSymbols(n.args[0]).has(v)) {
      // b^(k·x) → kernel b^x
      const x = canon(n.args[1]);
      const { coef, rest } = splitCoef(x);
      if (rest && coef.isInteger && display(rest).s === v) {
        const k = display(pow(canon(n.args[0]), canon(sym(v))));
        kernels.set(k.s, k);
      }
    } else if (['sin', 'cos', 'tan', 'ln', 'sqrt', 'abs'].includes(n.op) && n.args[0].s === v) kernels.set(n.s, n);
  }
  const u = v === 'u' ? 'w' : 'u';
  for (const kernel of kernels.values()) {
    const replaced = replaceKernel(node, kernel, v, u);
    if (!replaced || freeSymbols(replaced).has(v)) continue;
    const poly = canon(replaced);
    const cs = coefficients(poly, u);
    if (cs && Math.max(...cs.keys()) >= 1) return { kernel: canon(kernel), poly, symbol: u };
  }
  return null;
}

function replaceKernel(node, kernel, v, u) {
  if (node.s === kernel.s) return sym(u);
  if (!isOp(node)) return node;
  // b^(k x) with kernel b^x → u^k
  if (node.op === '^' && kernel.op === '^' && node.args[0].s === kernel.args[0].s) {
    const x = canon(node.args[1]);
    const { coef, rest } = splitCoef(x);
    if (rest && display(rest).s === v && coef.isInteger) return op('^', [sym(u), display(N(coef))]);
  }
  return op(node.op, node.args.map((a) => replaceKernel(a, kernel, v, u)));
}

function giveUp(cas, equation, v, options, record, found, unsolved) {
  if (options.approximate) {
    const digits = typeof options.approximate === 'number' ? options.approximate : 15;
    const E = canon(op('-', [equation.args[0], equation.args[1]]));
    const cs = settings.complex ? rationalCoefficients(coefficients(E, v)) : null;
    const roots = cs && cs.length > 2 ? complexRoots(cs.map((c) => c.toNumber()), Math.min(digits, 14)) : numericRoots(equation, v, digits);
    for (const r of roots) found.numeric?.add(r);
    record('solve.numeric', 'Numeric solutions', ['numeric'], equation, roots.length ? roots.map((r) => eq(sym(v), r)).reduce((acc, e) => (acc ? op('|', [acc, e]) : e)) : equation, { v, count: String(roots.length) });
    found.push(...roots);
    return;
  }
  record('solve.unsolved', 'No exact method', ['unsolved'], equation, equation, { v });
  unsolved.push(equation);
}

/**
 * Real roots of L - R = 0 by scanning [-1000, 1000] for sign changes, then bisection
 * to the digits asked for. Roots that touch 0 without crossing are missed.
 */
function numericRoots(equation, v, digits) {
  const f = canon(op('-', [equation.args[0], equation.args[1]]));
  const node = display(f);
  const at = (x) => {
    try { return approximate(substitute(node, v, decimal(x)), { digits: 30 }).number; } catch { return NaN; }
  };
  const out = [];
  const xs = [];
  for (let k = -400; k <= 400; k++) xs.push(Math.sign(k) * (Math.abs(k) / 20) ** 2);
  for (let i = 0; i + 1 < xs.length; i++) {
    let a = xs[i];
    let b = xs[i + 1];
    let fa = at(a);
    const fb = at(b);
    if (Number.isNaN(fa) || Number.isNaN(fb)) continue;
    if (fa === 0) { out.push(decimal(a)); continue; }
    if (fa * fb > 0) continue;
    for (let k = 0; k < 200 && b - a > Math.abs(a) * 1e-16; k++) {
      const m = (a + b) / 2;
      const fm = at(m);
      if (Number.isNaN(fm)) break;
      if (fa * fm <= 0) b = m;
      else { a = m; fa = fm; }
    }
    const root = (a + b) / 2;
    // poles change sign too: keep only points where the function is small
    if (Math.abs(at(root)) < 1e-6) out.push(decimal(Number(root.toPrecision(Math.min(digits, 15)))));
  }
  return out;
}

/**
 * Every root of a polynomial (coefficients lowest degree first), complex ones too,
 * by the Durand–Kerner iteration in doubles: nodes re + im·i to `digits` figures.
 */
function complexRoots(cs, digits) {
  const n = cs.length - 1;
  const lead = cs[n];
  const a = cs.map((c) => c / lead);
  // p(z) for the monic polynomial, by Horner's rule in complex doubles
  const horner = (re, im) => {
    let pr = 1;
    let pi = 0;
    for (let k = n - 1; k >= 0; k--) [pr, pi] = [pr * re - pi * im + a[k], pr * im + pi * re];
    return [pr, pi];
  };
  let z = Array.from({ length: n }, (_, k) => [Math.cos((2 * Math.PI * k) / n + 0.4) * 1.3, Math.sin((2 * Math.PI * k) / n + 0.4) * 1.3]);
  for (let iter = 0; iter < 500; iter++) {
    let moved = 0;
    z = z.map(([re, im], k) => {
      let [nr, ni] = horner(re, im);
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const dr = re - z[j][0];
        const di = im - z[j][1];
        const d = dr * dr + di * di;
        [nr, ni] = [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d];
      }
      moved = Math.max(moved, Math.hypot(nr, ni));
      return [re - nr, im - ni];
    });
    if (moved < 1e-15) break;
  }
  const round = (x) => (Math.abs(x) < 1e-12 ? 0 : Number(x.toPrecision(digits)));
  return z.map(([re, im]) => [round(re), round(im)])
    .sort((p, q) => (p[1] !== 0) - (q[1] !== 0) || p[0] - q[0] || p[1] - q[1])
    .map(([re, im]) => {
      const reNode = decimalSigned(re);
      if (im === 0) return reNode;
      const imNode = op('*', [decimalSigned(Math.abs(im)), sym('i')]);
      return re === 0 ? (im < 0 ? op('neg', [imNode]) : imNode) : op(im < 0 ? '-' : '+', [reNode, imNode]);
    });
}

const decimalSigned = (x) => exactNum(String(x).includes('e') ? x.toFixed(20) : String(x));

/** A double in [-1000, 1000] as an exact decimal leaf. */
const decimal = (x) => exactNum(Number.isInteger(x) ? String(x) : x.toFixed(17));

// ---- linear systems ---------------------------------------------------------------------

/**
 * Linear equations in several unknowns, by elimination with exact fractions.
 * Coefficients of the unknowns must be numbers; the right sides may be anything.
 * @returns {{ solution: Map<string, node> | null, steps, status: 'one'|'none'|'many' }}
 */
export function solveLinearSystem(cas, equations, vars) {
  const steps = [];
  const rows = equations.map((e) => {
    const E = isEquation(e) ? add([canon(e.args[0]), neg(canon(e.args[1]))]) : canon(e);
    const coeffs = vars.map((v) => {
      const cs = coefficients(E, v);
      if (!cs || Math.max(0, ...cs.keys()) > 1) throw new CasError(`not linear in ${v}`);
      const c = cs.get(1) ?? N(Q.ZERO);
      if (!isN(c)) throw new CasError(`the coefficient of ${v} must be a number (it is ${cas.format(display(c))})`);
      return c.q;
    });
    let constant = E;
    for (let i = 0; i < vars.length; i++) constant = add([constant, mul([N(coeffs[i].neg()), canon(sym(vars[i]))])]);
    for (const v of vars) if (mentions(constant, v)) throw new CasError(`not linear in ${v}`);
    return { coeffs, rhs: neg(constant) };
  });
  const system = () => rows.map((r) => eq(display(add(r.coeffs.map((c, i) => mul([N(c), canon(sym(vars[i]))])))), display(r.rhs))).reduce((acc, e) => (acc ? op('&', [acc, e]) : e), null);
  let pivotRow = 0;
  const pivots = [];
  for (let col = 0; col < vars.length && pivotRow < rows.length; col++) {
    const p = rows.findIndex((r, i) => i >= pivotRow && !r.coeffs[col].isZero);
    if (p < 0) continue;
    [rows[pivotRow], rows[p]] = [rows[p], rows[pivotRow]];
    const before = system();
    const pr = rows[pivotRow];
    const lead = pr.coeffs[col];
    pr.coeffs = pr.coeffs.map((c) => c.div(lead));
    pr.rhs = mul([N(lead.inv()), pr.rhs]);
    for (let i = 0; i < rows.length; i++) {
      if (i === pivotRow || rows[i].coeffs[col].isZero) continue;
      const factor = rows[i].coeffs[col];
      rows[i].coeffs = rows[i].coeffs.map((c, j) => c.sub(factor.mul(pr.coeffs[j])));
      rows[i].rhs = add([rows[i].rhs, mul([N(factor.neg()), pr.rhs])]);
    }
    steps.push(cas.step('system.eliminate', 'Eliminate', ['eliminate'], before, system(), { v: sym(vars[col]) }));
    pivots.push(col);
    pivotRow++;
  }
  for (const r of rows.slice(pivotRow)) {
    if (!(isN(r.rhs) && r.rhs.q.isZero)) return { solution: null, steps, status: 'none' };
  }
  if (pivots.length < vars.length) return { solution: null, steps, status: 'many' };
  const solution = new Map();
  pivots.forEach((col, i) => solution.set(vars[col], display(rows[i].rhs)));
  return { solution, steps, status: 'one' };
}

export { keyOf };
