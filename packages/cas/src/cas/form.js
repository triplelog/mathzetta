// The normal form: what every expression is turned into before and after each rule.
//
// Rules can't collect like terms (2x + 3x, x·x², √2·√2) reliably: commutativity
// and associativity make the shapes endless. So that part is code, the way SymPy
// does it on construction:
//
//   - numbers are exact fractions; 2^(1/2) stays a power, √72 becomes 6√2
//   - a sum is a constant plus coefficient·term, like terms collected
//   - a product is a coefficient times base^exponent, like bases combined
//   - a number times a sum is multiplied out (2(x + 1) → 2x + 2); nothing else is
//   - terms are ordered by degree (x² + 3x + 1), factors numbers-first (2√3 π x)
//
// Everything else (what sin, ln, d/dx … do) is rules. The internal form is only
// used in here: callers get @mathzetta/cas nodes (`display`), drawn the way MathZetta
// writes them (x/2, 2x - 3, -x, √x, ∛x), so rules match what people see.

import { op, sym, exactNum, isOp } from '../expr.js';
import { isOperator, getOperator } from '../ops.js';
import { Q, CasError, fromToken, extractPower, gcd, bitLength, MAX_BITS } from './rational.js';

// (a + bi)^n is multiplied out only up to this power, like real powers (poly.js MAX_EXPAND_POWER)
const MAX_COMPLEX_POWER = 60n;

/** Symbols that are numbers: they never count as unknowns. */
export const CONSTANTS = new Set(['pi', 'e', 'π']);

/**
 * Complex mode (createCAS({ complex: true })): the symbol i is the imaginary unit.
 * Off, i is an ordinary unknown (a sum's index, say). The CAS sets this around each call.
 */
export const settings = { complex: false };
export function withComplex(on, fn) {
  const saved = settings.complex;
  settings.complex = Boolean(on);
  try {
    return fn();
  } finally {
    settings.complex = saved;
  }
}
const isConstantSymbol = (token) => CONSTANTS.has(token) || (settings.complex && token === 'i');
/** i, the imaginary unit (in complex mode). */
export const isI = (x) => settings.complex && x.k === 'atom' && x.node.type === 'sym' && x.node.token === 'i';

// ---- the internal form ----------------------------------------------------------------
// { k: 'num', q }   { k: 'atom', node }   { k: 'add', c, terms: [{ coef, x }] }
// { k: 'mul', c, fs: [{ b, e }] }   (a power is a mul with one factor and c = 1)

export const N = (q) => ({ k: 'num', q });
const ONE = N(Q.ONE);
const ZERO = N(Q.ZERO);
const HALF = N(Q.HALF);
export const isN = (x) => x.k === 'num';
const atom = (node) => ({ k: 'atom', node });

const keys = new WeakMap();
/** A string equal for two expressions exactly when they are the same. */
export function keyOf(x) {
  let s = keys.get(x);
  if (s === undefined) keys.set(x, (s = display(x).s));
  return s;
}

/** Degree used to order terms: x² before x before constants. */
export function degree(x) {
  if (x.k === 'num') return 0;
  if (x.k === 'atom') return x.node.type === 'sym' ? (isConstantSymbol(x.node.token) ? 0 : 1) : 1;
  if (x.k === 'add') return Math.max(...x.terms.map((t) => degree(t.x)));
  let d = 0;
  for (const f of x.fs) {
    const bd = degree(f.b);
    if (bd) d += bd * (isN(f.e) ? f.e.q.toNumber() : 1);
  }
  return d;
}

/** Factors: numbers (radicals) first, then π and e, then i, then unknowns, then functions (e^x counts as one), then sums. */
function factorRank(b, e) {
  if (b.k === 'num') return e && !isN(e) ? 3 : 0;
  if (isI(b)) return 1.5;
  if (b.k === 'atom' && b.node.type === 'sym') return isConstantSymbol(b.node.token) ? (e && !isN(e) ? 3 : 1) : 2;
  if (b.k === 'atom') return 3;
  return 4;
}

const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Each unknown's power in a term: 3x²y → { x: 2, y: 1 }. */
function powers(x) {
  const out = new Map();
  const visit = (b, e) => {
    if (b.k === 'atom' && b.node.type === 'sym' && !isConstantSymbol(b.node.token)) out.set(b.node.token, (out.get(b.node.token) ?? 0) + e);
  };
  if (x.k === 'mul') for (const f of x.fs) visit(f.b, isN(f.e) ? f.e.q.toNumber() : 1);
  else visit(x, 1);
  return out;
}

