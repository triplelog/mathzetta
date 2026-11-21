// Integration: the rules in rules/cas/integrals.yaml, and strategies for
// when no rule fits an integral:
//   expand          ∫ (x + 1)² dx → ∫ x² + 2x + 1 dx
//   substitution    ∫ f(ax + b) dx = (1/a) F(ax + b), F from the rules for ∫ f(u) du
//   fractions       division, partial fractions (linear factors, and one irreducible quadratic:
//                   ln and arctan, by completing the square)
//   special shapes  odd powers of sin and cos, secⁿ and cscⁿ (reduction), e^(ax)·sin(bx) (by parts
//                   twice), sin A cos B (product to sum), √(c − kx²) (a trig substitution)
//   u-substitution  ∫ f(g(x))·g′(x) dx = ∫ f(u) du, for any part g of the integrand
//   by parts        ∫ p·e^x, p·sin x, p·cos x (p a polynomial): p·V − ∫ p′·V;
//                   ∫ p·ln x, p·arctan x (p may be 1): the other way round
// A definite integral is the antiderivative's change between the limits.

import { op, sym, isOp, isNum, walk, replaceAt, exactNum } from '../expr.js';
import { approximate } from './approx.js';
import { N, isN, add, mul, neg, div, canon, display, normal, factorsOf, freeSymbols, powFactor, Q, CasError } from './form.js';
import { expand, coefficients, mentions, together, factorForm, rationalCoefficients, fromCoefficients, polyDivide, polyDerivative, rationalRoots, evaluateAt } from './poly.js';
import { rewrite } from './rules.js';
import { substitute } from './solve.js';
import { pointOf } from './limit.js';

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
  // 4. shapes with a method of their own
  const shaped = specialForms(cas, node, v);
  if (shaped) return shaped;
  // 5. u-substitution: the integrand is f(g)·g′
  const substituted = uSubstitution(cas, node, v, depth);
  if (substituted) return substituted;
  // 6. by parts
  return byParts(cas, node, x, v, depth);
}

const qn = (q) => display(N(q));   // a rational number as a node
const whole = (k) => exactNum(String(k));

/**
 * ∫ f(g(x))·g′(x) dx = ∫ f(u) du with u = g(x): each part g of the integrand (a function's argument, a power's
 * base or exponent, a denominator, a function itself) is tried in turn; it works when the integrand over g′ is
 * made of g alone: ∫ x·e^(x²) dx (u = x²), ∫ ln x / x dx (u = ln x), ∫ x/(x² + 1) dx (u = x² + 1).
 */
function uSubstitution(cas, node, v, depth) {
  if (depth >= 3) return null;
  const [g, w] = node.args;
  const u = v === 'u' ? 't' : 'u';
  const seen = new Set();
  for (const { node: c } of walk(g, 'pre')) {
    if (c === g || !isOp(c) || c.s === g.s || seen.has(c.s) || !freeSymbols(c).has(v) || ['der', 'int'].includes(c.op)) continue;
    seen.add(c.s);
    let du;
    try { du = normal(cas.differentiate(c, v)); } catch { continue; }
    if (isNum(du) && Number(du.value) === 0) continue;
    let inner;
    try { inner = replaceAll(normal(op('/', [g, du])), c, sym(u)); } catch { continue; }
    if (freeSymbols(inner).has(v)) continue;
    let F;
    try { F = antiderivative(cas, normal(inner), u, depth + 1); } catch { continue; }
    const result = normal(substitute(F.node, u, c));
    return {
      node: result,
      steps: [
        cas.step('integrate.u-substitution', 'Substitute', ['substitute'], node, normal(integral(inner, u)), { u: sym(u), inside: c, du, v }),
        ...F.steps,
        cas.step('integrate.back', 'Substitute back', ['substitute'], F.node, result, { u: sym(u), inside: c }),
      ],
    };
  }
  return null;
}

/** ax + b in v with a a number: { a: Q, node }; null otherwise. */
function linear(n, v) {
  if (!n || !freeSymbols(n).has(v)) return null;
  const cs = coefficients(canon(n), v);
  if (!cs || Math.max(...cs.keys()) !== 1) return null;
  const a = cs.get(1);
  if (!isN(a) || a.q.isZero) return null;
  return { a: a.q, node: n };
}

