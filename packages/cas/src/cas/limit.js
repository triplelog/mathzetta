// Limits, exactly, with the steps a calculus course shows.
//
//   1. continuous at the point: put it in
//   2. otherwise the limit of each part, with ±∞ tracked (a sum, a product, a quotient, a power, a function);
//      where that meets an indeterminate form:
//        0/0       cancel a common factor (a fraction of polynomials), else L'Hôpital's rule
//        ∞/∞       a fraction of polynomials at ±∞: the leading terms; else L'Hôpital's rule
//        0·∞       written as a quotient, a/(1/b)
//        ∞ − ∞     written as one fraction
//        1^∞, 0^0, ∞^0   e^(g·ln f): the limit of the exponent
//      c/0 is ±∞ by the sign on each side, and a two-sided limit whose sides differ does not exist
//      sin and cos of something that has no limit stay bounded: times 0, or over ∞, that is 0 (squeeze)
//      ∞/∞ at ±∞ with roots or a bounded part: divide top and bottom by the power of x the bottom grows like
//   3. the answer is held to numbers near the point: if they disagree, no answer is given rather than a wrong one.

import { op, sym, isOp, isNum, exactNum } from '../expr.js';
import { N, canon, display, normal, freeSymbols, CasError } from './form.js';
import { together, coefficients, rationalCoefficients, mentions } from './poly.js';
import { substitute } from './solve.js';
import { approximate } from './approx.js';

const MAX_DEPTH = 8;
const POLES = { tan: 'cos', sec: 'cos', csc: 'sin', cot: 'sin' };

/** No limit: the sides differ, or it oscillates. */
export class NoLimit extends Error {}

/** A limit value: { fin: node } a number, or { inf: 1 | -1 }. */
const fin = (node) => ({ fin: node });
/** Bounded, with no limit of its own: sin and cos of something that keeps growing or swinging. */
const BOUNDED = { bnd: true };
const inf = (sign) => ({ inf: sign });
const INF = sym('∞');
const isZeroNode = (n) => isNum(n) && Number(n.value) === 0;

/** The value of a constant node as a double (NaN when it has none). */
function value(node) {
  try {
    const r = approximate(node, { digits: 15 });
    return Math.abs(r.im ?? 0) > 1e-12 ? NaN : r.re ?? r.number;
  } catch {
    return NaN;
  }
}

/** f at a number t near the point (a double), or NaN. */
function at(f, v, t) {
  if (!Number.isFinite(t)) return NaN;
  return value(substitute(f, v, exactNum(plain(t))));
}

/** A double as a plain decimal (the number reader takes no exponent): 1e-7 → '0.0000001000000000000'. */
function plain(t) {
  const places = Math.min(40, Math.max(0, 16 - Math.floor(Math.log10(Math.abs(t) || 1))));
  return t.toFixed(places);
}

/** Where f settles as v nears the point from one side (a double), or NaN when it doesn't. */
function settles(f, v, a, side) {
  const ys = approach(a, side).map((t) => at(f, v, t)).filter(Number.isFinite);
  if (ys.length < 3) return NaN;
  const [p, q, r] = ys.slice(-3);
  const scale = Math.max(1, Math.abs(r));
  return Math.abs(r - q) < 1e-4 * scale && Math.abs(q - p) < 1e-2 * scale ? r : NaN;
}

/** Numbers approaching the point from one side: side +1 from above, -1 from below; a = ±∞ goes out. */
function approach(a, side) {
  if (a.inf) return [1e2, 1e3, 1e4, 1e5, 1e6].map((t) => t * a.inf);
  const c = value(a.fin);
  return [1e-3, 1e-4, 1e-5, 1e-6, 1e-7].map((h) => c + side * h * Math.max(1, Math.abs(c)));
}