/** Highest degree first; then by each unknown in turn (a³ + 3a²b + 3ab² + b³); then by text. */
function termOrder(a, b) {
  const d = degree(b.x) - degree(a.x);
  if (d) return d;
  const pa = powers(a.x);
  const pb = powers(b.x);
  for (const v of [...new Set([...pa.keys(), ...pb.keys()])].sort()) {
    const diff = (pb.get(v) ?? 0) - (pa.get(v) ?? 0);
    if (diff) return diff;
  }
  return byKey(keyOf(a.x), keyOf(b.x));
}

// ---- building --------------------------------------------------------------------------

/** coef · x, for a non-number x. */
function scale(coef, x) {
  if (coef.isOne) return x;
  if (coef.isZero) return ZERO;
  return mul([N(coef), x]);
}

/** x as coefficient and the rest (a mul with c = 1, or an atom/power). */
export function splitCoef(x) {
  if (x.k === 'num') return { coef: x.q, rest: null };
  if (x.k !== 'mul' || x.c.isOne) return { coef: Q.ONE, rest: x };
  const rest = x.fs.length === 1 && isN(x.fs[0].e) && x.fs[0].e.q.isOne ? x.fs[0].b : { k: 'mul', c: Q.ONE, fs: x.fs };
  return { coef: x.c, rest };
}

export function add(items) {
  let c = Q.ZERO;
  const terms = new Map();
  const push = (coef, x) => {
    const k = keyOf(x);
    const t = terms.get(k);
    if (t) t.coef = t.coef.add(coef);
    else terms.set(k, { coef, x });
  };
  for (const it of items) {
    if (it.k === 'num') c = c.add(it.q);
    else if (it.k === 'add') {
      c = c.add(it.c);
      for (const t of it.terms) push(t.coef, t.x);
    } else {
      const { coef, rest } = splitCoef(it);
      push(coef, rest);
    }
  }
  const list = [...terms.values()].filter((t) => !t.coef.isZero);
  if (!list.length) return N(c);
  if (c.isZero && list.length === 1) return scale(list[0].coef, list[0].x);
  list.sort(termOrder);
  return { k: 'add', c, terms: list };
}

/** n^r for a rational n and an exponent: { coef, fs } with fs the factors left over. */
function numPow(q, e) {
  if (!isN(e)) return q.isOne ? { coef: Q.ONE, fs: [] } : { coef: Q.ONE, fs: [{ b: N(q), e }] };
  const r = e.q;
  if (r.isInteger) return { coef: q.pow(r.n), fs: [] };
  if (q.isZero) {
    if (r.sign < 0) throw new CasError('division by zero');
    return { coef: Q.ZERO, fs: [] };
  }
  if (q.isOne) return { coef: Q.ONE, fs: [] };
  if (q.sign < 0) {
    // An odd root of a negative number is real: ∛(-8) = -2. An even one is not, so it stays.
    if (r.d % 2n === 1n) {
      const { coef, fs } = numPow(q.neg(), e);
      return { coef: r.n % 2n === 0n ? coef : coef.neg(), fs };
    }
    // complex: (-q)^(p/2) = q^(p/2) · i^p, so √-4 = 2i
    if (settings.complex && r.d === 2n) {
      const { coef, fs } = numPow(q.neg(), e);
      return { coef, fs: [...fs, { b: I, e: N(new Q(r.n)) }] };
    }
    return { coef: Q.ONE, fs: [{ b: N(q), e }] };
  }
  if (!q.isInteger) {
    const top = numPow(new Q(q.n), e);
    const bottom = numPow(new Q(q.d), N(r.neg()));
    return { coef: top.coef.mul(bottom.coef), fs: [...top.fs, ...bottom.fs] };
  }
  // n^(k + a/s) = n^k · (n^a)^(1/s), and (n^a)^(1/s) = outside · inside^(1/s)
  const whole = r.floor();
  const frac = r.sub(whole);
  // 2^(99999999/100000000): n^a would be enormous (and its s-th root no simpler): leave it as written
  if (BigInt(bitLength(q.n)) * frac.n > BigInt(MAX_BITS) || frac.d > 1000n) return { coef: Q.ONE, fs: [{ b: N(q), e }] };
  let coef = whole.isZero ? Q.ONE : q.pow(whole.n);
  const { outside, inside } = extractPower(q.n ** frac.n, Number(frac.d));
  coef = coef.mul(new Q(outside));
  const fs = inside > 1n ? [{ b: N(new Q(inside)), e: N(new Q(1n, frac.d)) }] : [];
  return { coef, fs };
}

