// Approximation to any number of digits.
//
// approximate(node, { digits }) gives a decimal correct to `digits` significant
// figures (default 15), worked out with BigInt fixed-point arithmetic, so
// { digits: 100 } really gives 100 digits of π, √2 or sin(1). Exact parts stay
// exact fractions until a function needs a decimal. Unknowns get values from
// `scope`; an expression with unknowns left keeps them, with each number in it
// approximated (approximateParts).

import { op, sym, exactNum, isOp } from '../expr.js';
import { Q, CasError, fromToken, intRoot, bitLength, MAX_BITS } from './rational.js';

// a value beyond this many bits (about 10^1,200,000) is too large to work out: refused, not attempted
const MAX_RESULT_BITS = 4 * MAX_BITS;
const tooLarge = () => new CasError('a number too large to approximate');
// roots with a larger index go through e^(ln b / q) rather than an integer q-th root
const MAX_ROOT_INDEX = 64n;
import { CONSTANTS, freeSymbols, settings, COMPLEX_NAMES } from './form.js';

const babs = (n) => (n < 0n ? -n : n);

/** Fixed-point context: values are BigInts meaning v / S, S = 10^P. */
class Fixed {
  constructor(P) {
    this.P = P;
    this.S = 10n ** BigInt(P);
    this.cache = new Map();
  }
  fromQ(q) { return (q.n * this.S) / q.d; }
  mul(a, b) { return (a * b) / this.S; }
  div(a, b) {
    if (b === 0n) throw new CasError('division by zero');
    return (a * this.S) / b;
  }
  sqrt(a) {
    if (a < 0n) throw new CasError('the square root of a negative number is not real');
    return intRoot(a * this.S, 2);
  }
  /** Σ of a series whose terms come from next(term, k) until they vanish. */
  series(first, next) {
    let sum = 0n;
    let term = first;
    for (let k = 1; term !== 0n; k++) {
      sum += term;
      term = next(term, k);
      if (k > 100000) throw new CasError('a series did not converge');
    }
    return sum;
  }
  /** atanh(1/m) for a whole m ≥ 2, by integer division only. */
  atanhInv(m) {
    const M = BigInt(m);
    const m2 = M * M;
    let power = this.S / M;
    let sum = 0n;
    for (let k = 1n; power !== 0n; k += 2n) {
      sum += power / k;
      power /= m2;
    }
    return sum;
  }
  atanInv(m) {
    const M = BigInt(m);
    const m2 = M * M;
    let power = this.S / M;
    let sum = 0n;
    for (let k = 1n, sign = 1n; power !== 0n; k += 2n, sign = -sign) {
      sum += (sign * power) / k;
      power /= m2;
    }
    return sum;
  }
  get pi() { return this.memo('pi', () => 16n * this.atanInv(5) - 4n * this.atanInv(239)); }
  get ln2() { return this.memo('ln2', () => 2n * this.atanhInv(3)); }
  get e() { return this.memo('e', () => this.exp(this.S)); }
  memo(k, f) {
    if (!this.cache.has(k)) this.cache.set(k, f());
    return this.cache.get(k);
  }
  exp(x) {
    // x = n ln2 + r with |r| ≤ ln2/2: e^x = 2^n e^r
    const n = (x + (x >= 0n ? this.ln2 / 2n : -this.ln2 / 2n)) / this.ln2;
    if (n > BigInt(MAX_RESULT_BITS)) throw tooLarge();
    if (n < -BigInt(MAX_RESULT_BITS)) return 0n;   // below every digit kept
    const r = x - n * this.ln2;
    const er = this.series(this.S, (t, k) => (t * r) / this.S / BigInt(k));
    if (n >= 0n) return er << n;
    return er >> -n;
  }
  ln(x) {
    if (x <= 0n) throw new CasError('the log of a number that is not positive is not real');
    // x = m · 2^k with m in [S/2, S)
    let k = 0n;
    let m = x;
    while (m >= this.S) { m >>= 1n; k++; }
    while (m < this.S / 2n) { m <<= 1n; k--; }
    const z = this.div(m - this.S, m + this.S);
    const z2 = this.mul(z, z);
    let power = z;
    let sum = 0n;
    for (let j = 1n; power !== 0n; j += 2n) {
      sum += power / j;
      power = this.mul(power, z2);
    }
    return 2n * sum + k * this.ln2;
  }
  sin(x) {
    const twoPi = 2n * this.pi;
    let r = x % twoPi;
    if (r > this.pi) r -= twoPi;
    if (r < -this.pi) r += twoPi;
    const r2 = this.mul(r, r);
    return this.series(r, (t, k) => -(t * r2) / this.S / BigInt((2 * k) * (2 * k + 1)));
  }
  cos(x) { return this.sin(x + this.pi / 2n); }
  atan(x) {
    if (babs(x) > this.S) {
      const half = this.pi / 2n;
      return (x > 0n ? half : -half) - this.atan(this.div(this.S, x));
    }
    // halve the angle twice: atan x = 2 atan(x / (1 + √(1 + x²)))
    let y = x;
    for (let i = 0; i < 2; i++) y = this.div(y, this.S + this.sqrt(this.S + this.mul(y, y)));
    const y2 = this.mul(y, y);
    let power = y;
    let sum = 0n;
    for (let k = 1n, sign = 1n; power !== 0n; k += 2n, sign = -sign) {
      sum += (sign * power) / k;
      power = this.mul(power, y2);
    }
    return 4n * sum;
  }
  asin(x) {
    if (babs(x) > this.S) throw new CasError('arcsin of a number beyond ±1 is not real');
    if (babs(x) === this.S) return x > 0n ? this.pi / 2n : -this.pi / 2n;
    return this.atan(this.div(x, this.sqrt(this.S - this.mul(x, x))));
  }
}

