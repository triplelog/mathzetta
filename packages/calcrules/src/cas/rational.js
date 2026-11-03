// Exact rational numbers (BigInt), the CAS's only kind of number.
//
// Every number the CAS keeps is a fraction n/d in lowest terms with d > 0, of
// any size: 2^200 and 1/3 stay exact. Irrational values are not numbers here
// but expressions (2^(1/2), π, ln 2), so nothing is ever rounded unless
// approximate() is asked for.

export class CasError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CasError';
  }
}

/** Largest exact number kept, in bits (~30,000 digits): beyond it the CAS says so instead of hanging. */
export const MAX_BITS = 100000;

const babs = (n) => (n < 0n ? -n : n);
export const bitLength = (n) => (n === 0n ? 0 : babs(n).toString(2).length);

export function gcd(a, b) {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Q {
  constructor(n, d = 1n) {
    if (d === 0n) throw new CasError('division by zero');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
    if (bitLength(this.n) > MAX_BITS || bitLength(this.d) > MAX_BITS) throw new CasError('a number too large to keep exactly');
  }
  static of(k) { return new Q(BigInt(k)); }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  div(o) {
    if (o.n === 0n) throw new CasError('division by zero');
    return new Q(this.n * o.d, this.d * o.n);
  }
  neg() { return new Q(-this.n, this.d); }
  abs() { return this.n < 0n ? this.neg() : this; }
  inv() { return Q.ONE.div(this); }
  /** this^k for a whole k. */
  pow(k) {
    k = BigInt(k);
    if (k < 0n) return this.inv().pow(-k);
    if (this.n === 0n || babs(this.n) === 1n) {
      if (this.d === 1n) return k === 0n ? Q.ONE : this.n === -1n && k % 2n === 0n ? Q.ONE : this;
    }
    if (BigInt(Math.max(bitLength(this.n), bitLength(this.d))) * k > BigInt(MAX_BITS)) {
      throw new CasError('a power too large to work out exactly');
    }
    return new Q(this.n ** k, this.d ** k);
  }
  get isZero() { return this.n === 0n; }
  get isOne() { return this.n === 1n && this.d === 1n; }
  get isInteger() { return this.d === 1n; }
  get sign() { return this.n < 0n ? -1 : this.n > 0n ? 1 : 0; }
  equals(o) { return this.n === o.n && this.d === o.d; }
  compare(o) {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  floor() {
    const q = this.n / this.d;
    return new Q(this.n < 0n && q * this.d !== this.n ? q - 1n : q);
  }
  ceil() { return this.neg().floor().neg(); }
  toNumber() {
    const n = Number(this.n);
    const d = Number(this.d);
    if (Number.isFinite(n) && Number.isFinite(d)) return n / d;
    // Both huge: scale down together.
    const shift = BigInt(Math.max(bitLength(this.n), bitLength(this.d)) - 1000);
    return Number(this.n >> shift) / Number(this.d >> shift);
  }
  toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
}

Q.ZERO = new Q(0n);
Q.ONE = new Q(1n);
Q.MINUS_ONE = new Q(-1n);
Q.HALF = new Q(1n, 2n);

/** A numeric token read exactly ("3", "-0.25", "1e-9", "2.5E3"), or null (Infinity, NaN, x). */
export function fromToken(token) {
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(token));
  if (!m || (m[2] === '' && !m[3])) return null;
  const [, sign, whole, part = '', exp = '0'] = m;
  let q = new Q(BigInt((whole || '0') + part), 10n ** BigInt(part.length));
  const e = Number(exp);
  if (e) q = q.mul(Q.of(10).pow(e));
  return sign ? q.neg() : q;
}

/** The exact rational nearest… not needed: a finite double is a fraction with a power-of-two denominator. */
export function fromNumber(x) {
  if (!Number.isFinite(x)) throw new CasError(`not a finite number: ${x}`);
  if (Number.isInteger(x) && Number.isSafeInteger(x)) return Q.of(x);
  return fromToken(String(x));
}

/** The whole k-th root of a non-negative BigInt, if it is one; else null. */
export function exactRoot(n, k) {
  if (n < 0n) return null;
  if (n < 2n) return n;
  const r = intRoot(n, k);
  return r ** BigInt(k) === n ? r : null;
}

/** floor(n^(1/k)) for n ≥ 0. */
export function intRoot(n, k) {
  if (n < 2n) return n;
  const K = BigInt(k);
  // Newton's method from an over-estimate.
  let x = 1n << BigInt(Math.ceil(bitLength(n) / k));
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  while (x ** K > n) x--;
  while ((x + 1n) ** K <= n) x++;
  return x;
}

const SMALL_PRIMES = (() => {
  const out = [];
  const sieve = new Uint8Array(10000);
  for (let i = 2; i < sieve.length; i++) {
    if (sieve[i]) continue;
    out.push(BigInt(i));
    for (let j = i * i; j < sieve.length; j += i) sieve[j] = 1;
  }
  return out;
})();

/**
 * n = outside^k · inside with inside as small as trial division can make it:
 * the k-th root of n is outside · inside^(1/k). (√72 = 6√2.) Factors above 10,000
 * stay inside unless what is left is itself a perfect power.
 */
export function extractPower(n, k) {
  const K = BigInt(k);
  let outside = 1n;
  let inside = 1n;
  let rest = n;
  for (const p of SMALL_PRIMES) {
    if (p * p > rest) break;
    if (rest % p) continue;
    let e = 0n;
    while (rest % p === 0n) { rest /= p; e++; }
    outside *= p ** (e / K);
    inside *= p ** (e % K);
  }
  if (rest > 1n) {
    const r = exactRoot(rest, k);
    if (r !== null) outside *= r;
    else inside *= rest;
  }
  return { outside, inside };
}