/** The sign f keeps as it nears the point from that side: +1, -1, or 0 when it can't be told. */
function signNear(f, v, a, side) {
  const ys = approach(a, side).map((t) => at(f, v, t)).filter(Number.isFinite);
  if (!ys.length) return 0;
  const s = Math.sign(ys[ys.length - 1]);
  return ys.slice(-3).every((y) => Math.sign(y) === s) ? s : 0;
}

/**
 * lim f as v → a. a: { fin: node } or { inf: ±1 }; side: 0 both, +1 from above, -1 from below.
 * @returns {{ value: { fin } | { inf }, steps }}
 * @throws {NoLimit} when there is none; CasError when it can't be found
 */
export function findLimit(cas, f, v, a, side = 0) {
  const steps = [];
  // two sides that settle on different numbers (|x|/x at 0): no limit, whatever the parts say
  if (!side && !a.inf) {
    const [left, right] = [settles(f, v, a, -1), settles(f, v, a, 1)];
    if (Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) > 1e-3 * Math.max(1, Math.abs(left), Math.abs(right))) {
      throw new NoLimit(`from the left it goes to ${+left.toPrecision(6)}, from the right to ${+right.toPrecision(6)}`);
    }
  }
  const L = new Limits(cas, v, a, side, steps);
  let result;
  try {
    result = L.of(normal(f), 0);
    if (result.bnd) throw new NoLimit('it keeps swinging between bounds');
  } catch (error) {
    // "no limit" must agree with the numbers too: sides that settle on one value say otherwise
    if (error instanceof NoLimit) {
      const sides = a.inf ? [a.inf] : side ? [side] : [-1, 1];
      const ends = sides.map((s) => settles(f, v, a, s));
      if (ends.every(Number.isFinite) && ends.every((e) => Math.abs(e - ends[0]) < 1e-6 * Math.max(1, Math.abs(e)))) {
        throw new CasError(`numbers near the point settle on ${+ends[0].toPrecision(6)}: not answered`);
      }
    }
    throw error;
  }
  verify(f, v, a, side, result);
  return { value: result, steps };
}

class Limits {
  constructor(cas, v, a, side, steps) {
    Object.assign(this, { cas, v, a, side, steps });
    this.point = a.inf ? (a.inf > 0 ? INF : sym('-∞')) : a.fin;
  }

  step(id, name, from, to, values = {}) {
    this.steps.push(this.cas.step(id, name, ['limit'], from, to, { v: sym(this.v), a: this.point, ...values }));
  }

  /** The limit of f (a node in normal form). */
  of(f, depth) {
    if (depth > MAX_DEPTH) throw new CasError('this limit went too deep');
    const { v, a } = this;
    if (!freeSymbols(f).has(v)) return fin(f);
    if (f.type === 'sym') return a.inf ? inf(a.inf) : fin(a.fin);
    // continuous here: put the point in
    // a polynomial at ±∞: its leading term decides
    if (a.inf) {
      const p = rationalCoefficients(coefficients(canon(f), v));
      if (p && p.length > 1) {
        const n = p.length - 1;
        const sign = p[n].sign * (n % 2 && a.inf < 0 ? -1 : 1);
        if (depth === 0) this.step('limit.leading', 'The leading term', f, normal(op('*', [display(N(p[n])), op('^', [sym(v), exactNum(String(n))])])), { f, lead: normal(op('*', [display(N(p[n])), op('^', [sym(v), exactNum(String(n))])])) });
        return inf(sign);
      }
    }
    if (!a.inf && depth === 0) {
      // tested as written first: the normal form would cancel sin 0 / sin 0 to 1
      const raw = substitute(f, v, a.fin);
      let put = null;
      if (Number.isFinite(value(raw)) && !this.pole(raw) && !zeroBelow(raw)) try { put = normal(raw); } catch { /* 1/0, 0^0: not continuous here */ }
      if (put && Number.isFinite(value(put))) {
        const done = this.cas.simplify(put, { steps: false }).result;
        this.step('limit.substitute', 'Put the point in', f, done, { f });
        return fin(done);
      }
    }
    if (!isOp(f)) return fin(f);
    switch (f.op) {
      case '+': case '-': return this.sum(f, depth);
      case 'neg': return negate(this.of(f.args[0], depth + 1));
      case '*': return this.product(f, depth);
      case '/': return this.quotient(f, f.args[0], f.args[1], depth);
      case '^': return this.power(f, depth);
      default: return this.func(f, depth);
    }
  }

