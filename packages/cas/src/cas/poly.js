// Polynomials and fractions: expand, factor, cancel, together, and the
// polynomial pieces solve() uses (coefficients in a variable, rational roots).
// All exact. Factoring is over the rationals: x² - 2 stays as it is.

import { op, sym } from '../expr.js';
import {
  N, isN, add, mul, pow, neg, fn, powFactor, splitCoef, display, keyOf, termsOf, factorsOf, canon, freeSymbols, Q, CasError,
} from './form.js';
import { gcd } from './rational.js';

const ONE = N(Q.ONE);
const isSymbolAtom = (x, v) => x.k === 'atom' && x.node.type === 'sym' && x.node.token === v;
const MAX_EXPAND_POWER = 60;

// ---- expand ---------------------------------------------------------------------------

/** Multiply out every product of sums, and whole powers of sums, everywhere (inside functions too). */
export function expand(x) {
  switch (x.k) {
    case 'num': return x;
    case 'atom': return x.node.type === 'op' ? fn(x.node.op, x.node.args.map((a) => expand(canon(a)))) : x;
    case 'add': return add(termsOf(x).map(expand));
    case 'mul': {
      let acc = [N(x.c)];
      for (const f of x.fs) {
        const b = expand(f.b);
        if (b.k === 'add' && isN(f.e) && f.e.q.isInteger && f.e.q.sign > 0 && f.e.q.n <= BigInt(MAX_EXPAND_POWER)) {
          for (let i = 0n; i < f.e.q.n; i++) acc = distribute(acc, termsOf(b));
        } else {
          acc = distribute(acc, [powFactor(b, f.e)]);
        }
      }
      return add(acc);
    }
    default: return x;
  }
}

function distribute(left, right) {
  const out = [];
  for (const a of left) for (const b of right) out.push(mul([a, b]));
  // Collect as we go, so (x + 1)^20 stays 21 terms.
  return termsOf(add(out));
}

// ---- polynomials in one variable -----------------------------------------------------------

/**
 * x as a polynomial in v: Map degree → coefficient (forms free of v), or null
 * when it isn't one (v under a root, in a function, in a denominator).
 */
export function coefficients(x, v) {
  const out = new Map();
  for (const t of termsOf(expand(x))) {
    const { coef, rest } = splitCoef(t);
    let deg = 0;
    const others = [N(coef)];
    for (const f of rest ? factorsOf(rest) : []) {
      const { b, e } = f.k === 'mul' && f.fs.length === 1 && f.c.isOne ? f.fs[0] : { b: f, e: ONE };
      if (isSymbolAtom(b, v)) {
        if (!isN(e) || !e.q.isInteger || e.q.sign < 0) return null;
        deg += Number(e.q.n);
      } else if (mentions(b, v) || mentions(e, v)) return null;
      else others.push(f);
    }
    out.set(deg, add([out.get(deg) ?? N(Q.ZERO), mul(others)]));
  }
  for (const [d, c] of out) if (isN(c) && c.q.isZero) out.delete(d);
  return out;
}

export const mentions = (x, v) => freeSymbols(display(x)).has(v);

/** Above this degree an expression isn't treated as a polynomial (x^100000000 - 1 stays as it is). */
export const MAX_DEGREE = 256;

/** The coefficients as exact numbers, lowest degree first, or null if one isn't a number (or the degree is past MAX_DEGREE). */
export function rationalCoefficients(map) {
  if (!map) return null;
  const deg = Math.max(0, ...map.keys());
  if (deg > MAX_DEGREE) return null;
  const out = [];
  for (let d = 0; d <= deg; d++) {
    const c = map.get(d) ?? N(Q.ZERO);
    if (!isN(c)) return null;
    out.push(c.q);
  }
  return out;
}

/** Exact numbers, lowest degree first → the polynomial in v. */
export function fromCoefficients(cs, v) {
  const variable = canon(sym(v));
  return add(cs.map((c, d) => mul([N(c), pow(variable, N(Q.of(d)))])));
}