export function mul(items) {
  let c = Q.ONE;
  const fs = new Map();
  const push = (b, e) => {
    const k = keyOf(b);
    const f = fs.get(k);
    if (f) f.e = add([f.e, e]);
    else fs.set(k, { b, e });
  };
  for (const it of items) {
    if (it.k === 'num') c = c.mul(it.q);
    else if (it.k === 'mul') {
      c = c.mul(it.c);
      for (const f of it.fs) push(f.b, f.e);
    } else push(it, ONE);
  }
  if (c.isZero) return ZERO;
  const out = [];
  // Numbers with the same fractional power multiply under one root: √2·√3 = √6.
  const radicals = new Map();
  for (const f of fs.values()) {
    if (isN(f.e) && f.e.q.isZero) continue;
    if (f.b.k === 'num') {
      if (isN(f.e) && !f.e.q.isInteger && f.b.q.sign > 0 && f.b.q.isInteger) {
        const k = f.e.q.toString();
        const r = radicals.get(k);
        if (r) r.n *= f.b.q.n;
        else radicals.set(k, { n: f.b.q.n, e: f.e });
        continue;
      }
      const p = numPow(f.b.q, f.e);
      c = c.mul(p.coef);
      out.push(...p.fs);
      continue;
    }
    // (x^(1/2))^2 and friends arrive as a power of a power: x^(a·b) when b is whole.
    if (f.b.k === 'mul' && isN(f.e) && f.e.q.isInteger) {
      const inner = pow(f.b, f.e);
      if (inner.k === 'mul') {
        c = c.mul(inner.c);
        out.push(...inner.fs);
      } else if (inner.k === 'num') c = c.mul(inner.q);
      else out.push({ b: inner, e: ONE });
      continue;
    }
    out.push(f);
  }
  for (const { n, e } of radicals.values()) {
    const p = numPow(new Q(n), e);
    c = c.mul(p.coef);
    out.push(...p.fs);
  }
  if (c.isZero) return ZERO;
  // Pieces of radicals may now share a base with each other: merge once more.
  const merged = new Map();
  for (const f of out) {
    const k = keyOf(f.b);
    const m = merged.get(k);
    if (m) m.e = add([m.e, f.e]);
    else merged.set(k, { ...f });
  }
  let list = [...merged.values()].filter((f) => !(isN(f.e) && f.e.q.isZero));
  // i² = -1: a whole power of i is 1, i, -1 or -i
  if (settings.complex) {
    list = list.flatMap((f) => {
      if (!isI(f.b) || !isN(f.e) || !f.e.q.isInteger) return [f];
      const k = ((f.e.q.n % 4n) + 4n) % 4n;
      if (k >= 2n) c = c.neg();
      return k % 2n ? [{ b: f.b, e: ONE }] : [];
    });
    // complex numbers multiplied together are multiplied out: (2 + 3i)(1 - i) = 5 + i
    const complexSums = list.filter((f) => f.b.k === 'add' && isN(f.e) && f.e.q.isInteger && isComplexConstant(f.b));
    const hasUnit = list.some((f) => isI(f.b));
    const small = complexSums.every((f) => (f.e.q.sign < 0 ? -f.e.q.n : f.e.q.n) <= MAX_COMPLEX_POWER);
    if (complexSums.length && small && (complexSums.length > 1 || hasUnit || !complexSums[0].e.q.isOne)) {
      const rest = list.filter((f) => !complexSums.includes(f) && !isI(f.b));
      let product = hasUnit ? [I] : [ONE];
      for (const f of complexSums) {
        const base = f.e.q.sign < 0 ? reciprocal(f.b) : f.b;
        for (let i = 0n; i < (f.e.q.sign < 0 ? -f.e.q.n : f.e.q.n); i++) product = multiplyOut(product, termsOf(base));
      }
      return mul([N(c), add(product), ...rest.map((f) => powFactor(f.b, f.e))]);
    }
  }
  // A number's powers merged past 1 (√2 · 2^(2/3) = 2^(7/6)) are worked out once more.
  if (list.some((f) => f.b.k === 'num' && isN(f.e) && f.e.q.compare(Q.ONE) >= 0)) {
    return mul([N(c), ...list.map((f) => (f.b.k === 'num' ? pow(f.b, f.e) : { k: 'mul', c: Q.ONE, fs: [f] }))]);
  }
  if (!list.length) return N(c);
  // A number times one sum is multiplied out: 2(x + 1) = 2x + 2.
  if (list.length === 1 && !c.isOne && list[0].b.k === 'add' && isN(list[0].e) && list[0].e.q.isOne) {
    const s = list[0].b;
    return add([N(c.mul(s.c)), ...s.terms.map((t) => scale(c.mul(t.coef), t.x))]);
  }
  if (c.isOne && list.length === 1 && isN(list[0].e) && list[0].e.q.isOne) return list[0].b;
  list = list.sort((a, b) => factorRank(a.b, a.e) - factorRank(b.b, b.e) || byKey(keyOf(a.b), keyOf(b.b)));
  return { k: 'mul', c, fs: list };
}