  /** Does a tan, sec, csc or cot in n (with the point put in) sit where its cos or sin is exactly 0? */
  pole(n) {
    return walkNodes(n).some((m) => isOp(m) && POLES[m.op] && this.isExactZero(op(POLES[m.op], [m.args[0]])));
  }

  isExactZero(n) {
    try { const z = this.cas.simplify(normal(n), { steps: false }).result; return isNum(z) && Number(z.value) === 0; } catch { return false; }
  }

  sum(f, depth) {
    const [x, y] = f.args;
    let lx;
    let ly0;
    try {
      lx = this.of(x, depth + 1);
      ly0 = this.of(y, depth + 1);
    } catch (error) {
      // a part with no limit of its own (1/x − 1/sin x at 0): together they may have one
      if (!(error instanceof NoLimit)) throw error;
      const parts = together(canon(f));
      const one = normal(op('/', [display(parts.num), display(parts.den)]));
      if (one.s === f.s) throw error;
      this.step('limit.combine', 'One fraction', f, one, { f });
      return this.of(one, depth + 1);
    }
    const ly = f.op === '-' ? negate(ly0) : ly0;
    if (lx.bnd || ly.bnd) return lx.inf || ly.inf ? (lx.inf ? lx : ly) : BOUNDED;   // bounded plus ∞ is ∞
    if (lx.fin && ly.fin) return fin(normal(op('+', [lx.fin, ly.fin])));
    if (lx.inf && ly.inf && lx.inf !== ly.inf) {
      // ∞ − ∞ with a root: times the conjugate over itself, (A − B)(A + B)/(A + B) = (A² − B²)/(A + B)
      const B = f.op === '-' ? y : op('neg', [y]);
      if ([x, y].some((t) => isOp(t) && t.op === 'sqrt') || (isOp(y) && y.op === 'neg' && isOp(y.args[0]) && y.args[0].op === 'sqrt')) {
        const conj = normal(op('/', [op('-', [op('^', [x, exactNum('2')]), op('^', [B, exactNum('2')])]), op('+', [x, B])]));
        this.step('limit.conjugate', '∞ − ∞: the conjugate', f, conj, { f });
        return this.of(conj, depth + 1);
      }
      // otherwise: one fraction
      const parts = together(canon(f));
      const one = normal(op('/', [display(parts.num), display(parts.den)]));
      if (one.s === f.s) throw new CasError('∞ − ∞ that does not become one fraction');
      this.step('limit.combine', '∞ − ∞: one fraction', f, one, { f });
      return this.of(one, depth + 1);
    }
    return lx.inf ? lx : ly;
  }

  product(f, depth) {
    const [x, y] = f.args;
    const lx = this.of(x, depth + 1);
    const ly = this.of(y, depth + 1);
    const zero = (l) => l.fin && Math.abs(value(l.fin)) < 1e-300;
    if (lx.bnd || ly.bnd) {
      const other = lx.bnd ? ly : lx;
      if (zero(other)) {   // bounded times something going to 0: 0, by the squeeze theorem
        this.step('limit.squeeze', 'The squeeze theorem', f, exactNum('0'), { f, bounded: lx.bnd ? x : y });
        return fin(exactNum('0'));
      }
      if (other.inf) throw new NoLimit('a growing factor times one that keeps swinging');
      return BOUNDED;
    }
    if (lx.fin && ly.fin) return fin(normal(op('*', [lx.fin, ly.fin])));
    if ((zero(lx) && ly.inf) || (lx.inf && zero(ly))) {
      // 0·∞: a quotient, a/(1/b), with whichever turned over is simpler below (x·e^-x = x/e^x, x·ln x = ln x/(1/x))
      const [small, big] = zero(lx) ? [x, y] : [y, x];
      const size = (n) => n.s.split(' ').length;
      const [overSmall, overBig] = [normal(op('/', [exactNum('1'), small])), normal(op('/', [exactNum('1'), big]))];
      const q = size(overSmall) <= size(overBig) ? op('/', [big, overSmall]) : op('/', [small, overBig]);
      this.step('limit.zero-times-infinity', '0·∞: a quotient', f, q, { f });
      return this.quotient(q, q.args[0], q.args[1], depth + 1);
    }
    const sign = (l) => (l.inf ? l.inf : Math.sign(value(l.fin)));
    return inf(sign(lx) * sign(ly));
  }