/** A factor as base and whole power: sin(x)^3 → { base: sin x, n: 3 }. */
function powerOf(f) {
  if (isOp(f) && f.op === '^' && isNum(f.args[1]) && Number.isInteger(Number(f.args[1].value))) return { base: f.args[0], n: Number(f.args[1].value) };
  return { base: f, n: 1 };
}

function specialForms(cas, node, v) {
  const [g, w] = node.args;
  const factors = factorsOf(canon(g)).map(display).map(powerOf);
  const trig = (f, ...names) => isOp(f.base) && names.includes(f.base.op);
  const step = (id, name, next, values = {}) => ({ node: next, steps: [cas.step(id, name, ['rewrite'], node, next, { v, ...values })] });

  // e^(ax+p)·sin(bx+q), e^(ax+p)·cos(bx+q): by parts twice, the integral comes back, and is solved for
  if (factors.length === 2 && factors.every((f) => f.n === 1)) {
    const e = factors.find((f) => isOp(f.base) && f.base.op === '^' && f.base.args[0].type === 'sym' && f.base.args[0].token === 'e');
    const t = factors.find((f) => trig(f, 'sin', 'cos'));
    const A = e && linear(e.base.args[1], v);
    const B = t && linear(t.base.args[0], v);
    if (A && B) {
      const [a, b] = [A.a, B.a];
      const scale = a.mul(a).add(b.mul(b));
      const [sinB, cosB] = [op('sin', [B.node]), op('cos', [B.node])];
      const inside = t.base.op === 'sin' ? op('-', [op('*', [qn(a), sinB]), op('*', [qn(b), cosB])]) : op('+', [op('*', [qn(a), cosB]), op('*', [qn(b), sinB])]);
      const result = normal(op('/', [op('*', [e.base, inside]), qn(scale)]));
      return step('integrate.parts-twice', 'By parts twice', result, { e: e.base, t: t.base });
    }
  }

  // sin A·cos B, cos A·cos B, sin A·sin B with A ≠ B: product to sum
  if (factors.length === 2 && factors.every((f) => f.n === 1 && trig(f, 'sin', 'cos') && linear(f.base.args[0], v)) && factors[0].base.args[0].s !== factors[1].base.args[0].s) {
    const [s, c] = factors[0].base.op === 'sin' ? factors : [factors[1], factors[0]];
    const [A, B] = [s.base.args[0], c.base.args[0]];
    const both = (f, sign) => op(f, [op(sign, [A, B])]);
    let sum;
    if (s.base.op === 'sin' && c.base.op === 'cos') sum = op('+', [both('sin', '+'), both('sin', '-')]);
    else if (s.base.op === 'cos') sum = op('+', [both('cos', '-'), both('cos', '+')]);
    else sum = op('-', [both('cos', '-'), both('cos', '+')]);
    const next = normal(integral(op('/', [sum, whole(2)]), w));
    return step('integrate.product-to-sum', 'Product to sum', next);
  }

  // sinᵐ x·cosⁿ x with an odd power of 3 or more: keep one, and write the rest in the other (cos² = 1 − sin²)
  const sin = factors.find((f) => trig(f, 'sin'));
  const cos = factors.find((f) => trig(f, 'cos'));
  const sameArg = sin && cos ? sin.base.args[0].s === cos.base.args[0].s : true;
  if ((sin || cos) && sameArg && factors.every((f) => f === sin || f === cos) && [sin, cos].every((f) => !f || f.n >= 0)) {
    for (const [odd, other] of [[cos, 'sin'], [sin, 'cos']]) {
      if (!odd || odd.n < 3 || odd.n % 2 === 0) continue;
      const arg = odd.base.args[0];
      const k = (odd.n - 1) / 2;
      const rest = factors.filter((f) => f !== odd).map((f) => op('^', [f.base, whole(f.n)]));
      const parts = [...rest, op('^', [op('-', [whole(1), op('^', [op(other, [arg]), whole(2)])]), whole(k)]), op(odd.base.op, [arg])];
      const rewritten = parts.reduce((all, f) => op('*', [all, f]));
      const next = normal(integral(rewritten, w));
      return step('integrate.odd-power', 'An odd power', next, { f: odd.base, other: op(other, [arg]) });
    }
  }

  // secⁿ x, cscⁿ x (n ≥ 3): the reduction formula, down to sec² or sec
  if (factors.length === 1 && factors[0].n >= 3 && trig(factors[0], 'sec', 'csc') && factors[0].base.args[0].type === 'sym' && factors[0].base.args[0].token === v) {
    const { base, n } = factors[0];
    const x = base.args[0];
    const partner = base.op === 'sec' ? op('tan', [x]) : op('cot', [x]);
    // ∫ secⁿ = secⁿ⁻² tan/(n − 1) + (n − 2)/(n − 1) ∫ secⁿ⁻²;  ∫ cscⁿ = −cscⁿ⁻² cot/(n − 1) + (n − 2)/(n − 1) ∫ cscⁿ⁻²
    const first = op('/', [op('*', [op('^', [base, whole(n - 2)]), partner]), whole(n - 1)]);
    const again = op('*', [op('/', [whole(n - 2), whole(n - 1)]), integral(op('^', [base, whole(n - 2)]), w)]);
    const next = normal(op('+', [base.op === 'sec' ? first : op('neg', [first]), again]));
    return step('integrate.reduction', 'Reduction formula', next, { f: base, n: whole(n) });
  }

  // √(c − kx²) and 1/√(c − kx²) (c, k > 0): x = √(c/k)·sin θ
  const radical = (r) => {
    if (!isOp(r) || r.op !== 'sqrt') return null;
    const cs = coefficients(canon(r.args[0]), v);
    if (!cs || cs.size !== 2 || !cs.has(2) || !cs.has(0)) return null;
    const [k, c] = [cs.get(2), cs.get(0)];
    if (!isN(k) || !isN(c) || k.q.sign >= 0 || c.q.sign <= 0) return null;
    return { k: k.q.neg(), c: c.q, root: r };
  };
  const x = sym(v);
  const sqrtOf = (q) => op('sqrt', [qn(q)]);
  const top = radical(g);
  const below = isOp(g) && g.op === '/' && isNum(g.args[0]) && g.args[0].value === 1 ? radical(g.args[1]) : null;
  if (top || below) {
    const { k, c, root } = top ?? below;
    const arcsin = op('arcsin', [op('*', [x, sqrtOf(k.div(c))])]);
    const result = top
      ? normal(op('+', [op('/', [op('*', [x, root]), whole(2)]), op('*', [op('/', [qn(c), op('*', [whole(2), sqrtOf(k)])]), arcsin])]))
      : normal(op('/', [arcsin, sqrtOf(k)]));
    return step('integrate.trig-substitution', 'A trig substitution', result, { x, a: normal(sqrtOf(c.div(k))) });
  }
  return null;
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
  // what is left after the rational roots: nothing, or one quadratic with no real roots
  const quadratic = rest.length === 3 && rest[1].mul(rest[1]).sub(Q.of(4).mul(rest[0]).mul(rest[2])).sign < 0;
  if (!distinct || (rest.length !== 1 && !quadratic) || (!roots.length && !quadratic)) return null;
  // A_i = p(r_i) / q′(r_i), for each simple root
  const dq = polyDerivative(q);
  const A = roots.map((r) => evaluateAt(p, r).div(evaluateAt(dq, r)));
  const terms = roots.map((r, i) => div(N(A[i]), add([variable, N(r.neg())])));
  if (!quadratic) {
    const next = integral(display(add(terms)), sym(v));
    return { node: next, steps: [cas.step('integrate.partial-fractions', 'Partial fractions', ['partial-fractions'], node, next, {})] };
  }
  // the rest of p/q is (Bx + C)/Q: p − Σ A_i·q/(x − r_i), divided by the linear factors
  let numerator = p;
  roots.forEach((r, i) => { numerator = polySub(numerator, polyScale(polyDivide(q, [r.neg(), Q.of(1)]).q, A[i])); });
  const L = roots.reduce((acc, r) => polyMul(acc, [r.neg(), Q.of(1)]), [Q.of(1)]);
  const { q: BC } = polyDivide(numerator, L);
  const [C, B] = [BC[0] ?? Q.ZERO, BC[1] ?? Q.ZERO];
  // Q = ax² + bx + c = a((x + b/2a)² + D/4a²) with D = 4ac − b²: (Bx + C)/Q = (B/2a)·Q′/Q + (C − Bb/2a)/Q
  const [c0, b0, a0] = polyDivide(q, L).q;   // the quadratic: q over its linear factors, exactly
  const D = Q.of(4).mul(a0).mul(c0).sub(b0.mul(b0));
  const Qnode = fromCoefficients([c0, b0, a0], v);
  const logPart = B.div(Q.of(2).mul(a0));
  const arcPart = C.sub(B.mul(b0).div(Q.of(2).mul(a0)));
  const root = op('sqrt', [qn(D)]);
  const lnTerm = op('*', [qn(logPart), op('ln', [op('abs', [display(Qnode)])])]);
  const arctanTerm = op('*', [op('/', [op('*', [whole(2), qn(arcPart)]), root]), op('arctan', [op('/', [display(fromCoefficients([b0, a0.mul(Q.of(2))], v)), root])])]);
  const rationalPart = terms.length ? integral(display(add(terms)), sym(v)) : whole(0);
  const next = normal(op('+', [op('+', [rationalPart, lnTerm]), arctanTerm]));
  return { node: next, steps: [cas.step('integrate.complete-square', 'Complete the square', ['partial-fractions'], node, next, { Q: display(Qnode) })] };
}