// ---- complex values (complex mode): [re, im] fixed-point pairs -----------------------------

function atan2(F, y, x) {
  if (x > 0n) return F.atan(F.div(y, x));
  if (x < 0n) return F.atan(F.div(y, x)) + (y >= 0n ? F.pi : -F.pi);
  if (y === 0n) throw new CasError('the argument of 0 is undefined');
  return y > 0n ? F.pi / 2n : -F.pi / 2n;
}
const C = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (F, a, b) => [F.mul(a[0], b[0]) - F.mul(a[1], b[1]), F.mul(a[0], b[1]) + F.mul(a[1], b[0])],
  div(F, a, b) {
    const n = F.mul(b[0], b[0]) + F.mul(b[1], b[1]);
    if (n === 0n) throw new CasError('division by zero');
    return [F.div(F.mul(a[0], b[0]) + F.mul(a[1], b[1]), n), F.div(F.mul(a[1], b[0]) - F.mul(a[0], b[1]), n)];
  },
  abs: (F, a) => F.sqrt(F.mul(a[0], a[0]) + F.mul(a[1], a[1])),
  exp(F, a) {
    const r = F.exp(a[0]);
    return [F.mul(r, F.cos(a[1])), F.mul(r, F.sin(a[1]))];
  },
  ln(F, a) {
    const size = C.abs(F, a);
    if (size === 0n) throw new CasError('the log of 0 is undefined');
    return [F.ln(size), atan2(F, a[1], a[0])];
  },
  pow(F, a, w, wq) {
    if (a[0] === 0n && a[1] === 0n) return [0n, 0n];
    if (wq && wq.isInteger) {
      let k = wq.n < 0n ? -wq.n : wq.n;
      let result = [F.S, 0n];
      let b = a;
      while (k > 0n) {
        if (k & 1n) result = C.mul(F, result, b);
        b = C.mul(F, b, b);
        k >>= 1n;
      }
      return wq.n < 0n ? C.div(F, [F.S, 0n], result) : result;
    }
    return C.exp(F, C.mul(F, w, C.ln(F, a)));
  },
  sinh: (F, x) => (F.exp(x) - F.exp(-x)) / 2n,
  cosh: (F, x) => (F.exp(x) + F.exp(-x)) / 2n,
};
const COMPLEX_FUNCTIONS = {
  sin: (F, [a, b]) => [F.mul(F.sin(a), C.cosh(F, b)), F.mul(F.cos(a), C.sinh(F, b))],
  cos: (F, [a, b]) => [F.mul(F.cos(a), C.cosh(F, b)), -F.mul(F.sin(a), C.sinh(F, b))],
  tan: (F, z) => C.div(F, COMPLEX_FUNCTIONS.sin(F, z), COMPLEX_FUNCTIONS.cos(F, z)),
  ln: (F, z) => C.ln(F, z),
  sqrt: (F, z) => C.exp(F, C.mul(F, [F.S / 2n, 0n], C.ln(F, z))),
  sinh: (F, [a, b]) => [F.mul(C.sinh(F, a), F.cos(b)), F.mul(C.cosh(F, a), F.sin(b))],
  cosh: (F, [a, b]) => [F.mul(C.cosh(F, a), F.cos(b)), F.mul(C.sinh(F, a), F.sin(b))],
};