  quotient(f, N, D, depth) {
    const { v, a } = this;
    if (a.inf) {   // a fraction of polynomials at ±∞: the leading terms, before the parts' ∞ − ∞
      const rational = this.rational(f, depth);
      if (rational) return rational;
    }
    const ln = this.of(N, depth + 1);
    const ld = this.of(D, depth + 1);
    const zero = (l) => l.fin && Math.abs(value(l.fin)) < 1e-300;
    if (ln.bnd && ld.inf) {   // bounded over ∞: 0, by the squeeze theorem
      this.step('limit.squeeze', 'The squeeze theorem', f, exactNum('0'), { f, bounded: N });
      return fin(exactNum('0'));
    }
    if (ln.bnd && ld.fin && !zero(ld)) return BOUNDED;
    if (ld.bnd) throw new CasError('a quotient over something that keeps swinging is not worked out here');
    if (ln.inf && ld.inf && a.inf) {   // ∞/∞ with roots or a bounded part: divide by the power of x the bottom grows like
      const divided = this.dividePower(f, N, D, depth);
      if (divided) return divided;
    }
    if (ld.fin && !zero(ld)) {
      if (ln.fin) return fin(this.cas.simplify(normal(op('/', [ln.fin, ld.fin])), { steps: false }).result);
      return inf(ln.inf * Math.sign(value(ld.fin)));
    }
    if (ld.inf && ln.fin) return fin(exactNum('0'));
    if (zero(ld) && !zero(ln)) {
      // c/0: ±∞, by the sign on each side
      return this.blowUp(f);
    }
    // 0/0 or ∞/∞
    const form = zero(ln) ? '0/0' : '∞/∞';
    const rational = this.rational(f, depth);
    if (rational) return rational;
    const dN = normal(this.cas.differentiate(N, v));
    const dD = normal(this.cas.differentiate(D, v));
    const next = normal(op('/', [dN, dD]));
    this.step('limit.lhopital', "L'Hôpital's rule", f, next, { f, form: sym(form) });
    return this.of(next, depth + 1);
  }

  /** N/D as v → ±∞, divided top and bottom by x^p, p the power D grows like (when it grows like a power). */
  dividePower(f, N, D, depth) {
    const { v, a } = this;
    const special = walkNodes(f).some((m) => isOp(m) && (['sqrt', 'root', 'sin', 'cos'].includes(m.op) || (m.op === '^' && !freeSymbols(m.args[1]).size && !Number.isInteger(value(m.args[1])))));
    if (!special || this.divided?.has(f.s)) return null;
    const [x1, x2] = [1e4 * a.inf, 1e6 * a.inf];
    const p = Math.log(Math.abs(at(D, v, x2) / at(D, v, x1))) / Math.log(100);
    const half = Math.round(p * 2) / 2;
    if (!Number.isFinite(p) || Math.abs(p - half) > 0.05 || half <= 0 || (a.inf < 0 && !Number.isInteger(half))) return null;
    const xp = op('^', [sym(v), exactNum(String(half))]);
    const scale = (n) => {
      if (isOp(n) && (n.op === '+' || n.op === '-')) return op(n.op, n.args.map(scale));
      if (isOp(n) && n.op === 'neg') return op('neg', [scale(n.args[0])]);
      if (isOp(n) && n.op === 'sqrt') {   // √P/x^p = √(P/x^2p) for x > 0; times (−1)^p for x < 0
        const inside = op('sqrt', [normal(op('/', [n.args[0], op('^', [sym(v), exactNum(String(2 * half))])]))]);
        return a.inf < 0 && half % 2 ? op('neg', [inside]) : inside;
      }
      return normal(op('/', [n, xp]));
    };
    const next = op('/', [normal(scale(N)), normal(scale(D))]);
    (this.divided ??= new Set()).add(f.s);
    this.step('limit.divide-power', 'Divide by the highest power', f, next, { f, power: xp });
    return this.quotient(next, next.args[0], next.args[1], depth + 1);
  }