export function pow(b, e) {
  if (settings.complex && isN(e) && e.q.isInteger) {
    if (isI(b)) return mul([{ k: 'mul', c: Q.ONE, fs: [{ b, e }] }]);
    if (b.k === 'add' && isComplexConstant(b) && !e.q.isOne) return mul([{ k: 'mul', c: Q.ONE, fs: [{ b, e }] }]);
  }
  if (isN(e)) {
    if (e.q.isZero) {
      if (isN(b) && b.q.isZero) throw new CasError('0^0 is undefined');
      return ONE;
    }
    if (e.q.isOne) return b;
  }
  if (isN(b)) {
    const p = numPow(b.q, e);
    if (!p.fs.length) return N(p.coef);
    if (p.fs.some((f) => isI(f.b))) return mul([N(p.coef), ...p.fs.map((f) => ({ k: 'mul', c: Q.ONE, fs: [f] }))]);
    const x = { k: 'mul', c: p.coef, fs: p.fs };
    return p.coef.isOne && p.fs.length === 1 && isN(p.fs[0].e) && p.fs[0].e.q.isOne ? p.fs[0].b : x;
  }
  // complex: √(a + bi) = √((|z| + a)/2) ± i√((|z| - a)/2), the sign of b (b a number)
  if (settings.complex && isN(e) && e.q.d === 2n && isComplexConstant(b)) {
    const p = complexParts(b);
    if (p && isN(p.im) && !p.im.q.isZero) {
      const square = (x) => pow(x, N(Q.of(2)));
      const size = pow(add([square(p.re), square(p.im)]), HALF);
      const re = pow(mul([add([size, p.re]), N(Q.HALF)]), HALF);
      const im = pow(mul([add([size, neg(p.re)]), N(Q.HALF)]), HALF);
      const root = add([re, mul([N(Q.of(p.im.q.sign)), im, I])]);
      return pow(root, N(new Q(e.q.n)));
    }
  }
  if (b.k === 'mul') {
    if (isN(e) && e.q.isInteger) {
      return mul([N(b.c.pow(e.q.n)), ...b.fs.map((f) => powFactor(f.b, mul([f.e, e])))]);
    }
    // (4x)^(1/2) = 2·x^(1/2): a positive number comes out of any power.
    if (!b.c.isOne && b.c.sign > 0) return mul([pow(N(b.c), e), pow({ k: 'mul', c: Q.ONE, fs: b.fs }, e)]);
    // (x^a)^b keeps its shape (√(x²) is |x|, not x) unless the outer exponent is whole.
    if (b.c.isOne && b.fs.length === 1) {
      const [f] = b.fs;
      if (isN(f.e) && isN(e) && f.e.q.n === 1n && f.e.q.d % 2n === 1n) return powFactor(f.b, mul([f.e, e]));
    }
  }
  return { k: 'mul', c: Q.ONE, fs: [{ b, e }] };
}

/** b^e as a factor (no rewriting of b). */
export function powFactor(b, e) {
  if (isN(e) && e.q.isZero) return ONE;
  if (isN(b)) return pow(b, e);
  if (isN(e) && e.q.isOne) return b;
  return { k: 'mul', c: Q.ONE, fs: [{ b, e }] };
}