const trim = (p) => {
  const out = p.slice();
  while (out.length > 1 && out[out.length - 1].isZero) out.pop();
  return out;
};
export const evaluateAt = (p, x) => p.reduceRight((acc, c) => acc.mul(x).add(c), Q.ZERO);

/** p / (v - r), when r is a root. */
function deflate(p, r) {
  const n = p.length - 1;
  const out = new Array(n);
  let carry = Q.ZERO;
  for (let i = n; i >= 1; i--) {
    carry = p[i].add(carry.mul(r));
    out[i - 1] = carry;
  }
  return out;
}

const babs = (n) => (n < 0n ? -n : n);

/** Positive divisors of n, or null when n is too big to factor by trial division quickly. */
function divisors(n) {
  n = babs(n);
  if (n === 0n) return null;
  if (n > 10n ** 14n) return null;
  const primes = [];
  let m = n;
  for (let p = 2n; p * p <= m; p += p === 2n ? 1n : 2n) {
    if (m % p) continue;
    let e = 0;
    while (m % p === 0n) { m /= p; e++; }
    primes.push([p, e]);
  }
  if (m > 1n) primes.push([m, 1]);
  let out = [1n];
  for (const [p, e] of primes) {
    const next = [];
    for (const d of out) for (let k = 0, pk = 1n; k <= e; k++, pk *= p) next.push(d * pk);
    out = next;
    if (out.length > 20000) return null;
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The rational roots of an exact polynomial (with multiplicity) and what is left
 * once they are divided out. Roots come smallest first.
 */
export function rationalRoots(cs) {
  let p = trim(cs);
  const roots = [];
  while (p.length > 1 && p[0].isZero) {
    roots.push(Q.ZERO);
    p = p.slice(1);
  }
  if (p.length <= 1) return { roots, rest: p };
  // Whole-number coefficients, for the candidates ±(divisor of a0)/(divisor of an).
  const lcm = p.reduce((l, c) => (l * c.d) / gcd(l, c.d), 1n);
  const ints = p.map((c) => (c.n * lcm) / c.d);
  const top = divisors(ints[0]);
  const bottom = divisors(ints[ints.length - 1]);
  if (!top || !bottom) return { roots, rest: p };
  const candidates = new Map();
  for (const a of top) for (const b of bottom) {
    for (const s of [1n, -1n]) {
      const r = new Q(s * a, b);
      candidates.set(r.toString(), r);
    }
  }
  const sorted = [...candidates.values()].sort((a, b) => a.compare(b));
  for (const r of sorted) {
    while (p.length > 1 && evaluateAt(p, r).isZero) {
      roots.push(r);
      p = deflate(p, r);
    }
  }
  return { roots: roots.sort((a, b) => a.compare(b)), rest: p };
}

/** a = q·b + r for exact polynomials (lowest degree first). */
export function polyDivide(a, b) {
  const den = trim(b);
  let r = trim(a);
  const lead = den[den.length - 1];
  if (lead.isZero) throw new CasError('division by the zero polynomial');
  const q = new Array(Math.max(1, r.length - den.length + 1)).fill(Q.ZERO);
  while (r.length >= den.length && !(r.length === 1 && r[0].isZero)) {
    const shift = r.length - den.length;
    const c = r[r.length - 1].div(lead);
    q[shift] = c;
    r = trim(r.map((x, i) => (i >= shift && i - shift < den.length ? x.sub(c.mul(den[i - shift])) : x)));
    if (r.length - 1 < shift + den.length - 1 && r[r.length - 1].isZero) break;
    if (r.length < den.length) break;
  }
  return { q: trim(q), r };
}

/** p′ for exact coefficients. */
export const polyDerivative = (p) => (p.length <= 1 ? [Q.ZERO] : p.slice(1).map((c, i) => c.mul(Q.of(i + 1))));

// ---- factoring ---------------------------------------------------------------------------------

/**
 * Factored form, held (not put back into normal form, which would multiply a
 * number back into a sum): { coef: Q, factors: [{ base, exp }], notes } with
 * notes saying what was done, for the steps.
 */
export function factorForm(x) {
  if (x.k === 'num') return { coef: x.q, factors: [], notes: [] };
  if (x.k === 'atom') return { coef: Q.ONE, factors: [{ base: x, exp: ONE }], notes: [] };
  if (x.k === 'mul') {
    let coef = x.c;
    const factors = [];
    const notes = [];
    for (const f of x.fs) {
      if (f.b.k === 'add' && isN(f.e) && f.e.q.isInteger) {
        const inner = factorForm(f.b);
        coef = coef.mul(inner.coef.pow(f.e.q.n));
        for (const g of inner.factors) factors.push({ base: g.base, exp: mul([g.exp, f.e]) });
        notes.push(...inner.notes);
      } else factors.push({ base: f.b, exp: f.e });
    }
    return merge(coef, factors, notes);
  }
  return factorSum(x);
}

function merge(coef, factors, notes) {
  const by = new Map();
  for (const f of factors) {
    const k = keyOf(f.base);
    const g = by.get(k);
    if (g) g.exp = add([g.exp, f.exp]);
    else by.set(k, { ...f });
  }
  const list = [...by.values()].filter((f) => !(isN(f.exp) && f.exp.q.isZero));
  return { coef, factors: list, notes };
}

/** The leading term's coefficient sign, so (1 - x) is written -(x - 1). */
const leadingSign = (s) => splitCoef(termsOf(s)[0]).coef.sign;

function factorSum(s) {
  const terms = termsOf(s);
  const notes = [];
  // 1. what every term shares: a number and powers of the same bases
  const parts = terms.map((t) => {
    const { coef, rest } = splitCoef(t);
    return { coef, fs: rest ? factorsOf(rest).map(asFactor) : [] };
  });
  const num = parts.reduce((g, p) => ({ n: gcd(g.n, p.coef.n), d: (g.d * p.coef.d) / gcd(g.d, p.coef.d) }), { n: 0n, d: 1n });
  let common = new Q(num.n || 1n, num.d);
  if (leadingSign(s) < 0) common = common.neg();
  const shared = [];
  for (const f of parts[0].fs) {
    if (!isN(f.e) || f.e.q.sign <= 0) continue;
    let min = f.e.q;
    const k = keyOf(f.b);
    let everywhere = true;
    for (const p of parts.slice(1)) {
      const g = p.fs.find((h) => keyOf(h.b) === k && isN(h.e) && h.e.q.sign > 0);
      if (!g) { everywhere = false; break; }
      if (g.e.q.compare(min) < 0) min = g.e.q;
    }
    if (everywhere) shared.push({ base: f.b, exp: N(min) });
  }
  let rest = s;
  if (!common.isOne || shared.length) {
    const divisor = mul([N(common), ...shared.map((f) => powFactor(f.base, f.exp))]);
    rest = add(terms.map((t) => mul([t, pow(divisor, N(Q.MINUS_ONE))])));
    notes.push({ id: 'factor.common', values: { common: divisor } });
  }
  const tail = rest.k === 'add' ? factorPolynomial(rest, notes) : factorForm(rest);
  return merge(common.mul(tail.coef), [...shared, ...tail.factors], [...notes, ...tail.notes.filter((n) => !notes.includes(n))]);
}

const asFactor = (f) => (f.k === 'mul' && f.c.isOne && f.fs.length === 1 ? { b: f.fs[0].b, e: f.fs[0].e } : { b: f, e: ONE });

const symbolsOf = (x) => freeSymbols(display(x));

/** A sum with nothing in common left: rational roots in one variable, or a difference of squares/cubes. */
function factorPolynomial(s, notes) {
  const vars = [...symbolsOf(s)];
  for (const v of vars) {
    const cs = rationalCoefficients(coefficients(s, v));
    if (!cs || cs.length < 3) continue;
    if (vars.length !== 1) break;
    const { roots, rest } = rationalRoots(cs);
    if (!roots.length) break;
    // v - p/q → (q v - p), whole numbers, so the factors read (2x - 1)
    const factors = [];
    let coef = rest[rest.length - 1] ?? Q.ONE;
    const restMonic = rest.map((c) => c.div(coef));
    // (x - 1)(x + 1), (x - 2)(x - 3): smaller roots first, a positive one before its negative
    const ordered = [...roots].sort((a, b) => a.abs().compare(b.abs()) || b.sign - a.sign);
    for (const r of ordered) {
      const base = fromCoefficients([new Q(-r.n), new Q(r.d)], v);
      factors.push({ base, exp: ONE });
      coef = coef.div(new Q(r.d));
      notes.push({ id: 'factor.root', values: { root: N(r), factor: base } });
    }
    if (restMonic.length > 1) {
      // make the leftover's coefficients whole, and move the number out
      const lcm = restMonic.reduce((l, c) => (l * c.d) / gcd(l, c.d), 1n);
      const whole = restMonic.map((c) => c.mul(new Q(lcm)));
      const g = whole.reduce((acc, c) => gcd(acc, c.n), 0n) || 1n;
      coef = coef.mul(new Q(g, lcm));
      factors.push({ base: fromCoefficients(whole.map((c) => c.div(new Q(g))), v), exp: ONE });
    }
    return merge(coef, factors, []);
  }
  // a² - b², a³ ± b³ (in any variables)
  const two = termsOf(s);
  if (two.length === 2) {
    const [a, b] = two;
    for (const n of [2, 3]) {
      const ra = nthRootOf(a, n);
      const rb = nthRootOf(neg(b), n);
      const rbPlus = n === 3 ? nthRootOf(b, n) : null;
      if (ra && rb && n === 2) {
        notes.push({ id: 'factor.squares', values: { a: ra, b: rb } });
        const f1 = factorForm(add([ra, neg(rb)]));
        const f2 = factorForm(add([ra, rb]));
        return merge(f1.coef.mul(f2.coef), [...f1.factors, ...f2.factors], [...f1.notes, ...f2.notes]);
      }
      if (n === 3 && ra && (rb || rbPlus)) {
        const r = rb ?? rbPlus;
        const sign = rb ? -1 : 1;   // a³ - b³ = (a - b)(a² + ab + b²); a³ + b³ = (a + b)(a² - ab + b²)
        notes.push({ id: sign < 0 ? 'factor.cubes-difference' : 'factor.cubes-sum', values: { a: ra, b: r } });
        const lin = sign < 0 ? add([ra, neg(r)]) : add([ra, r]);
        const quad = add([pow(ra, N(Q.of(2))), sign < 0 ? mul([ra, r]) : neg(mul([ra, r])), pow(r, N(Q.of(2)))]);
        const f1 = factorForm(lin);
        return merge(f1.coef, [...f1.factors, { base: quad, exp: ONE }], f1.notes);
      }
    }
  }
  return { coef: Q.ONE, factors: [{ base: s, exp: ONE }], notes: [] };
}

/** x^(1/n) when x is a perfect n-th power term (4x² → 2x), else null. */
function nthRootOf(x, n) {
  const { coef, rest } = splitCoef(x);
  if (coef.sign < 0) return null;
  const top = exactRootQ(coef, n);
  if (!top) return null;
  const parts = [N(top)];
  for (const f of rest ? factorsOf(rest).map(asFactor) : []) {
    if (!isN(f.e)) return null;
    const e = f.e.q.div(Q.of(n));
    if (!e.isInteger) return null;
    parts.push(powFactor(f.b, N(e)));
  }
  return mul(parts);
}

function exactRootQ(q, n) {
  const r = (x) => {
    if (x < 0n) return null;
    let lo = 0n;
    let hi = 1n;
    while (hi ** BigInt(n) <= x) hi *= 2n;
    while (lo < hi - 1n) {
      const mid = (lo + hi) / 2n;
      if (mid ** BigInt(n) <= x) lo = mid;
      else hi = mid;
    }
    return lo ** BigInt(n) === x ? lo : null;
  };
  const a = r(q.n);
  const b = r(q.d);
  return a !== null && b !== null ? new Q(a, b) : null;
}

/** A factored form drawn as is: 2(x - 1)(x + 1), -(x - 1), (x + 1)²/3. */
export function drawFactored({ coef, factors }) {
  const top = [];
  const bottom = [];
  for (const f of factors) {
    const negative = isN(f.exp) && f.exp.q.sign < 0;
    const e = negative ? N(f.exp.q.neg()) : f.exp;
    const node = display(powFactor(f.base, e));
    (negative ? bottom : top).push(node);
  }
  const product = (nodes) => nodes.reduce((acc, n) => (acc ? op('*', [acc, n]) : n), null);
  const n = coef.n < 0n ? -coef.n : coef.n;
  let numer = top.length ? product(n === 1n ? top : [display(N(new Q(n))), ...top]) : display(N(new Q(n)));
  if (coef.n < 0n) numer = op('neg', [numer]);
  if (coef.d !== 1n) bottom.unshift(display(N(new Q(coef.d))));
  return bottom.length ? op('/', [numer, product(bottom)]) : numer;
}

// ---- fractions -------------------------------------------------------------------------------

/** Split into numerator and denominator (factors with negative exponents go below). */
export function numerDenom(x) {
  if (x.k !== 'mul') return { num: x, den: ONE };
  const top = [N(new Q(x.c.n))];
  const bottom = [N(new Q(x.c.d))];
  for (const f of x.fs) {
    if (isN(f.e) && f.e.q.sign < 0) bottom.push(powFactor(f.b, N(f.e.q.neg())));
    else top.push(powFactor(f.b, f.e));
  }
  return { num: mul(top), den: mul(bottom) };
}

/** One fraction over a common denominator: 1/x + 1/y → (x + y)/(x y). Held as num/den. */
export function together(x) {
  if (x.k !== 'add') return numerDenom(x);
  const parts = termsOf(x).map(numerDenom);
  // least common denominator: each base with its largest power
  const lcd = new Map();
  let lcdCoef = 1n;
  for (const p of parts) {
    const { coef, rest } = splitCoef(p.den);
    lcdCoef = (lcdCoef * coef.n) / gcd(lcdCoef, coef.n);
    for (const f of rest ? factorsOf(rest).map(asFactor) : []) {
      const k = keyOf(f.b);
      const g = lcd.get(k);
      if (!g || (isN(f.e) && isN(g.e) && f.e.q.compare(g.e.q) > 0)) lcd.set(k, f);
    }
  }
  const den = mul([N(new Q(lcdCoef)), ...[...lcd.values()].map((f) => powFactor(f.b, f.e))]);
  if (isN(den) && den.q.isOne) return { num: x, den: ONE };
  const num = expand(add(parts.map((p) => mul([p.num, den, pow(p.den, N(Q.MINUS_ONE))]))));
  return { num, den };
}

/**
 * A fraction with common factors cancelled: (x² - 1)/(x - 1) → x + 1.
 * Returns the held factored form (and notes), or null when nothing cancels.
 */
export function cancel(x) {
  const { num, den } = together(x);
  if (isN(den) && den.q.isOne) return null;
  const a = factorForm(num);
  const b = factorForm(den);
  const keysA = new Set(a.factors.map((f) => keyOf(f.base)));
  const shared = b.factors.filter((f) => keysA.has(keyOf(f.base)));
  const factors = [...a.factors, ...b.factors.map((f) => ({ base: f.base, exp: neg(f.exp) }))];
  const merged = merge(a.coef.div(b.coef), factors, [...a.notes, ...b.notes]);
  return { ...merged, cancelled: shared.map((f) => f.base) };
}

export { CasError };