  /** A fraction of polynomials: cancel the common factor (0/0), or the leading terms (at ±∞). */
  rational(f, depth) {
    const { v, a } = this;
    const { num, den } = together(canon(f));
    const p = rationalCoefficients(coefficients(num, v));
    const q = rationalCoefficients(coefficients(den, v));
    if (!p || !q || q.length < 2) return null;
    if (a.inf) {
      const [n, d] = [p.length - 1, q.length - 1];
      const lead = normal(op('/', [op('*', [display(N(p[n])), op('^', [sym(v), exactNum(String(n))])]), op('*', [display(N(q[d])), op('^', [sym(v), exactNum(String(d))])])]));
      this.step('limit.leading', 'The leading terms', f, lead, { f, lead });
      if (n < d) return fin(exactNum('0'));
      if (n === d) return fin(display(N(p[n].div(q[d]))));
      const sign = p[n].div(q[d]).sign * ((n - d) % 2 && a.inf < 0 ? -1 : 1);
      return inf(sign);
    }
    const canceled = this.cas.cancel(f, { steps: false }).result;
    if (canceled.s === f.s) return null;
    this.step('limit.cancel', 'Cancel the common factor', f, canceled, { f });
    const raw = substitute(canceled, v, a.fin);
    if (Number.isFinite(value(raw))) return fin(this.cas.simplify(normal(raw), { steps: false }).result);
    return this.blowUp(canceled);
  }

  /** f grows without bound near the point: ±∞ on each side, or no two-sided limit. */
  blowUp(f) {
    const { v, a, side } = this;
    const sides = side ? [side] : [-1, 1];
    const signs = sides.map((s) => signNear(f, v, a, s));
    if (signs.includes(0)) throw new CasError('the sign near the point could not be told');
    if (signs.length === 2 && signs[0] !== signs[1]) {
      this.step('limit.one-sided', 'The two sides differ', f, f, { f, left: signs[0] > 0 ? INF : sym('-∞'), right: signs[1] > 0 ? INF : sym('-∞') });
      throw new NoLimit(`from the left it goes to ${signs[0] > 0 ? '∞' : '-∞'}, from the right to ${signs[1] > 0 ? '∞' : '-∞'}`);
    }
    return inf(signs[0]);
  }