// ---- complex numbers -----------------------------------------------------------------------

const I = atom(sym('i'));
export const imaginaryUnit = () => I;

/** Does x mention i (complex mode)? */
const mentionsI = (x) => settings.complex && display(x).s.split(' ').includes('i');
/** A sum of constants with i in it: 2 + 3i, √2 - i. */
function isComplexConstant(x) {
  return settings.complex && mentionsI(x) && freeSymbols(display(x)).size === 0;
}

function multiplyOut(left, right) {
  const out = [];
  for (const a of left) for (const b of right) out.push(mul([a, b]));
  return termsOf(add(out));
}

/**
 * x = re + im·i with re and im free of i (unknowns count as real), or null when
 * i sits somewhere it can't be taken out (inside a function, under a root).
 */
export function complexParts(x) {
  const re = [];
  const im = [];
  for (const t of termsOf(x)) {
    const { coef, rest } = splitCoef(t);
    const fs = rest ? factorsOf(rest) : [];
    const unit = fs.filter((f) => isI(f));
    const others = fs.filter((f) => !isI(f));
    if (others.some((f) => mentionsI(f))) return null;
    (unit.length ? im : re).push(mul([N(coef), ...others]));
  }
  return { re: add(re), im: add(im) };
}

/** 1/(a + bi) = (a - bi)/(a² + b²). */
function reciprocal(z) {
  const p = complexParts(z);
  if (!p) return pow(z, N(Q.MINUS_ONE));
  const norm = add([pow(p.re, N(Q.of(2))), pow(p.im, N(Q.of(2)))]);
  return mul([add([p.re, mul([N(Q.MINUS_ONE), p.im, I])]), pow(norm, N(Q.MINUS_ONE))]);
}

/** Re, Im, conjugate, argument and size of complex numbers (unknowns count as real). */
const COMPLEX_FOLDS = {
  re: ([z]) => complexParts(z)?.re ?? null,
  im: ([z]) => complexParts(z)?.im ?? null,
  conj: ([z]) => {
    const p = complexParts(z);
    return p ? add([p.re, mul([N(Q.MINUS_ONE), p.im, I])]) : null;
  },
  arg: ([z]) => {
    const p = complexParts(z);
    return p ? fn('atan2', [p.im, p.re]) : null;
  },
  abs: ([z]) => {
    const p = complexParts(z);
    if (!p || (isN(p.im) && p.im.q.isZero)) return null;
    return pow(add([pow(p.re, N(Q.of(2))), pow(p.im, N(Q.of(2)))]), HALF);
  },
};

/** MathZetta's spellings of the complex functions (\operatorname{Re}(z) is z 1 \:Re). */
export const COMPLEX_NAMES = { Re: 're', re: 're', Im: 'im', im: 'im', conj: 'conj', overline: 'conj', bar: 'conj', arg: 'arg' };

export const neg = (x) => mul([N(Q.MINUS_ONE), x]);
export const sub = (a, b) => add([a, neg(b)]);
export const div = (a, b) => mul([a, pow(b, N(Q.MINUS_ONE))]);

// ---- exact folds of functions of numbers ------------------------------------------------