// A value is exact { q }, fixed-point { f }, or (complex mode) a pair { z: [re, im] }.
const exact = (q) => ({ q });
const pairOf = (F, v) => v.z ?? [fixedOf(F, v), 0n];
const complexValue = ([re, im]) => (im === 0n ? { f: re } : { z: [re, im] });

/** An operation when an argument is complex (or a real one whose answer is: √-2, ln(-1)). */
function complexEvaluate(node, a, F) {
  const z = (i) => pairOf(F, a[i]);
  switch (node.op) {
    case '+': return complexValue(C.add(z(0), z(1)));
    case '-': return complexValue(C.sub(z(0), z(1)));
    case 'neg': return complexValue([-z(0)[0], -z(0)[1]]);
    case '*': return complexValue(C.mul(F, z(0), z(1)));
    case '/': return complexValue(C.div(F, z(0), z(1)));
    case '^': return complexValue(C.pow(F, z(0), z(1), a[1].q));
    case 'sqrt': return complexValue(COMPLEX_FUNCTIONS.sqrt(F, z(0)));
    case 'root': return complexValue(C.pow(F, z(1), C.div(F, [F.S, 0n], z(0)), a[0].q?.inv()));
    case 'abs': return { f: C.abs(F, z(0)) };
    case 'arg': return { f: atan2(F, z(0)[1], z(0)[0]) };
    case 're': return { f: z(0)[0] };
    case 'im': return { f: z(0)[1] };
    case 'conj': return complexValue([z(0)[0], -z(0)[1]]);
    case 'log': return complexValue(C.div(F, C.ln(F, z(1)), C.ln(F, z(0))));
    default: {
      const g = COMPLEX_FUNCTIONS[node.op];
      if (!g || a.length !== 1) throw new CasError(`no complex value for ${node.op}`);
      return complexValue(g(F, z(0)));
    }
  }
}

/** Real arguments whose answer is complex: a negative under an even root, the log of a negative. */
function complexFromReal(node, a, F) {
  if (!settings.complex) return false;
  const negative = (v) => (v.q ? v.q.sign < 0 : v.f !== undefined && v.f < 0n);
  if (node.op === 'sqrt' || node.op === 'ln' || node.op === 'log') return negative(a[node.op === 'log' ? 1 : 0]) || (node.op === 'log' && negative(a[0]));
  if (node.op === '^') return negative(a[0]) && !(a[1].q && a[1].q.d % 2n === 1n);
  if (node.op === 'root') return negative(a[1]) && !(a[0].q && a[0].q.isInteger && a[0].q.n % 2n === 1n);
  return false;
}

function fixedOf(F, v) {
  return v.q ? F.fromQ(v.q) : v.f;
}