  power(f, depth) {
    const { v } = this;
    const [B, E] = f.args;
    const lb = this.of(B, depth + 1);
    const le = this.of(E, depth + 1);
    if (lb.bnd || le.bnd) throw new CasError('a power of something that keeps swinging is not worked out here');
    const num = (l) => (l.fin ? value(l.fin) : l.inf * Infinity);
    const b = num(lb);
    const e = num(le);
    if (lb.fin && le.fin) {
      if (Math.abs(b) < 1e-300 && e < 0) return this.blowUp(f);   // 1/x²: 0 to a negative power
      if (!(Math.abs(b) < 1e-300 && Math.abs(e) < 1e-300)) return fin(this.cas.simplify(normal(op('^', [lb.fin, le.fin])), { steps: false }).result);
    }
    const constantBase = !freeSymbols(B).has(v);
    if (constantBase && le.inf) {   // 2^x, e^-x
      if (b === 1) return fin(exactNum('1'));
      if (b > 1) return le.inf > 0 ? inf(1) : fin(exactNum('0'));
      if (b > 0) return le.inf > 0 ? fin(exactNum('0')) : inf(1);
      throw new NoLimit('a negative number to a growing power swings between signs');
    }
    const constantExponent = !freeSymbols(E).has(v);
    if (constantExponent && lb.inf) {
      if (e > 0) return inf(lb.inf > 0 ? 1 : Number.isInteger(e) && e % 2 ? -1 : 1);
      if (e < 0) return fin(exactNum('0'));
    }
    if (constantExponent && lb.fin && Math.abs(b) < 1e-300 && e > 0) return fin(exactNum('0'));
    // 1^∞, 0^0, ∞^0, and the rest: e^(E ln B)
    const form = Math.abs(b - 1) < 1e-12 && le.inf ? '1^∞' : Math.abs(b) < 1e-300 ? '0^0' : '∞^0';
    const exponent = normal(op('*', [E, op('ln', [B])]));
    this.step('limit.exp-log', 'Take logs', f, op('^', [sym('e'), exponent]), { f, form: sym(form) });
    const le2 = this.of(exponent, depth + 1);
    if (le2.inf) return le2.inf > 0 ? inf(1) : fin(exactNum('0'));
    return fin(this.cas.simplify(normal(op('^', [sym('e'), le2.fin])), { steps: false }).result);
  }

  func(f, depth) {
    const name = f.op;
    const args = f.args;
    if (args.length !== 1) {
      // log(b, x), root(n, x): the argument that varies
      if (name === 'log' && !freeSymbols(args[0]).has(this.v)) return this.func(op('ln', [args[1]]), depth);   // the base's ln is a positive factor
      throw new CasError(`a limit of ${name} is not worked out here`);
    }
    let l;
    try {
      l = this.of(args[0], depth + 1);
    } catch (error) {
      // sin(1/x) at 0: the argument has no limit, but sin and cos stay between -1 and 1
      if (error instanceof NoLimit && (name === 'sin' || name === 'cos')) return BOUNDED;
      throw error;
    }
    if (l.bnd) {
      if (name === 'sin' || name === 'cos' || name === 'arctan' || name === 'abs') return BOUNDED;
      throw new CasError(`${name} of something that keeps swinging is not worked out here`);
    }
    if (l.fin) {
      if (POLES[name] && this.isExactZero(op(POLES[name], [l.fin]))) return this.blowUp(f);   // tan at π/2
      const put = normal(op(name, [l.fin]));
      const y = value(put);
      if (Number.isFinite(y)) return fin(this.cas.simplify(put, { steps: false }).result);
      if (name === 'ln' && Math.abs(value(l.fin)) < 1e-300) return inf(-1);   // ln of something going to 0⁺
      if (['tan', 'sec', 'csc', 'cot'].includes(name)) return this.blowUp(f);
      throw new CasError(`${name} has no value at the limit of its argument`);
    }
    const s = l.inf;
    switch (name) {
      case 'sqrt': case 'ln': case 'cosh':
        if (s < 0 && name !== 'cosh') throw new NoLimit(`${name} has no value as its argument goes to -∞`);
        return inf(1);
      case 'abs': return inf(1);
      case 'sinh': return inf(s);
      case 'tanh': return fin(exactNum(String(s)));
      case 'arctan': return fin(normal(op('/', [s > 0 ? sym('pi') : op('neg', [sym('pi')]), exactNum('2')])));
      case 'arccot': return fin(s > 0 ? exactNum('0') : sym('pi'));
      case 'arcsec': case 'arccsc': return fin(name === 'arcsec' ? normal(op('/', [sym('pi'), exactNum('2')])) : exactNum('0'));
      case 'sin': case 'cos': return BOUNDED;   // between -1 and 1: no limit of its own, but bounded
      case 'tan': case 'sec': case 'csc': case 'cot':
        throw new NoLimit(`${name} keeps swinging as its argument grows`);
      default: throw new CasError(`a limit of ${name} at ∞ is not worked out here`);
    }
  }
}