const factorialLimit = 3000n;
const FOLDS = {
  // |−3| = 3, |−2x| = 2|x|
  abs: ([x]) => (isN(x) ? N(x.q.abs()) : x.k === 'mul' && !x.c.isOne ? mul([N(x.c.abs()), fn('abs', [splitCoef(x).rest])]) : null),
  floor: ([x]) => (isN(x) ? N(x.q.floor()) : null),
  ceil: ([x]) => (isN(x) ? N(x.q.ceil()) : null),
  '!': ([x]) => {
    if (!isN(x) || !x.q.isInteger || x.q.sign < 0 || x.q.n > factorialLimit) return null;
    let r = 1n;
    for (let i = 2n; i <= x.q.n; i++) r *= i;
    return N(new Q(r));
  },
  mod: ([a, b]) => (isN(a) && isN(b) && !b.q.isZero ? N(a.q.sub(b.q.mul(a.q.div(b.q).floor()))) : null),
  max: (xs) => (xs.every(isN) && xs.length ? xs.reduce((m, x) => (x.q.compare(m.q) > 0 ? x : m)) : null),
  min: (xs) => (xs.every(isN) && xs.length ? xs.reduce((m, x) => (x.q.compare(m.q) < 0 ? x : m)) : null),
  gcd: (xs) => (xs.length && xs.every((x) => isN(x) && x.q.isInteger) ? N(new Q(xs.reduce((g, x) => gcd(g, x.q.n), 0n))) : null),
  // log_2 8 = 3, log_10 0.001 = -3, log_4 2 = 1/2, log_8 4 = 2/3: estimated in floating point, then checked exactly
  log: ([b, x]) => {
    if (!isN(b) || !isN(x) || b.q.sign <= 0 || x.q.sign <= 0 || b.q.isOne) return null;
    if (x.q.isOne) return ZERO;
    const t = Math.log(x.q.toNumber()) / Math.log(b.q.toNumber());
    if (!Number.isFinite(t)) return null;
    for (let d = 1; d <= 12; d++) {
      const n = Math.round(t * d);
      if (Math.abs(t * d - n) > 1e-9 || n === 0) continue;
      // b^(n/d) = x  ⇔  b^n = x^d
      if (Math.abs(n) <= 256 && b.q.pow(BigInt(n)).equals(x.q.pow(BigInt(d)))) return N(new Q(BigInt(n), BigInt(d)));
    }
    return null;
  },
  comb: ([n, k]) => (isN(n) && isN(k) && n.q.isInteger && k.q.isInteger && n.q.sign >= 0 && k.q.sign >= 0 && n.q.n <= factorialLimit ? N(choose(n.q.n, k.q.n)) : null),
  perm: ([n, k]) => {
    if (!(isN(n) && isN(k) && n.q.isInteger && k.q.isInteger && n.q.sign >= 0 && k.q.sign >= 0 && n.q.n <= factorialLimit)) return null;
    if (k.q.n > n.q.n) return ZERO;
    let r = 1n;
    for (let i = 0n; i < k.q.n; i++) r *= n.q.n - i;
    return N(new Q(r));
  },
};

function choose(n, k) {
  if (k > n) return Q.ZERO;
  if (k > n - k) k = n - k;
  let r = 1n;
  for (let i = 1n; i <= k; i++) r = (r * (n - k + i)) / i;
  return new Q(r);
}

/** A function applied to canonical arguments: folded when exact, else an atom. */
export function fn(name, args) {
  if (settings.complex && COMPLEX_FOLDS[name]) {
    const v = COMPLEX_FOLDS[name](args);
    if (v) return v;
  }
  const fold = FOLDS[name];
  if (fold) {
    const v = fold(args);
    if (v) return v;
  }
  return atom(op(name, args.map(display)));
}

// ---- nodes in, nodes out ----------------------------------------------------------------

const memo = new Map();

/** A @mathzetta/cas node (any postfix) → the internal normal form. */
export function canon(node) {
  const key = settings.complex ? `ℂ ${node.s}` : node.s;
  const hit = memo.get(key);
  if (hit) return hit;
  const out = build(node);
  if (memo.size > 20000) memo.clear();
  memo.set(key, out);
  return out;
}

function build(node) {
  if (node.type === 'num') {
    const q = fromToken(node.token);
    if (!q) throw new CasError(`not an exact number: ${node.token}`);
    return N(q);
  }
  if (node.type === 'sym') {
    if (node.token === 'π') return atom(sym('pi'));
    return atom(node);
  }
  const a = node.args.map(canon);
  switch (node.op) {
    case '+': return add(a);
    case '-': return sub(a[0], a[1]);
    case 'neg': return neg(a[0]);
    case '*': return mul(a);
    case '/': return div(a[0], a[1]);
    case '^': return pow(a[0], a[1]);
    case 'sqrt': return pow(a[0], HALF);
    case 'root': return pow(a[1], pow(a[0], N(Q.MINUS_ONE)));
    default: {
      // f(x) as MathZetta writes a function it doesn't know (x 1 \:sinc) is the operator, once a rule file declares it
      const name = node.op.startsWith('\\:') ? node.op.slice(2) : null;
      if (name && settings.complex && COMPLEX_NAMES[name] && a.length === 1) return fn(COMPLEX_NAMES[name], a);
      if (name && isOperator(name) && getOperator(name).arity === a.length) return fn(name, a);
      return fn(node.op, a);
    }
  }
}