const FUNCTIONS = {
  sin: (F, x) => F.sin(x),
  cos: (F, x) => F.cos(x),
  tan: (F, x) => F.div(F.sin(x), F.cos(x)),
  sec: (F, x) => F.div(F.S, F.cos(x)),
  csc: (F, x) => F.div(F.S, F.sin(x)),
  cot: (F, x) => F.div(F.cos(x), F.sin(x)),
  arcsin: (F, x) => F.asin(x),
  arccos: (F, x) => F.pi / 2n - F.asin(x),
  arctan: (F, x) => F.atan(x),
  arcsec: (F, x) => { if (babs(x) < F.S) throw new CasError('arcsec of a number between -1 and 1 is not real'); return F.pi / 2n - F.asin(F.div(F.S, x)); },
  arccsc: (F, x) => { if (babs(x) < F.S) throw new CasError('arccsc of a number between -1 and 1 is not real'); return F.asin(F.div(F.S, x)); },
  arccot: (F, x) => F.pi / 2n - F.atan(x),   // 0 to π
  sinh: (F, x) => (F.exp(x) - F.exp(-x)) / 2n,
  cosh: (F, x) => (F.exp(x) + F.exp(-x)) / 2n,
  tanh: (F, x) => { const a = F.exp(x); const b = F.exp(-x); return F.div(a - b, a + b); },
  arcsinh: (F, x) => F.ln(x + F.sqrt(F.mul(x, x) + F.S)),
  arccosh: (F, x) => {
    if (x < F.S) throw new CasError('arccosh of a number below 1 is not real');
    return F.ln(x + F.sqrt(F.mul(x, x) - F.S));
  },
  arctanh: (F, x) => {
    if (babs(x) >= F.S) throw new CasError('arctanh of a number beyond ±1 is not real');
    return F.ln(F.div(F.S + x, F.S - x)) / 2n;
  },
  ln: (F, x) => F.ln(x),
  loglog: (F, x) => F.ln(F.ln(x)),
  logloglog: (F, x) => F.ln(F.ln(F.ln(x))),
  expm1: (F, x) => F.exp(x) - F.S,
};