/** A denominator (or a base to a negative power) that is 0: the decimal value of 0/0 can come out 0. */
const zeroBelow = (n) => walkNodes(n).some((m) => isOp(m) && ((m.op === '/' && Math.abs(value(m.args[1])) < 1e-300)
  || (m.op === '^' && value(m.args[1]) < 0 && Math.abs(value(m.args[0])) < 1e-300)));

const walkNodes = (n, out = []) => { out.push(n); if (isOp(n)) n.args.forEach((a) => walkNodes(a, out)); return out; };

const negate = (l) => (l.bnd ? l : l.inf ? inf(-l.inf) : fin(normal(op('neg', [l.fin]))));

/** The answer against numbers near the point: a wrong answer is refused rather than given (exported for the tests). */
export function verify(f, v, a, side, result) {
  const sides = side ? [side] : a.inf ? [-1] : [-1, 1];
  for (const s of sides) {
    const ys = approach(a, s).map((t) => at(f, v, t));
    const close = ys.filter(Number.isFinite);
    if (close.length < 3) continue;   // no numbers there to hold it to
    const last = close[close.length - 1];
    if (result.inf) {
      if (Math.sign(last) !== result.inf || Math.abs(last) < Math.abs(close[0])) throw new CasError(`numbers near the point don't go to ${result.inf > 0 ? '∞' : '-∞'}: not answered`);
    } else {
      const want = value(result.fin);
      if (!Number.isFinite(want)) continue;
      // close, or closing in steadily (−1/ln x goes to 0 slowly: 0.22, 0.14, 0.11, 0.09, 0.07)
      const gaps = close.map((y) => Math.abs(y - want));
      // and still moving: the last gap within ten of the last step (numbers that have settled elsewhere move far less)
      const step = Math.abs(close[close.length - 1] - close[close.length - 2]);
      const closing = gaps.every((g, i) => i === 0 || g < gaps[i - 1]) && gaps[gaps.length - 1] < 0.5 * gaps[0] && gaps[gaps.length - 1] < 10 * step;
      if (gaps[gaps.length - 1] > 1e-2 * Math.max(1, Math.abs(want)) && !closing) throw new CasError(`numbers near the point go to ${last.toPrecision(6)}, not ${want.toPrecision(6)}: not answered`);
    }
  }
}

/** A limit as written by MathZetta: lim(f, x → a) or lim(f, x, a, side). */
export function readLimit(node) {
  if (!isOp(node) || node.op !== 'lim') return null;
  const [f, second, third, fourth] = node.args;
  if (isOp(second) && second.op === '→') return { f, v: second.args[0].token, to: second.args[1], side: 0 };
  if (second?.type === 'sym' && third) {
    const side = fourth?.token === 'r' ? 1 : fourth?.token === 'l' ? -1 : 0;
    return { f, v: second.token, to: third, side };
  }
  return null;
}

/** A point as written (a number, ∞, -∞) → { fin } or { inf }. */
export function pointOf(node) {
  if (node.type === 'sym' && (node.token === '∞' || node.token === 'oo' || node.token === 'infinity')) return inf(1);
  if (node.type === 'sym' && node.token === '-∞') return inf(-1);
  if (isOp(node) && node.op === 'neg' && node.args[0].type === 'sym' && node.args[0].token === '∞') return inf(-1);
  return fin(normal(node));
}

/** The answer as a node: a number, ∞ or -∞. */
export const limitNode = (l) => (l.inf ? (l.inf > 0 ? INF : sym('-∞')) : l.fin);

export { mentions };