/** Canonical node: the normal form drawn back as postfix. */
export const normal = (node) => display(canon(node));

const numNode = (n) => exactNum(String(n));

/** A rational as MathZetta writes it: 3, -2, 1 2 / (½), -1 2 / (-½). */
export function qNode(q) {
  return q.isInteger ? numNode(q.n) : op('/', [numNode(q.n), numNode(q.d)]);
}

const displays = new WeakMap();
/** The internal form → a @mathzetta/cas node. */
export function display(x) {
  let n = displays.get(x);
  if (!n) displays.set(x, (n = draw(x)));
  return n;
}

function draw(x) {
  switch (x.k) {
    case 'num': return qNode(x.q);
    case 'atom': return x.node;
    case 'mul': return drawMul(x.c, x.fs);
    case 'add': return drawAdd(x);
    default: throw new Error(`bad form ${x.k}`);
  }
}

/** base^e for e > 0: √b, ∛b, b^e. */
function drawPower(b, e) {
  const base = display(b);
  if (isN(e)) {
    const r = e.q;
    if (r.isOne) return base;
    if (r.n === 1n && r.d === 2n) return op('sqrt', [base]);
    if (r.n === 1n) return op('root', [numNode(r.d), base]);
  }
  return op('^', [base, display(e)]);
}

const product = (nodes) => nodes.reduce((acc, n) => (acc ? op('*', [acc, n]) : n), null);

function drawMul(c, fs) {
  const top = [];
  const bottom = [];
  for (const f of fs) {
    if (isN(f.e) && f.e.q.sign < 0) bottom.push(drawPower(f.b, N(f.e.q.neg())));
    else top.push(drawPower(f.b, f.e));
  }
  // -2x is "-2 x *"; -x is "x neg"
  const unit = c.n === 1n || c.n === -1n;
  let numer = unit && top.length ? product(top) : product([numNode(c.n), ...top]);
  if (c.n === -1n && top.length) numer = op('neg', [numer]);
  if (c.d !== 1n) bottom.unshift(numNode(c.d));
  return bottom.length ? op('/', [numer, product(bottom)]) : numer;
}

function drawAdd(x) {
  let acc = null;
  // 2 + 3i, x + 1 - i: the imaginary constants come after the real one
  const imaginary = (t) => settings.complex && mentionsI(t.x) && freeSymbols(display(t.x)).size === 0;
  const terms = [...x.terms.filter((t) => !imaginary(t)), ...x.terms.filter(imaginary)];
  const constant = x.c;
  const pushConstant = () => {
    if (constant.isZero) return;
    acc = !acc ? qNode(constant) : constant.sign < 0 ? op('-', [acc, qNode(constant.neg())]) : op('+', [acc, qNode(constant)]);
  };
  let placed = false;
  for (const t of terms) {
    if (!placed && imaginary(t)) {
      pushConstant();
      placed = true;
    }
    if (!acc) acc = display(scale(t.coef, t.x));
    else if (t.coef.sign < 0) acc = op('-', [acc, display(scale(t.coef.neg(), t.x))]);
    else acc = op('+', [acc, display(scale(t.coef, t.x))]);
  }
  if (!placed) pushConstant();
  return acc;
}

// ---- questions about expressions ---------------------------------------------------------

/** The unknowns in a node (π and e are numbers). */
export function freeSymbols(node, out = new Set()) {
  if (node.type === 'sym') {
    if (!isConstantSymbol(node.token)) out.add(node.token);
  } else if (isOp(node)) {
    for (const a of node.args) freeSymbols(a, out);
  }
  return out;
}

export const hasSymbol = (node, v) => freeSymbols(node).has(v);

/** The terms of a sum (a single term when it isn't one), in the internal form. */
export function termsOf(x) {
  if (x.k !== 'add') return [x];
  const out = x.terms.map((t) => scale(t.coef, t.x));
  if (!x.c.isZero) out.push(N(x.c));
  return out;
}

/** The factors of a product as internal forms (the coefficient first, when it isn't 1). */
export function factorsOf(x) {
  if (x.k === 'num') return [x];
  if (x.k !== 'mul') return [x];
  const out = x.c.isOne ? [] : [N(x.c)];
  for (const f of x.fs) out.push(powFactor(f.b, f.e));
  return out;
}

export { Q, CasError };