function evaluate(node, F, scope) {
  if (node.type === 'num') return exact(fromToken(node.token));
  if (node.type === 'sym') {
    if (node.token === 'pi' || node.token === 'π') return { f: F.pi };
    if (node.token === 'e') return { f: F.e };
    if (node.token === 'i' && settings.complex) return { z: [0n, F.S] };
    if (scope && node.token in scope) {
      const v = scope[node.token];
      const q = typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint' ? fromToken(String(v)) : null;
      if (!q) throw new CasError(`the value of ${node.token} is not a number`);
      return exact(q);
    }
    throw new CasError(`${node.token} has no value`);
  }
  // MathZetta's \:Re(z), \:conj(z) … are re, conj …
  if (settings.complex && node.op.startsWith('\\:') && COMPLEX_NAMES[node.op.slice(2)]) node = op(COMPLEX_NAMES[node.op.slice(2)], node.args);
  const a = node.args.map((x) => evaluate(x, F, scope));
  if (a.some((v) => v.z) || ['re', 'im', 'conj', 'arg'].includes(node.op) || complexFromReal(node, a, F)) return complexEvaluate(node, a, F);
  const allExact = a.every((v) => v.q);
  const f = (i) => fixedOf(F, a[i]);
  switch (node.op) {
    case '+': return allExact ? exact(a[0].q.add(a[1].q)) : { f: f(0) + f(1) };
    case '-': return allExact ? exact(a[0].q.sub(a[1].q)) : { f: f(0) - f(1) };
    case 'neg': return a[0].q ? exact(a[0].q.neg()) : { f: -a[0].f };
    case '*': return allExact ? exact(a[0].q.mul(a[1].q)) : { f: F.mul(f(0), f(1)) };
    case '/': return allExact ? exact(a[0].q.div(a[1].q)) : { f: F.div(f(0), f(1)) };
    case '^': return power(F, a[0], a[1]);
    case 'sqrt': return power(F, a[0], exact(Q.HALF));
    case 'root': return power(F, a[1], a[0].q ? exact(a[0].q.inv()) : { f: F.div(F.S, a[0].f) });
    case 'abs': return a[0].q ? exact(a[0].q.abs()) : { f: babs(a[0].f) };
    case 'floor': return exact(a[0].q ? a[0].q.floor() : new Q(floorDiv(a[0].f, F.S)));
    case 'ceil': return exact(a[0].q ? a[0].q.ceil() : new Q(-floorDiv(-a[0].f, F.S)));
    case 'log': return { f: F.div(F.ln(f(1)), F.ln(f(0))) };   // log(base, x)
    case 'atan2': return { f: atan2(F, f(0), f(1)) };
    // the list functions and mod, with irrational arguments too (max(π, 3))
    case 'max': case 'min': {
      if (!a.length) throw new CasError(`${node.op} of nothing`);
      if (allExact) return exact(a.map((v) => v.q).reduce((m, q) => ((node.op === 'max' ? q.sub(m).sign > 0 : q.sub(m).sign < 0) ? q : m)));
      return { f: a.map((_, i) => f(i)).reduce((m, x) => (node.op === 'max' ? (x > m ? x : m) : (x < m ? x : m))) };
    }
    case 'sum': return allExact ? exact(a.reduce((s, v) => s.add(v.q), Q.ZERO)) : { f: a.reduce((s, _, i) => s + f(i), 0n) };
    case 'prod': return allExact ? exact(a.reduce((s, v) => s.mul(v.q), Q.ONE)) : { f: a.reduce((s, _, i) => F.mul(s, f(i)), F.S) };
    case 'mean': {
      if (!a.length) throw new CasError('mean of nothing');
      return allExact ? exact(a.reduce((s, v) => s.add(v.q), Q.ZERO).div(new Q(BigInt(a.length)))) : { f: a.reduce((s, _, i) => s + f(i), 0n) / BigInt(a.length) };
    }
    case 'mod': {
      if (allExact) { if (a[1].q.isZero) throw new CasError('mod 0 is undefined'); return exact(a[0].q.sub(a[1].q.mul(a[0].q.div(a[1].q).floor()))); }
      const y = f(1);
      if (y === 0n) throw new CasError('mod 0 is undefined');
      return { f: f(0) - F.mul(y, floorDiv(F.div(f(0), y), F.S) * F.S) };
    }
    case 'round': {   // round(x, d): to d decimal places
      if (!a[1].q?.isInteger) throw new CasError('round needs a whole number of places');
      const scale = 10n ** babs(a[1].q.n);
      const x = a[0].q ?? new Q(f(0), F.S);
      const up = a[1].q.sign >= 0;
      const scaled = up ? x.mul(new Q(scale)) : x.div(new Q(scale));
      const nearest = scaled.add(Q.HALF).floor();   // half rounds up, as Math.round
      return exact(up ? nearest.div(new Q(scale)) : nearest.mul(new Q(scale)));
    }
    case '!': {
      if (!a[0].q?.isInteger || a[0].q.sign < 0) throw new CasError('factorial is only worked out for whole numbers');
      let r = 1n;
      for (let i = 2n; i <= a[0].q.n; i++) {
        r *= i;
        if ((i & 255n) === 0n && bitLength(r) > MAX_RESULT_BITS) throw tooLarge();
      }
      return exact(new Q(r));
    }
    default: {
      const g = FUNCTIONS[node.op];
      if (!g || a.length !== 1) throw new CasError(`no numeric value for ${node.op}`);
      return { f: g(F, f(0)) };
    }
  }
}

const floorDiv = (a, b) => {
  const q = a / b;
  return a < 0n && q * b !== a ? q - 1n : q;
};