const polyMul = (a, b) => {
  const out = Array.from({ length: a.length + b.length - 1 }, () => Q.ZERO);
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = out[i + j].add(x.mul(y)); }));
  return out;
};
const polyScale = (a, k) => a.map((x) => x.mul(k));
const polySub = (a, b) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? Q.ZERO).sub(b[i] ?? Q.ZERO));

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
  const hNode = display(h);
  const kind = isOp(hNode) ? hNode.op : '';
  const INVERSES = ['ln', 'arctan', 'arcsin', 'arccos', 'arcsec', 'arccsc', 'arccot'];
  // ∫ arctan x dx: u = arctan x, dv = dx (p is 1, and only an inverse function is worth it)
  if (!mentions(p, v) && !INVERSES.includes(kind)) return null;
  let u;
  let dv;
  if (INVERSES.includes(kind)) {
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
  if ([a, b].some((bound) => pointOf(bound).inf)) return improper(cas, F, v, a, b, f);
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

/**
 * ∫ to ±∞: an improper integral, F's limit at each infinite end (and its value, or limit from inside, at a finite
 * one). It converges when every such limit is a number; a pole between the limits is refused, as for finite ones.
 */
function improper(cas, F, v, a, b, f) {
  const ends = [a, b].map((bound) => pointOf(bound));
  const number = (p) => (p.inf ? p.inf * Infinity : approximate(p.fin, { digits: 20 }).number);
  const [lo, hi] = ends.map(number).sort((x, y) => x - y);
  for (const d of f ? denominators(f, v) : []) {
    let roots = [];
    try { roots = cas.solve(op('=', [d, exactNum('0')]), v, { steps: false }).solutions; } catch { continue; }
    for (const root of roots) {
      const r = approximate(root, { digits: 20 });
      if (Number.isFinite(r.number) && !r.im && r.number > lo && r.number < hi) {
        throw new CasError(`the integrand has no value at ${v} = ${cas.format(root)}, between the limits: split the integral there`);
      }
    }
  }
  const valueAt = (bound, p, inside) => {
    if (!p.inf) {
      try {
        const put = normal(substitute(F, v, bound));
        if (Number.isFinite(approximate(put, { digits: 15 }).number)) return put;
      } catch { /* no value: its limit from inside */ }
    }
    const L = cas.limit(F, v, bound, { steps: false, side: p.inf ? undefined : inside });
    if (!L.exists) throw new CasError(`the integral diverges: as ${v} → ${cas.format(bound)}, ${cas.format(F)} has no limit (${L.reason})`);
    if (L.infinite) throw new CasError(`the integral diverges: as ${v} → ${cas.format(bound)}, ${cas.format(F)} goes to ${L.text}`);
    return L.result;
  };
  const [Fa, Fb] = [valueAt(a, ends[0], 'right'), valueAt(b, ends[1], 'left')];
  const value = normal(op('-', [Fb, Fa]));
  const shown = op('-', [Fb, Fa]);
  return { value, step: cas.step('integrate.improper', 'Limits at the ends', ['evaluate'], F, shown, { a, b, F, v }) };
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