function power(F, base, exponent) {
  if (exponent.q && exponent.q.isInteger) {
    if (base.q) return exact(base.q.pow(exponent.q.n));
    let k = exponent.q.n;
    const invert = k < 0n;
    if (invert) k = -k;
    let result = F.S;
    let b = base.f;
    while (k > 0n) {
      if (k & 1n) result = F.mul(result, b);
      b = F.mul(b, b);
      if (bitLength(result) > MAX_RESULT_BITS + F.P * 4 || bitLength(b) > 2 * MAX_RESULT_BITS) {
        if (invert) return { f: 0n };   // 1 / (something enormous): below every digit kept
        throw tooLarge();
      }
      k >>= 1n;
    }
    return { f: invert ? F.div(F.S, result) : result };
  }
  const b = fixedOf(F, base);
  if (b === 0n) {
    if (exponent.q ? exponent.q.sign > 0 : exponent.f > 0n) return exact(Q.ZERO);
    throw new CasError('0 to a power that is not positive is undefined');
  }
  if (b < 0n) {
    // a negative number to p/q with q odd is real: (-8)^(1/3) = -2
    if (exponent.q && exponent.q.d % 2n === 1n) {
      const magnitude = power(F, { f: -b }, exponent).f;
      return { f: exponent.q.n % 2n === 0n ? magnitude : -magnitude };
    }
    throw new CasError('a negative number to a fractional power is not real');
  }
  if (exponent.q && babs(exponent.q.n) === 1n && exponent.q.d <= MAX_ROOT_INDEX) {
    // b^(±1/q): a q-th root by integer arithmetic
    const root = intRoot(b * F.S ** (exponent.q.d - 1n), Number(exponent.q.d));
    return { f: exponent.q.n < 0n ? F.div(F.S, root) : root };
  }
  return { f: F.exp(F.mul(fixedOf(F, exponent), F.ln(b))) };
}

/** A fixed-point value → { mantissa digits, exponent } rounded to `digits` significant figures. */
function decimal(v, F, digits) {
  const sign = v < 0n ? '-' : '';
  const a = babs(v);
  if (a === 0n) return { sign: '', digits: '0', point: 1 };
  const s = a.toString();
  // a = s · 10^-P; position of the decimal point within s
  const point = s.length - F.P;
  let kept = s.slice(0, digits);
  if (s.length > digits && s[digits] >= '5') kept = (BigInt(kept) + 1n).toString();
  let p = point;
  if (kept.length > digits) { kept = kept.slice(0, digits); p++; }
  return { sign, digits: kept.replace(/0+$/, '') || '0', point: p };
}

function writeDecimal({ sign, digits, point }) {
  if (digits === '0') return '0';
  if (point > 21 || point < -6) {
    const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${mant}e${point - 1}`;
  }
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Does q's decimal end (only 2s and 5s in the denominator)? */
/** How many significant digits a terminating fraction's decimal has: 1/8 = 0.125 has 3. */
function significantDigits(q) {
  let twos = 0n, fives = 0n, d = q.d;
  while (d % 2n === 0n) { d /= 2n; twos++; }
  while (d % 5n === 0n) { d /= 5n; fives++; }
  const m = twos > fives ? twos : fives;
  let n = babs(q.n) * 10n ** m / q.d;   // the decimal's digits as a whole number
  if (n === 0n) return 1;
  while (n % 10n === 0n) n /= 10n;
  return n.toString().length;
}

function terminates(q) {
  let d = q.d;
  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;
  return d === 1n;
}

/** A decimal string → a node: 3.14 as is, 1.5e-9 as 1.5 · 10^-9 (MathZetta's own reading). */
export function decimalNode(text) {
  const m = /^(-?[\d.]+)e(-?\d+)$/.exec(text);
  if (!m) return exactNum(text);
  return op('*', [exactNum(m[1]), op('^', [exactNum('10'), exactNum(m[2])])]);
}

/**
 * A constant expression to `digits` significant figures.
 * @returns {{ text: string, node, number: number, exact: boolean }} exact: no rounding happened
 */
export function approximate(node, { digits = 15, scope } = {}) {
  if (!Number.isInteger(digits) || digits < 1 || digits > 100000) throw new CasError('digits must be a whole number from 1 to 100000');
  let P = digits + 25;
  let previous = null;   // the last attempt's { point, P }: a value that shrinks as fast as P grows is residue around 0
  for (let attempt = 0; attempt < 4; attempt++) {
    const F = new Fixed(P);
    const v = evaluate(node, F, scope);
    if (v.z) {
      const out = complexResult(v.z, F, digits);
      if (out.retry && attempt < 3) { P += out.retry; continue; }
      if (out.real === undefined) return out;
      return decimalResult(out.real, F, digits, null);
    }
    // a whole number with no more figures than asked for is given in full; a longer one is rounded below
    if (v.q && v.q.isInteger && babs(v.q.n).toString().length <= digits) return { text: v.q.n.toString(), node: exactNum(v.q.n.toString()), number: Number(v.q.n), re: Number(v.q.n), im: 0, exact: true };
    const f = fixedOf(F, v);
    // below the working precision (1/10^50, e^-100): look again with far more room, unless it is exactly 0
    if (f === 0n && !(v.q && v.q.isZero) && attempt < 3) {
      previous = null;
      P *= 4;
      continue;
    }
    const d = decimal(f, F, digits);
    // sin(π), ln(e) − 1: exactly 0, seen as rounding residue just below the working precision.
    // With more room the residue only moves further down (as far as the room grew): it is 0.
    if (previous && d.point < -10 && previous.point - d.point >= (P - previous.P) / 2) {
      return { text: '0', node: exactNum('0'), number: 0, re: 0, im: 0, exact: false };
    }
    // Small results lose figures to leading zeros: work again with more room (once the point has settled, it's done).
    if (d.point < -10 && attempt < 3 && !(previous && previous.point === d.point)) {
      previous = { point: d.point, P };
      P += -d.point + 10;
      continue;
    }
    return decimalResult(f, F, digits, v.q);
  }
  throw new CasError('could not approximate');
}

function decimalResult(f, F, digits, q) {
  const d = decimal(f, F, digits);
  const text = writeDecimal(d);
  return { text, node: decimalNode(text), number: Number(text), re: Number(text), im: 0, exact: Boolean(q) && terminates(q) && significantDigits(q) <= digits };
}

/**
 * [re, im] → "a + bi". A part far below the other (noise from e^(iπ), say) counts as 0:
 * then the result is real, given back as { real }.
 */
function complexResult([re, im], F, digits) {
  const tolerance = 10n ** BigInt(Math.max(0, F.P - digits - 12));
  const big = (x) => babs(x) > tolerance;
  if (!big(im)) return { real: re };
  const dIm = decimal(im, F, digits);
  if (dIm.point < -10 && big(im)) return { retry: -dIm.point + 10 };
  const imText = writeDecimal(dIm);
  const unit = imText === '1' ? 'i' : imText === '-1' ? '-i' : `${imText}i`;
  const imNode = imText === '1' ? sym('i') : op('*', [decimalNode(imText.replace(/^-/, '')), sym('i')]);
  if (!big(re)) {
    return { text: unit, node: imText.startsWith('-') ? op('neg', [imNode]) : imNode, number: NaN, re: 0, im: Number(imText), exact: false };
  }
  const reText = writeDecimal(decimal(re, F, digits));
  const negative = imText.startsWith('-');
  const magnitudeNode = imText.replace(/^-/, '') === '1' ? sym('i') : op('*', [decimalNode(imText.replace(/^-/, '')), sym('i')]);
  return {
    text: `${reText} ${negative ? '-' : '+'} ${unit.replace(/^-/, '')}`,
    node: op(negative ? '-' : '+', [decimalNode(reText), magnitudeNode]),
    number: NaN, re: Number(reText), im: Number(imText), exact: false,
  };
}

/** Approximate every constant part, keeping the unknowns: π x → 3.14159 x. */
export function approximateParts(node, options = {}) {
  const constant = (n) => freeSymbols(n).size === 0;
  const visit = (n) => {
    if (constant(n)) {
      if (n.type === 'num' && /^-?\d+$/.test(n.token)) return n;
      return approximate(n, options).node;
    }
    return isOp(n) ? op(n.op, n.args.map(visit)) : n;
  };
  return visit(node);
}

export { CONSTANTS };
