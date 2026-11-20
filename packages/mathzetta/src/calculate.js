/**
 * 'mathzetta/calculate' — exact calculation, and what `{{...}}` blocks use:
 * loading this module registers calculateBlock with the parser.
 *
 *   calculate('1/3 + 1/6').text        '1/2'
 *   calculate('sqrt(8)').text          '2*sqrt(2)'
 *   calculate('sin(pi/3)').text        'sqrt(3)/2'
 *   calculate('2^100').text            '1267650600228229401496703205376'
 *   calculate('0.1 + 0.2').text        '0.3'
 *   calculate('\\int_0^1 x^2 dx').text '1/3'
 *   calculate('x^2', { x: 3 }).value   9
 *
 * Values are kept exact while they can be: whole numbers of any size and
 * fractions (BigInt), and products c · π^k · e^m · ⁿ√r — enough for every
 * surd, the standard angles and their trig values, and logs that come out
 * whole. Anything else becomes a double. Derivatives, definite integrals,
 * limits and infinite sums are found numerically; a numeric answer that is
 * a simple fraction, or one times π, π², e or a small square root, is
 * reported exactly (∑ 1/n² = π²/6).
 *
 * Two kinds of failure are told apart:
 *   MathError     the math has no answer: 1/0, √−1, 0^0, a divergent integral
 *   UnknownError  it can't be worked out: an unset variable, an indefinite integral
 * `{{...}}` shows the first as "undefined" and leaves the second as written.
 *
 * Nothing here runs generated code.
 */

import { asTree, firstVariable } from './tree.js';
import { expandChain, percentDecimal } from './common.js';
import { matrixArithmetic, isMatrixValue, isVectorValue } from './matrix.js';
import { evaluate as floatEvaluate } from './evaluate.js';
import { parseTree, setBlockHandler } from './parse/index.js';

export class MathError extends Error {}
export class UnknownError extends Error {}

const LIMITS = {
    bits: 200000,        // largest exact number kept, in bits (~60,000 digits)
    factorial: 20000,    // n! computed exactly up to here
    terms: 100000,       // finite sums and products done term by term up to here
    rootIndex: 12,       // combine ⁿ√a · ᵐ√b exactly when lcm(n, m) ≤ this
    steps: 5000000,      // nodes worked out in one calculate() (a sum of sums, a sum to ∞ of a sum to ∞): about a second
    places: 10000,       // decimal places round, fixed and {{~n …}} write at most (10^places is a BigInt)
};

// the work of the calculate() call in progress: every calc() is a step (nested calls share it)
let steps = 0;
/** Work that isn't a node: a factorial's multiplications, a matrix product's entries. */
function charge(work) {
    steps += work;
    if (steps > LIMITS.steps) throw new UnknownError('too much to work out');
}
/** Multiplying `count` numbers into one of `bits` bits costs about count × its length in words. */
const chargeProduct = (count, bits) => charge((Number(count) * (bits / 64)) / 128);
let depth = 0;

// ---- rationals ------------------------------------------------------------------------

const babs = (n) => (n < 0n ? -n : n);
const BIG = 0xFFFFFFFFFFFFn;   // 48 bits: below this a gcd is cheap
const bitLength = (n) => (n === 0n ? 0 : babs(n).toString(2).length);
function bgcd(a, b) {
    a = babs(a);
    b = babs(b);
    while (b) [a, b] = [b, a % b];
    return a;
}

/** n/d in lowest terms with d > 0. */
function Q(n, d = 1n) {
    if (d === 0n) throw new MathError('division by zero');
    if (d < 0n) { n = -n; d = -d; }
    // the step budget counts work, not nodes: a gcd of big numbers costs about the square of their length
    // (∑ 1/i to 8000 is 8000 nodes, and 15 s of gcds without this)
    if (d > BIG && (n > BIG || -n > BIG)) {   // gcd(n, 1) is one step; it is the smaller of the two that costs
        const words = Math.min(n.toString(16).length - (n < 0n ? 1 : 0), d.toString(16).length) / 16;
        steps += 1 + (words * words) / 2;
        if (steps > LIMITS.steps) throw new UnknownError('too much to work out');
    }
    const g = bgcd(n, d) || 1n;
    return { n: n / g, d: d / g };
}
const Q0 = Q(0n);
const Q1 = Q(1n);
const qadd = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d);
const qmul = (a, b) => Q(a.n * b.n, a.d * b.d);
const qdiv = (a, b) => Q(a.n * b.d, a.d * b.n);
const qneg = (a) => ({ n: -a.n, d: a.d });
const qcmp = (a, b) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
const qfloor = (a) => { const f = a.n / a.d; return a.n < 0n && f * a.d !== a.n ? f - 1n : f; };

function qToFloat(q) {
    if (q.n < 0n) return -qToFloat(qneg(q));   // >> rounds a negative BigInt down: -1 >> 5n is -1, not 0
    const ln = bitLength(q.n);
    const ld = bitLength(q.d);
    if (ln < 1000 && ld < 1000) return Number(q.n) / Number(q.d);
    const shift = BigInt(Math.max(ln, ld) - 1000);
    const d = q.d >> shift;
    return d === 0n ? (q.n < 0n ? -Infinity : Infinity) : Number(q.n >> shift) / Number(d);
}

/**
 * A decimal as written → exact fraction: '0.5', '.25', '-3', '1e-7',
 * and MathZetta's repeating decimals: '1.333..' is 4/3, '0.1212..' is 4/33.
 */
function decimalToQ(text) {
    let s = String(text).trim();
    let sign = 1n;
    if (s.startsWith('-')) { sign = -1n; s = s.slice(1); }
    const repeating = s.endsWith('..');
    if (repeating) s = s.slice(0, -2);
    let exponent = 0;
    const e = s.search(/e/i);
    if (e >= 0) { exponent = Number(s.slice(e + 1)); s = s.slice(0, e); }
    const [whole = '', frac = ''] = s.split('.');
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac) || !(whole + frac)) throw new UnknownError(`'${text}' is not a number`);
    let value;
    if (repeating && frac) {
        // The shortest block that ends the digits at least twice repeats; one digit if none does.
        let L = 1;
        for (let k = 1; 2 * k <= frac.length; k++) {
            if (frac.slice(-k) === frac.slice(-2 * k, -k)) { L = k; break; }
        }
        const block = frac.slice(-L);
        let prefix = frac;
        while (prefix.endsWith(block)) prefix = prefix.slice(0, -L);
        const P = BigInt(prefix || '0');
        const all = BigInt(prefix + block);
        value = qadd(Q(BigInt(whole || '0')), Q(all - P, (10n ** BigInt(L) - 1n) * 10n ** BigInt(prefix.length)));
    } else {
        value = Q(BigInt(whole + frac || '0'), 10n ** BigInt(frac.length));
    }
    if (Math.abs(exponent) > LIMITS.bits / 3) throw new UnknownError('too large to calculate');   // 1e999999999: no 10^999999999
    if (exponent) value = exponent > 0 ? qmul(value, Q(10n ** BigInt(exponent))) : qdiv(value, Q(10n ** BigInt(-exponent)));
    return sign < 0n ? qneg(value) : value;
}

// ---- values ------------------------------------------------------------------------------
//
//   exact   { kind: 'x', c: Q, pi: k, e: m, root: null | { n, r } }   c · π^k · e^m · ⁿ√r
//   double  a JS number (±Infinity included; NaN never escapes)
//   also    booleans, { kind: 's', text } strings, and arrays with a .group ('()', '{}', 'pm', …)

function X(c, pi = 0, e = 0, root = null) {
    if (c.n === 0n) return { kind: 'x', c: Q0, pi: 0, e: 0, root: null };
    return { kind: 'x', c, pi, e, root };
}
const rat = (n, d = 1n) => X(Q(BigInt(n), BigInt(d)));
const PI = X(Q1, 1);
const E = X(Q1, 0, 1);
const isX = (v) => v !== null && typeof v === 'object' && v.kind === 'x';
const isRat = (v) => isX(v) && !v.pi && !v.e && !v.root;
const isZero = (v) => (isX(v) ? v.c.n === 0n : v === 0);
const wholeOf = (v) => (isRat(v) && v.c.d === 1n ? v.c.n : null);
const group = (items, kind) => Object.assign(items, { group: kind });
const str = (text) => ({ kind: 's', text });

function sameRoot(a, b) {
    if (!a || !b) return a === b;
    return a.n === b.n && a.r === b.r;
}
const equalX = (a, b) => qcmp(a.c, b.c) === 0 && a.pi === b.pi && a.e === b.e && sameRoot(a.root, b.root);

/** A double, for anything numeric. */
function num(v) {
    if (typeof v === 'number') return v;
    if (isX(v)) {
        let x = qToFloat(v.c);
        if (v.pi) x *= Math.PI ** v.pi;
        if (v.e) x *= Math.E ** v.e;
        if (v.root) x *= qToFloat(Q(v.root.r)) ** (1 / v.root.n);
        return x;
    }
    if (typeof v === 'boolean') return v ? 1 : 0;
    throw new UnknownError('not a number');
}

/**
 * A double result. NaN means the math has no answer; ±∞ from finite
 * inputs means a number too big for a double, which is left as written.
 */
function checked(x, ...inputs) {
    if (Number.isNaN(x)) throw new MathError('undefined');
    if (!Number.isFinite(x) && inputs.every(Number.isFinite)) throw new UnknownError('too large to calculate');
    return x;
}

const truthy = (v) => (typeof v === 'boolean' ? v : isX(v) ? v.c.n !== 0n : typeof v === 'number' ? v !== 0 : Boolean(v));

/** A JS value (from a scope) → a value. Whole numbers and decimals are exact. */
function fromJS(v) {
    if (typeof v === 'bigint') return X(Q(v));
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return v;
        return X(Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? Q(BigInt(v)) : decimalToQ(String(v)));
    }
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        if (/^-?(\d+\.?\d*|\.\d+)(\.\.)?$/.test(v.trim())) return X(decimalToQ(v));
        return calc(parseTree(v), {});   // '1/3', 'sqrt(2)'
    }
    if (Array.isArray(v)) {
        // a JS array of equally long arrays is a matrix: [[1, 2], [3, 4]]
        if (!v.group && isMatrixValue(v)) return group(v.map((r) => group(r.map(fromJS), '[]')), '[]');
        return group(v.map(fromJS), v.group || '()');
    }
    if (isX(v) || typeof v === 'function') return v;
    throw new UnknownError(`can't use ${typeof v} as a value`);
}

/** A value → plain JS: numbers, booleans, strings, arrays. */
function toJS(v) {
    if (Array.isArray(v)) return v.map(toJS);
    if (v && v.kind === 's') return v.text;
    if (typeof v === 'boolean') return v;
    return num(v);
}

// ---- roots ----------------------------------------------------------------------------------

/** ⌊ⁿ√a⌋ for a ≥ 0. */
function iroot(a, n) {
    if (a < 2n) return a;
    const N = BigInt(n);
    let x = 1n << BigInt(Math.ceil(bitLength(a) / n));
    for (;;) {
        const y = ((N - 1n) * x + a / x ** (N - 1n)) / N;
        if (y >= x) return x;
        x = y;
    }
}

/** ⁿ√r (r > 0 whole) as k·ᵐ√s with s free of m-th powers and m as small as possible. */
function simplifyRoot(n, r) {
    let coef = 1n;
    let rest = r;
    const N = BigInt(n);
    const limit = rest < 10n ** 24n ? 1000000n : 10000n;
    let tried = 0;
    for (let p = 2n; p <= limit && p * p <= rest; p += p === 2n ? 1n : 2n) {
        const pn = p ** N;
        while (rest % pn === 0n) { rest /= pn; coef *= p; }
        tried++;
    }
    steps += tried / 4;   // up to half a million trial divisions: charged to the budget like the nodes they stand for
    const whole = iroot(rest, n);
    if (whole ** N === rest) { coef *= whole; rest = 1n; }
    if (rest === 1n) return { coef, root: null };
    // ⁴√9 = √3: use a smaller index when the radicand is a perfect power.
    for (let k = n; k >= 2; k--) {
        if (n % k !== 0) continue;
        const s = iroot(rest, k);
        if (s ** BigInt(k) === rest) return { coef, root: { n: n / k, r: s } };
    }
    return { coef, root: { n, r: rest } };
}

/** c · ⁿ√r as an exact value. */
function withRoot(c, n, r, pi = 0, e = 0) {
    if (r === 0n) return X(Q0);
    const { coef, root } = simplifyRoot(n, r);
    if (root && root.n === 1) return X(qmul(c, Q(coef * root.r)), pi, e);
    return X(qmul(c, Q(coef)), pi, e, root);
}

/** ⁿ√(a/b) for a fraction ≥ 0: ⁿ√(a·bⁿ⁻¹) / b. Null if too big to keep exact. */
function rootOfQ(q, n) {
    const r = q.n * q.d ** BigInt(n - 1);
    if (bitLength(r) > 4000) return null;
    return withRoot(Q(1n, q.d), n, r);
}

// ---- exact arithmetic (null when the answer isn't of the exact form) -----------------------

function mulX(a, b) {
    const c = qmul(a.c, b.c);
    if (bitLength(c.n) + bitLength(c.d) > LIMITS.bits) return null;
    const pi = a.pi + b.pi;
    const e = a.e + b.e;
    if (!a.root || !b.root) return X(c, pi, e, a.root || b.root);
    const l = lcm(a.root.n, b.root.n);
    if (l > LIMITS.rootIndex) return null;
    const r = a.root.r ** BigInt(l / a.root.n) * b.root.r ** BigInt(l / b.root.n);
    if (bitLength(r) > 4000) return null;
    return withRoot(c, l, r, pi, e);
}

function invX(a) {
    if (a.c.n === 0n) throw new MathError('division by zero');
    const base = X(qdiv(Q1, a.c), -a.pi, -a.e);
    if (!a.root) return base;
    const { n, r } = a.root;   // 1/ⁿ√r = ⁿ√(rⁿ⁻¹) / r
    return mulX(base, withRoot(Q(1n, r), n, r ** BigInt(n - 1)));
}

function addX(a, b) {
    if (a.c.n === 0n) return b;
    if (b.c.n === 0n) return a;
    if (a.pi !== b.pi || a.e !== b.e || !sameRoot(a.root, b.root)) return null;
    const c = qadd(a.c, b.c);
    if (bitLength(c.n) + bitLength(c.d) > LIMITS.bits) return null;
    return X(c, a.pi, a.e, a.root);
}

/** aᵏ for a whole k. */
function powWhole(a, k) {
    if (k === 0n) {
        if (a.c.n === 0n) throw new MathError('0^0 is undefined');
        return X(Q1);
    }
    if (k < 0n) {
        const inv = invX(a);
        return inv && powWhole(inv, -k);
    }
    const size = (bitLength(a.c.n) + bitLength(a.c.d) + (a.root ? bitLength(a.root.r) : 0)) * Number(k);
    if (size > LIMITS.bits || k > 100000n) return null;
    const c = Q(a.c.n ** k, a.c.d ** k);
    const K = Number(k);
    if (!a.root) return X(c, a.pi * K, a.e * K);
    const { n, r } = a.root;   // (ⁿ√r)ᵏ = r^⌊k/n⌋ · ⁿ√(r^(k mod n))
    const out = r ** (k / BigInt(n));
    return withRoot(qmul(c, Q(out)), n, r ** (k % BigInt(n)) || 1n, a.pi * K, a.e * K);
}

/** a^(p/q) for a fraction p/q with q > 1; only fractions a are kept exact. */
function powFraction(a, p, q) {
    if (!isRat(a) || q > 1000n) return null;
    const ap = powWhole(a, p);
    if (!ap) return null;
    let { n, d } = ap.c;
    let negative = false;
    if (n < 0n) {
        if (q % 2n === 0n) throw new MathError('not a real number');
        negative = true;
        n = -n;
    }
    const r = rootOfQ({ n, d }, Number(q));
    if (!r) return null;
    return negative ? X(qneg(r.c), r.pi, r.e, r.root) : r;
}

// ---- operations, with arrays handled element by element ------------------------------------

function each1(f) {
    return (a) => (Array.isArray(a) ? group(a.map((x) => each1(f)(x)), a.group) : f(a));
}
function each2(f) {
    const g = (a, b) => {
        const A = Array.isArray(a);
        const B = Array.isArray(b);
        if (A && B) {
            if (a.length !== b.length) throw new MathError('lists of different lengths');
            return group(a.map((x, i) => g(x, b[i])), a.group);
        }
        if (A) return group(a.map((x) => g(x, b)), a.group);
        if (B) return group(b.map((y) => g(a, y)), b.group);
        return f(a, b);
    };
    return g;
}

const add = each2((a, b) => (isX(a) && isX(b) && addX(a, b)) || checked(num(a) + num(b), num(a), num(b)));
const neg = each1((a) => (isX(a) ? X(qneg(a.c), a.pi, a.e, a.root) : -num(a)));
const sub = (a, b) => add(a, neg(b));
const mul = each2((a, b) => (isX(a) && isX(b) && mulX(a, b)) || checked(num(a) * num(b), num(a), num(b)));
const div = each2((a, b) => {
    if (isZero(b)) throw new MathError('division by zero');
    if (isX(a) && isX(b)) {
        const inv = invX(b);
        const r = inv && mulX(a, inv);
        if (r) return r;
    }
    return checked(num(a) / num(b), num(a), num(b));
});

const pow = each2((a, b) => {
    if (isX(a) && isRat(b)) {
        const { n: p, d: q } = b.c;
        const r = q === 1n ? powWhole(a, p) : powFraction(a, p, q);
        if (r) return r;
    }
    const x = num(a);
    const y = num(b);
    if (x === 0 && y === 0) throw new MathError('0^0 is undefined');
    if (x === 0 && y < 0) throw new MathError('division by zero');
    if (x < 0 && !Number.isInteger(y)) throw new MathError('not a real number');
    const r = x ** y;
    if (r === 0 && x !== 0) throw new UnknownError('too small to calculate');   // 10^-50000: past both exact and double
    return checked(r, x, y);
});

/** −1, 0 or 1; exact for fractions, with a little tolerance for doubles. */
function compare(a, b) {
    if (isRat(a) && isRat(b)) return qcmp(a.c, b.c);
    if (isX(a) && isX(b) && equalX(a, b)) return 0;
    const x = num(a);
    const y = num(b);
    if (x === y) return 0;
    // Two exact values (e^-30, π/10^13, √2) are known to every digit a double holds: only a relative difference
    // can be rounding, so e^-30 > 0. Doubles carry their own error, so near 0 an absolute one is allowed too.
    const scale = isX(a) && isX(b) ? Math.max(Math.abs(x), Math.abs(y)) : Math.max(1, Math.abs(x), Math.abs(y));
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-12 * scale) return 0;
    return x < y ? -1 : 1;
}

function equal(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
    }
    // text equals only the same text, whichever side it is on: 1 = "a" is false, as "a" = 1 is
    if ((a && a.kind === 's') || (b && b.kind === 's')) return Boolean(a && a.kind === 's' && b && b.kind === 's' && a.text === b.text);
    if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
    return compare(a, b) === 0;
}

// ---- functions ------------------------------------------------------------------------------

/** k·π/12 as the whole number k (mod 24), for the exact trig table. */
function twelfths(v) {
    if (isZero(v)) return 0;
    if (!isX(v) || v.pi !== 1 || v.e || v.root) return null;
    const k = qmul(v.c, Q(12n));
    if (k.d !== 1n) return null;
    return Number(((k.n % 24n) + 24n) % 24n);
}

const half = () => rat(1, 2);
const SIN_TABLE = {   // sin(kπ/12) for the first quadrant
    0: () => rat(0), 2: half, 3: () => withRoot(Q(1n, 2n), 2, 2n), 4: () => withRoot(Q(1n, 2n), 2, 3n), 6: () => rat(1),
};
function sinK(k) {
    k = ((k % 24) + 24) % 24;
    const [ref, sign] = k <= 6 ? [k, 1] : k <= 12 ? [12 - k, 1] : k <= 18 ? [k - 12, -1] : [24 - k, -1];
    const f = SIN_TABLE[ref];
    if (!f) return null;
    return sign < 0 ? neg(f()) : f();
}
const cosK = (k) => sinK(k + 6);

/** Doubles that should be 0, like sin(π) = 1.2e-16. */
const snap = (x, input) => (Math.abs(x) < 1e-15 && Math.abs(input) > 1e-6 ? 0 : x);

function trig(name, v) {
    const k = twelfths(v);
    if (k !== null) {
        const s = sinK(k);
        const c = cosK(k);
        if (s && c) {
            switch (name) {
                case 'sin': return s;
                case 'cos': return c;
                case 'tan': return div(s, c);
                case 'cot': return div(c, s);
                case 'sec': return div(rat(1), c);
                case 'csc': return div(rat(1), s);
            }
        }
    }
    const x = num(v);
    const s = snap(Math.sin(x), x);
    const c = snap(Math.cos(x), x);
    const out = { sin: s, cos: c, tan: s / c, cot: c / s, sec: 1 / c, csc: 1 / s }[name];
    if (!Number.isFinite(out) && Number.isFinite(x)) throw new MathError('undefined');
    return checked(out);
}

function inverseTrig(name, v) {
    const range = { arcsin: [-6, 6], arccos: [0, 12], arctan: [-5, 5] }[name];
    const value = (k) => (name === 'arcsin' ? sinK(k) : name === 'arccos' ? cosK(k) : (cosK(k) && !isZero(cosK(k)) ? div(sinK(k), cosK(k)) : null));
    if (isX(v)) {
        for (let k = range[0]; k <= range[1]; k++) {
            const t = value(k);
            if (t && isX(t) && equalX(t, v)) return X(Q(BigInt(k), 12n), 1);
        }
    }
    const x = num(v);
    if (name !== 'arctan' && Math.abs(x) > 1) throw new MathError('not a real number');
    return { arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan }[name](x);
}

function ln(v) {
    if (isX(v)) {
        if (v.c.n === 0n) throw new MathError('ln 0 is undefined');
        if (v.c.n < 0n) throw new MathError('not a real number');
        if (v.c.n === 1n && v.c.d === 1n && !v.pi && !v.root) return rat(v.e);   // ln eᵐ = m
    }
    const x = num(v);
    if (x <= 0) throw new MathError(x === 0 ? 'ln 0 is undefined' : 'not a real number');
    return Math.log(x);
}

/** log_b x, exact when x is a rational power of b: log₂ 8 = 3, log₄ 2 = 1/2. */
function log(base, x) {
    if (isX(base) && equalX(base, E)) return ln(x);
    const b = num(base);
    const y = num(x);
    if (b <= 0 || b === 1) throw new MathError('not a valid base');
    if (y <= 0) throw new MathError(y === 0 ? 'log 0 is undefined' : 'not a real number');
    const f = Math.log(y) / Math.log(b);
    if (isRat(base) && isRat(x)) {
        for (let q = 1n; q <= 12n; q++) {
            const p = Math.round(f * Number(q));
            if (Math.abs(f * Number(q) - p) > 1e-9) continue;
            const lhs = powWhole(base, BigInt(p));
            const rhs = powWhole(x, q);
            if (lhs && rhs && equalX(lhs, rhs)) return X(Q(BigInt(p), q));
        }
    }
    return f;
}

/** Γ(x) for doubles (Lanczos), so (1/2)! works. */
function gamma(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    const g = 7;
    const C = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
        12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    x -= 1;
    let a = C[0];
    const t = x + g + 0.5;
    for (let i = 1; i < 9; i++) a += C[i] / (x + i);
    return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a;
}

function factorial(v) {
    const n = wholeOf(v) ?? (typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : null);
    if (n !== null) {
        if (n < 0n) throw new MathError('factorial of a negative number');
        if (n > BigInt(LIMITS.factorial)) throw new UnknownError('too large to calculate');
        chargeProduct(n, Number(n) * Math.log2(Number(n) + 1));   // ∑ 0·20000! a thousand times is a thousand factorials
        let r = 1n;
        for (let i = 2n; i <= n; i++) r *= i;
        return X(Q(r));
    }
    const x = num(v);
    if (x < 0 && Number.isInteger(x)) throw new MathError('factorial of a negative number');
    return checked(gamma(x + 1), x);
}

function whole(v, what) {
    const n = wholeOf(v) ?? (typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : null);
    if (n === null) throw new MathError(`${what} needs whole numbers`);
    return n;
}

/** n·(n−1)···(n−k+1) has at most k·log₂ n bits: past the exact limit, refuse before multiplying. */
const tooBig = (n, k) => Number(k) * bitLength(n) > LIMITS.bits;

function perm(nv, kv) {
    const n = whole(nv, 'permutations');
    const k = whole(kv, 'permutations');
    if (k < 0n || k > n) throw new MathError('undefined');
    if (k > BigInt(LIMITS.terms) || tooBig(n, k)) throw new UnknownError('too large to calculate');
    chargeProduct(k, Number(k) * bitLength(n));
    let r = 1n;
    for (let i = n - k + 1n; i <= n; i++) r *= i;
    return X(Q(r));
}

function comb(nv, kv) {
    const n = whole(nv, 'combinations');
    let k = whole(kv, 'combinations');
    if (k < 0n || k > n) throw new MathError('undefined');
    if (n - k < k) k = n - k;
    if (k > BigInt(LIMITS.terms) || tooBig(n, k)) throw new UnknownError('too large to calculate');
    chargeProduct(2n * k, Number(k) * bitLength(n));
    let r = 1n;
    for (let i = 1n; i <= k; i++) r = (r * (n - k + i)) / i;
    return X(Q(r));
}

const floorV = each1((v) => (isRat(v) ? X(Q(qfloor(v.c))) : fromJS(Math.floor(num(v)))));
const ceilV = each1((v) => (isRat(v) ? X(Q(-qfloor(qneg(v.c)))) : fromJS(Math.ceil(num(v)))));

/** Round half away from zero to `places` decimals. */
function roundV(v, placesV) {
    const places = Number(whole(placesV, 'round'));
    if (Math.abs(places) > LIMITS.places) throw new UnknownError('too many decimal places');
    if (isRat(v)) {
        const scale = Q(10n ** BigInt(Math.abs(places)));
        const scaled = places >= 0 ? qmul(v.c, scale) : qdiv(v.c, scale);
        const twice = qfloor(qadd(qmul(Q(2n), Q(babs(scaled.n), scaled.d)), Q1)) / 2n;   // ⌊|x| + ½⌋
        const r = Q(scaled.n < 0n ? -twice : twice);
        return X(places >= 0 ? qdiv(r, scale) : qmul(r, scale));
    }
    if (places > 15) return num(v);   // a double holds no more digits than that: π to 400 places is π
    const f = 10 ** places;
    if (f === 0) return 0;            // round(π, -400)
    return Math.sign(num(v)) * Math.round(Math.abs(num(v)) * f) / f;
}

/** round(v, places), then written with exactly that many decimals — a text. */
function fixedV(v, placesV) {
    const places = Number(whole(placesV, 'fixed'));
    if (places < 0) throw new MathError('fixed needs 0 or more decimal places');
    const r = roundV(v, placesV);
    if (isRat(r)) {
        // r is k / 10^places exactly, so k is a whole number
        const k = (r.c.n * 10n ** BigInt(places)) / r.c.d;
        const digits = (k < 0n ? -k : k).toString().padStart(places + 1, '0');
        return str(`${k < 0n ? '-' : ''}${digits.slice(0, digits.length - places)}${places ? '.' + digits.slice(-places) : ''}`);
    }
    return str(fixedDouble(num(r), places));
}

/** x with exactly `places` decimals: toFixed goes to 100, and a double has no digits past that to show. */
const fixedDouble = (x, places) => x.toFixed(Math.min(places, 100)) + (places > 100 ? '0'.repeat(places - 100) : '');

function modV(a, b) {
    if (isZero(b)) throw new MathError('division by zero');
    if (isRat(a) && isRat(b)) return X(qadd(a.c, qneg(qmul(b.c, Q(qfloor(qdiv(a.c, b.c)))))));
    const x = num(a);
    const y = num(b);
    return checked(((x % y) + y) % y);
}

const lcm = (a, b) => (a / gcdN(a, b)) * b;
const gcdN = (a, b) => (b ? gcdN(b, a % b) : a);

// ---- the evaluator --------------------------------------------------------------------------

const CONSTANTS = {
    pi: () => PI, 'π': () => PI, tau: () => X(Q(2n), 1), 'τ': () => X(Q(2n), 1), e: () => E,
    '∞': () => Infinity, '-∞': () => -Infinity, true: () => true, false: () => false,
};

const ONE = {
    abs: (a) => (isX(a) ? X(Q(babs(a.c.n), a.c.d), a.pi, a.e, a.root) : Math.abs(num(a))),
    floor: floorV, ceil: ceilV,
    sqrt: (a) => pow(a, rat(1, 2)),
    ln: each1(ln),
    loglog: each1((a) => ln(ln(a))), logloglog: each1((a) => ln(ln(ln(a)))),
    expm1: each1((a) => (isZero(a) ? rat(0) : Math.expm1(num(a)))),
    sinh: each1((a) => (isZero(a) ? rat(0) : Math.sinh(num(a)))),
    cosh: each1((a) => (isZero(a) ? rat(1) : Math.cosh(num(a)))),
    tanh: each1((a) => (isZero(a) ? rat(0) : Math.tanh(num(a)))),
    arcsinh: each1((a) => (isZero(a) ? rat(0) : Math.asinh(num(a)))),
    arccosh: each1((a) => { const x = num(a); if (x < 1) throw new MathError('not a real number'); return x === 1 ? rat(0) : Math.acosh(x); }),
    arctanh: each1((a) => { const x = num(a); if (Math.abs(x) >= 1) throw new MathError('undefined'); return isZero(a) ? rat(0) : Math.atanh(x); }),
    '!': each1(factorial),
    neg,
    pm: (a) => group([a, neg(a)], 'pm'),
    '\\not': (a) => !truthy(a),
};
ONE.det = (a) => MATRIX_FUNCTIONS.det(a);
for (const f of ['sin', 'cos', 'tan', 'csc', 'sec', 'cot']) ONE[f] = each1((a) => trig(f, a));
for (const f of ['arcsin', 'arccos', 'arctan']) ONE[f] = each1((a) => inverseTrig(f, a));

// ---- matrices: a list of equally long lists ([[1, 2], [3, 4]]) or a pmatrix / bmatrix ----------

const MATRIX_KINDS = new Set(['pmatrix', 'bmatrix']);
/** A matrix value: rows (each a [] list) of entries, marked pmatrix, bmatrix, or a list of lists. */
const isMatrix = (v) => isMatrixValue(v) && (MATRIX_KINDS.has(v.group) || (v.group === '[]' && v.every((r) => r.group === '[]') && (v.length > 1 || v[0].length > 1)));
const isVector = (v) => isVectorValue(v) && !isMatrix(v) && v.group !== 'pm';
const M = matrixArithmetic({
    add, sub, mul, div,
    charge,
    isZero: (x) => (isX(x) ? x.c.n === 0n : Math.abs(num(x)) < 1e-12),
    zero: () => rat(0), one: () => rat(1),
    size: (x) => Math.abs(num(x)),
    fail: (message) => { throw new MathError(message); },
    make: (rows, like) => group(rows.map((r) => group(r, '[]')), like && like.group ? like.group : 'bmatrix'),
});
const asVector = (xs, like) => group(xs, like && like.group ? like.group : '[]');
/** det(A), and det([[1, 2], [3, 4]]), whose brackets are read as the call's: its rows arrive one per argument. */
const matrixOnly = (name, f) => (...vs) => {
    const v = vs.length > 1 && vs.every(isVector) ? group(vs.map((r) => group(r, '[]')), '[]') : vs[0];
    if (vs.length > 1 && v === vs[0]) throw new UnknownError(`${name} of more than one thing`);
    if (!isMatrix(v)) throw new UnknownError(`${name} of something that isn't a matrix`);
    return f(v);
};

/** A × B: the matrix product for matrices (and a matrix with a vector), entry by entry otherwise. */
function times(a, b) {
    if (isMatrix(a) && isMatrix(b)) return M.times(a, b);
    if (isMatrix(a) && isVector(b)) return asVector(M.timesVector(a, b), b);
    if (isVector(a) && isMatrix(b)) return asVector(M.vectorTimes(a, b), a);
    return mul(a, b);
}

/** A / B is A · B⁻¹ when B is a matrix. */
const over = (a, b) => (isMatrix(b) ? times(a, M.inverse(b)) : div(a, b));

/** A^n: a matrix power (n < 0 uses the inverse). */
function power(a, b) {
    if (!isMatrix(a)) return pow(a, b);
    const n = wholeOf(b);
    if (n === null) throw new UnknownError('a matrix to a power that is not a whole number');
    return M.power(a, n);
}

/** Matrix functions, written det(A), inv(A) …; a scope's own function of the same name comes first. */
const MATRIX_FUNCTIONS = {
    det: matrixOnly('det', M.det),
    inv: matrixOnly('inv', M.inverse), inverse: matrixOnly('inverse', M.inverse),
    transpose: matrixOnly('transpose', M.transpose),
    trace: matrixOnly('trace', M.trace), tr: matrixOnly('tr', M.trace),
    rank: matrixOnly('rank', (A) => rat(M.rank(A))),
    rref: matrixOnly('rref', M.rref),
    identity: (n) => { const k = wholeOf(n); if (k === null || k < 1n || k > 100n) throw new UnknownError('identity(n) needs a whole number n'); return M.identity(Number(k)); },
    dot: (u, v) => { if (!isVector(u) || !isVector(v)) throw new UnknownError('dot of something that isn\'t a vector'); return M.dot(u, v); },
    cross: (u, v) => { if (!isVector(u) || !isVector(v)) throw new UnknownError('cross of something that isn\'t a vector'); return asVector(M.cross(u, v), u); },
    linsolve: (A, b) => {
        if (!isMatrix(A) || !(isMatrix(b) || isVector(b))) throw new UnknownError('linsolve(A, b) needs a matrix and a vector');
        return isMatrix(b) ? M.solve(A, b) : asVector(M.solve(A, b), b);
    },
};

/** pmatrix(…) and bmatrix(…): each argument a row ([] list, or one entry). */
function matrixOf(node, v) {
    const rows = node.args.map((r) => group(r.type === 'op' && r.op === '[]' ? r.args.map(v) : [v(r)], '[]'));
    if (rows.some((r) => r.length !== rows[0].length)) throw new MathError('rows of different lengths');
    return group(rows, node.op === 'vmatrix' ? 'bmatrix' : node.op);
}

const TWO = {
    '+': add, '-': sub, '*': times, '/': over, '^': power,
    '±': (a, b) => group([add(a, b), sub(a, b)], 'pm'),
    mod: each2(modV),
    log: each2(log),
    root: each2((n, x) => pow(x, div(rat(1), n))),
    atan2: (y, x) => Math.atan2(num(y), num(x)),
    round: roundV,
    fixed: fixedV,
    perm, comb,
    '=': (a, b) => equal(a, b), '===': (a, b) => equal(a, b),
    '≠': (a, b) => !equal(a, b), '≠=': (a, b) => !equal(a, b),
    '≈': (a, b) => Math.abs(num(a) - num(b)) <= 1e-9 * Math.max(1, Math.abs(num(a)), Math.abs(num(b))),
    '<': (a, b) => compare(a, b) < 0, '>': (a, b) => compare(a, b) > 0,
    '≤': (a, b) => compare(a, b) <= 0, '≥': (a, b) => compare(a, b) >= 0,
    '&': (a, b) => truthy(a) && truthy(b), '|': (a, b) => truthy(a) || truthy(b),
    '\\xor': (a, b) => truthy(a) !== truthy(b), '\\nor': (a, b) => !(truthy(a) || truthy(b)),
    '\\nand': (a, b) => !(truthy(a) && truthy(b)),
};

const MANY = {
    sum: (xs) => xs.reduce((s, x) => add(s, x), rat(0)),
    prod: (xs) => xs.reduce((s, x) => mul(s, x), rat(1)),
    max: (xs) => xs.reduce((m, x) => (compare(x, m) > 0 ? x : m)),
    min: (xs) => xs.reduce((m, x) => (compare(x, m) < 0 ? x : m)),
    mean: (xs) => div(MANY.sum(xs), rat(xs.length)),
    gcd: (xs) => X(Q(xs.map((x) => whole(x, 'gcd')).reduce(bgcd))),
};

/** Operators left to the double-precision evaluator (set operations, random): membership and pmod are worked out exactly first. */
const DELEGATED = ['∈', '∉', '∪', '∩', 'pmod', 'random', '(]', '[)'];

/** a ≡ b (mod n), x mod n written (mod n): exact, so 2^100 ≡ 1 (mod 3) holds (doubles lose the last digits). */
function congruence([statement, modulus], v) {
    const n = v(modulus);
    if (statement.type === 'op' && ['≡', '='].includes(statement.op) && statement.args.length === 2) {
        return isZero(modV(sub(v(statement.args[0]), v(statement.args[1])), n));
    }
    return modV(v(statement), n);
}

/** x ∈ ℤ, x ∈ {1, 2}, x ∈ [0, 1): exact where the parts are; undefined to leave it to doubles. */
function membershipExact(node, v) {
    const [xNode, set] = node.args;
    const x = v(xNode);
    let inside;
    if (set.type === 'symbol' && ['ℤ', 'ℕ', 'ℚ', 'ℝ'].includes(set.value) && isX(x)) {
        if (set.value === 'ℝ') inside = true;
        else if (set.value === 'ℚ') inside = isRat(x);   // π and √2 are exact, and known not to be fractions
        else inside = isRat(x) && x.c.d === 1n && (set.value === 'ℤ' || x.c.n > 0n);
    } else if (set.type === 'op' && ['()', '[]', '(]', '[)'].includes(set.op) && set.args.length === 2) {
        const [lo, hi] = set.args.map(v);
        const above = compare(x, lo);
        const below = compare(x, hi);
        inside = (set.op[0] === '[' ? above >= 0 : above > 0) && (set.op[1] === ']' ? below <= 0 : below < 0);
    } else if (set.type === 'op' && set.op === '{}') {
        inside = set.args.some((item) => equal(x, v(item)));   // {10^20} holds 10^20, not 10^20 + 1
    } else {
        return undefined;
    }
    return node.op === '∈' ? inside : !inside;
}

function calc(node, env) {
    if (++steps > LIMITS.steps) throw new UnknownError('too much to work out');
    switch (node.type) {
        case 'number': return X(decimalToQ(node.value));
        case 'string': return str(node.value.slice(1, -1));
        case 'symbol': return lookup(node.value, env);
    }
    const chained = expandChain(node);   // 3 < x < 7: both links
    if (chained) return calc(chained, env);
    const { op, args } = node;
    const v = (n) => calc(n, env);

    if (op === '?:') return truthy(v(args[0])) ? v(args[1]) : v(args[2]);
    if (op === '_') {
        if (args.every((a) => a.type !== 'op')) return lookup(`${args[0].value}_${args[1].value}`, env);
        throw new UnknownError('subscript');
    }
    if (op === 'der') return derivative(node, env);
    if (op === 'int') return integral(args, env);
    if (op === 'lim') return limit(args, env);
    if (op === '\\sumidx' || op === '\\prodidx') return series(op === '\\sumidx', args, env);
    if (['()', '[]', '{}'].includes(op)) return group(args.map(v), op);
    if (op === 'pmatrix' || op === 'bmatrix') return matrixOf(node, v);
    if (op === 'vmatrix') return M.det(matrixOf(node, v));
    // A^T: the transpose, unless T has a value
    if (op === '^' && args[1].type === 'symbol' && args[1].value === 'T' && !Object.prototype.hasOwnProperty.call(env, 'T')) {
        const m = v(args[0]);
        if (isMatrix(m)) return M.transpose(m);
    }
    if (op === 'pmod') return congruence(args, v);
    if (op === '∈' || op === '∉') {
        const inside = membershipExact(node, v);
        if (inside !== undefined) return inside;
    }
    if (DELEGATED.includes(op)) return delegate(node, env);
    if (op.startsWith('\\:')) {
        const name = op.slice(2);
        const f = Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined;   // valueOf(1): the scope's own only
        if (typeof f !== 'function' && Object.prototype.hasOwnProperty.call(MATRIX_FUNCTIONS, name)) return MATRIX_FUNCTIONS[name](...args.map(v));
        if (typeof f !== 'function') throw new UnknownError(`no function ${op.slice(2)}`);
        return fromJS(f(...args.map((a) => toJS(v(a)))));
    }
    if (ONE[op] && args.length === 1) return ONE[op](v(args[0]));
    if (TWO[op] && args.length === 2) return TWO[op](v(args[0]), v(args[1]));
    if (MANY[op]) return MANY[op](args.map(v));
    throw new UnknownError(`can't calculate '${op}'`);
}

function lookup(name, env) {
    if (Object.prototype.hasOwnProperty.call(env, name)) return env[name];
    if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) return CONSTANTS[name]();
    if (percentDecimal(name)) return X(decimalToQ(percentDecimal(name)));   // 50% is 1/2, exactly
    throw new UnknownError(`no value for '${name}'`);
}

function delegate(node, env) {
    const scope = {};
    for (const [k, val] of Object.entries(env)) if (typeof val !== 'function') scope[k] = toJS(val);
    try {
        return fromJS(floatEvaluate(node, scope));
    } catch (e) {
        throw new UnknownError(e.message);
    }
}

// ---- numeric calculus -----------------------------------------------------------------------

/** body as a function of one variable, in doubles; NaN where it is undefined. */
/**
 * The names an enclosing ∫, ∑, lim or d/dx is varying, kept on the environment beside the values. A plain
 * d/dx x³ is worked out only where x varies like this: a value the caller fixed (`{ x: 2 }`, a Markdown
 * `$x = 2$`) makes x a constant, and a derivative at a point is written der(f, x = 2).
 */
const BOUND = Symbol('bound');
const bind = (env, name, value) => ({ ...env, [name]: value, [BOUND]: new Set([...(env[BOUND] ?? []), name]) });

function asFunction(body, name, env) {
    return (t) => {
        try {
            const r = num(calc(body, bind(env, name, t)));
            return r;
        } catch (e) {
            if (e instanceof MathError) return NaN;
            throw e;
        }
    };
}

const variableName = (node) => (node.type === 'symbol' ? node.value : null);

/**
 * d/dx f at a point: der(f, x = a) at a (whatever x is outside), or der(f, x) where an enclosing ∫, ∑, lim
 * or d/dx is varying x (BOUND). Ridders' extrapolation, checked from both sides.
 */
function derivative(node, env) {
    const [body, by] = node.args;
    if (by.type === 'op' && by.op === '=') {
        const name = variableName(by.args[0]);
        if (!name) throw new UnknownError('a derivative at a point names its variable: der(f, x = a)');
        return slope(body, name, num(calc(by.args[1], env)), env);
    }
    const name = variableName(by);
    if (!name || !env[BOUND]?.has(name)) {
        throw new UnknownError(`a derivative needs a point: der(f, ${name || 'x'} = a)`);
    }
    return slope(body, name, num(env[name]), env);
}

/** The slope of body, as a function of `name`, at x. */
function slope(body, name, x, env) {
    const f = asFunction(body, name, env);
    if (!Number.isFinite(f(x))) throw new MathError('undefined');
    const small = 1e-6 * Math.max(1, Math.abs(x));
    const right = (f(x + small) - f(x)) / small;
    const left = (f(x) - f(x - small)) / small;
    if (!Number.isFinite(right) || !Number.isFinite(left) || Math.abs(right - left) > 1e-3 * Math.max(1, Math.abs(right))) {
        throw new MathError('not differentiable here');
    }
    let h = 0.1 * Math.max(1, Math.abs(x));
    const CON = 1.4;
    const table = [[(f(x + h) - f(x - h)) / (2 * h)]];
    let best = table[0][0];
    let err = Infinity;
    for (let i = 1; i < 12; i++) {
        h /= CON;
        table[i] = [(f(x + h) - f(x - h)) / (2 * h)];
        let fac = CON * CON;
        for (let j = 1; j <= i; j++) {
            table[i][j] = (table[i][j - 1] * fac - table[i - 1][j - 1]) / (fac - 1);
            fac *= CON * CON;
            const e = Math.max(Math.abs(table[i][j] - table[i][j - 1]), Math.abs(table[i][j] - table[i - 1][j - 1]));
            if (e <= err) { err = e; best = table[i][j]; }
        }
        if (Math.abs(table[i][i] - table[i - 1][i - 1]) >= 2 * err) break;
    }
    if (!Number.isFinite(best)) throw new MathError('not differentiable here');
    return recognize(best, err);
}

/** The integral's variable and limits from int(f), int(f, x), int(f, a, b), int(f, x, a, b). */
function integral(args, env) {
    const [f, second, third, fourth] = args;
    const isVar = (n) => n && n.type === 'symbol' && /^[a-zA-Zʹ-Ͽ]$/.test(n.value);
    let name;
    let lo;
    let hi;
    if (args.length === 4) [name, lo, hi] = [variableName(second), third, fourth];
    else if (args.length === 3 && !isVar(second)) [name, lo, hi] = [firstVariable(f) || 'x', second, third];
    else throw new UnknownError('an integral needs limits to be calculated');
    let a = num(calc(lo, env));
    let b = num(calc(hi, env));
    if (a === b) return rat(0);
    let sign = 1;
    if (a > b) { [a, b] = [b, a]; sign = -1; }
    const g = asFunction(f, name, env);
    const { value, error } = integrate(g, a, b);
    return recognize(sign * value, error);
}

function integrate(f, a, b) {
    if (a === -Infinity && b === Infinity) {
        const left = integrate(f, -Infinity, 0);
        const right = integrate(f, 0, Infinity);
        return { value: left.value + right.value, error: left.error + right.error };
    }
    if (b === Infinity) return pieces((u) => f(a + u / (1 - u)) / ((1 - u) * (1 - u)), 0, 1);
    if (a === -Infinity) return pieces((u) => f(b - u / (1 - u)) / ((1 - u) * (1 - u)), 0, 1);
    return pieces(f, a, b);
}

/**
 * Tanh-sinh over [a, b], halving the interval where it doesn't settle: a kink inside (|x| at 0) or many
 * oscillations (cos x over [0, 1000]) are smooth enough piece by piece. At most 2¹⁰ pieces; the step budget
 * still bounds the work.
 */
function pieces(f, a, b, depth = 0) {
    try {
        return tanhSinh(f, a, b);
    } catch (e) {
        if (!(e instanceof MathError) || e.message !== 'the integral does not converge' || depth >= 10) throw e;
    }
    const m = (a + b) / 2;
    const left = pieces(f, a, m, depth + 1);
    const right = pieces(f, m, b, depth + 1);
    return { value: left.value + right.value, error: left.error + right.error };
}

/**
 * Tanh-sinh (double exponential) quadrature: handles endpoint singularities
 * like 1/√x, and notices integrals that blow up at an end (1/x on [0, 1]).
 */
function tanhSinh(f, a, b) {
    const halfWidth = (b - a) / 2;
    const T = 4;
    let h = 1;
    let sum = 0;
    let estimate = NaN;
    let previous = NaN;
    let tail = 0;
    const point = (t) => {
        const s = (Math.PI / 2) * Math.sinh(Math.abs(t));
        const q = Math.exp(-2 * s);
        const dist = (halfWidth * 2 * q) / (1 + q);                 // distance from the nearer end
        const w = halfWidth * (Math.PI / 2) * Math.cosh(t) * (4 * q) / ((1 + q) * (1 + q));
        if (dist === 0 || w === 0) return 0;
        const x = t > 0 ? b - dist : a + dist;
        if (t !== 0 && (x <= a || x >= b)) return 0;
        const y = f(t === 0 ? (a + b) / 2 : x);
        if (!Number.isFinite(y)) {
            if (dist < 1e-6 * halfWidth) return 0;
            throw new MathError('the integral diverges');
        }
        if (Math.abs(t) > T - 0.5) tail = Math.max(tail, Math.abs(w * y));
        return w * y;
    };
    sum = point(0);
    for (let t = h; t <= T; t += h) sum += point(t) + point(-t);
    estimate = h * sum;
    for (let level = 1; level <= 8; level++) {
        h /= 2;
        for (let t = h; t <= T; t += 2 * h) sum += point(t) + point(-t);
        previous = estimate;
        estimate = h * sum;
        const scale = Math.max(1, Math.abs(estimate));
        if (tail > 1e-8 * scale) throw new MathError('the integral diverges');
        if (level >= 3 && Math.abs(estimate - previous) <= 1e-13 * scale) break;
    }
    const error = Math.abs(estimate - previous);
    if (!Number.isFinite(estimate) || error > 1e-6 * Math.max(1, Math.abs(estimate))) throw new MathError('the integral does not converge');
    return { value: estimate, error };
}

/** lim(f, a), lim(f, x→a), lim(f, x, a), lim(f, x, a, side). */
function limit(args, env) {
    const [f, second, third, fourth] = args;
    let name;
    let at;
    let side = 0;
    if (args.length === 2 && second.type === 'op' && second.op === '→') [name, at] = [variableName(second.args[0]), second.args[1]];
    else if (args.length === 2) [name, at] = [firstVariable(f), second];
    else if (args.length >= 3) [name, at] = [variableName(second), third];
    else throw new UnknownError('a limit needs a point');
    if (args.length === 4) {
        const leaf = fourth.type === 'op' ? '' : String(fourth.value).toLowerCase();
        side = leaf.startsWith('r') || leaf === '+' ? 1 : -1;
    }
    if (!name) throw new UnknownError('a limit needs a variable');
    const atValue = calc(at, env);
    const a = num(atValue);
    const g = asFunction(f, name, env);

    let value;
    let error;
    if (!Number.isFinite(a)) {
        ({ value, error } = approach((h) => g(Math.sign(a) / h)));
    } else if (side) {
        ({ value, error } = approach((h) => g(a + side * h * Math.max(1, Math.abs(a)))));
        // continuous from that side? Then the exact value at the point is the answer: √x at 0⁺ is 0, not 0.0000087
        try {
            const direct = calc(f, bind(env, name, atValue));
            if (Math.abs(num(direct) - value) <= Math.max(error, 1e-6 * Math.max(1, Math.abs(value)))) return direct;
        } catch (e) {
            if (!(e instanceof MathError)) throw e;
        }
    } else {
        const r = approach((h) => g(a + h * Math.max(1, Math.abs(a))));
        const l = approach((h) => g(a - h * Math.max(1, Math.abs(a))));
        if (r.value === l.value) ({ value, error } = r);
        else if (Number.isFinite(r.value) && Number.isFinite(l.value)
            && Math.abs(r.value - l.value) <= 1e-6 * Math.max(1, Math.abs(r.value))) {
            value = (r.value + l.value) / 2;
            error = Math.max(r.error, l.error, Math.abs(r.value - l.value));
        } else throw new MathError('the limit does not exist');
        // Continuous here? Then the exact value at the point is the answer.
        try {
            const direct = calc(f, bind(env, name, atValue));
            if (Math.abs(num(direct) - value) <= 1e-6 * Math.max(1, Math.abs(value))) return direct;
        } catch (e) {
            if (!(e instanceof MathError)) throw e;
        }
    }
    return Number.isFinite(value) ? recognize(value, error) : value;
}

/**
 * The value F(h) tends to as h → 0⁺, checked along two sequences of h: one alone, h = 0.1/2ⁱ, can line up
 * with an oscillation (sin x at x = 10·2ⁱ, (-1)^⌊x⌋ there is always 1) and settle on a value that isn't a limit.
 */
function approach(F) {
    const first = approachAlong(F);
    const second = approachAlong((h) => F(h * 0.7548776662466927));   // an irrational step: no common period with the first
    if (first.value === second.value) return first;
    if (!Number.isFinite(first.value) || !Number.isFinite(second.value)) throw new MathError('the limit does not exist');
    const size = Math.max(1, Math.abs(first.value));
    const tolerance = Math.max(first.error, second.error, 1e-6 * size);
    if (tolerance > 1e-3 * size) throw new MathError('the limit could not be found');   // extrapolated from values that never settled
    if (Math.abs(first.value - second.value) <= tolerance) return first;
    throw new MathError('the limit does not exist');
}

/**
 * The value F(h) tends to as h → 0⁺, from h = 0.1/2ⁱ: Neville extrapolation
 * when F is smooth in h, ±∞ when it keeps growing.
 */
function approachAlong(F) {
    const hs = [];
    const ys = [];
    for (let i = 0; i < 30; i++) {
        const h = 0.1 / 2 ** i;
        const y = F(h);
        if (Number.isFinite(y)) { hs.push(h); ys.push(y); }
    }
    if (ys.length < 6) throw new MathError('undefined');
    // Growing without bound: the steps stay as big as before, or grow.
    const steps = ys.slice(1).map((y, i) => y - ys[i]).slice(-6);
    const same = steps.every((d) => Math.sign(d) === Math.sign(steps[0]) && d !== 0);
    if (same && Math.abs(steps[5]) >= 0.95 * Math.abs(steps[0]) && Math.abs(ys[ys.length - 1]) > 10) {
        return { value: Math.sign(steps[0]) * Infinity, error: 0 };
    }
    const extrapolate = (from) => {
        const H = hs.slice(from, from + 8);
        const P = ys.slice(from, from + 8);
        for (let m = 1; m < H.length; m++) {
            for (let i = 0; i < H.length - m; i++) {
                P[i] = (H[i + m] * P[i] - H[i] * P[i + 1]) / (H[i + m] - H[i]);
            }
        }
        return P[0];
    };
    // Rounding noise grows as h shrinks; use the stretch where extrapolations agree best.
    let best = null;
    for (let from = 0; from + 9 <= ys.length; from++) {
        const x = extrapolate(from);
        const y = extrapolate(from + 1);
        const e = Math.abs(x - y);
        if (Number.isFinite(x) && (!best || e < best.error)) best = { value: x, error: e };
    }
    // F(h) ≈ L + c·hᵖ with p not a whole number (√h, ∛h) defeats the extrapolation above; Aitken's Δ² is exact for it
    const aitken = (i) => {
        const d1 = ys[i + 1] - ys[i];
        const d2 = ys[i + 2] - ys[i + 1];
        return d2 === d1 ? ys[i + 2] : ys[i + 2] - (d2 * d2) / (d2 - d1);
    };
    // only where it holds: steps of one sign shrinking by a steady ratio (not ±1, ±1 … from an oscillation)
    const ratio = (i) => (ys[i + 2] - ys[i + 1]) / (ys[i + 1] - ys[i]);
    const geometric = (i) => [i, i + 1].every((k) => ratio(k) > 0 && ratio(k) < 0.95) && Math.abs(ratio(i) - ratio(i + 1)) < 0.05;
    for (let i = 0; i + 3 < ys.length; i++) {
        if (!geometric(i)) continue;
        const x = aitken(i);
        const e = Math.abs(x - aitken(i + 1));
        if (Number.isFinite(x) && (!best || e < best.error)) best = { value: x, error: e };
    }
    const last = ys[ys.length - 1];
    const lastStep = Math.abs(last - ys[ys.length - 2]);
    if (!best || best.error > Math.max(lastStep, 1e-6 * Math.max(1, Math.abs(last)))) {
        // Not smooth in h (√h, h·ln h): trust the plain values if they have settled.
        if (lastStep <= 1e-6 * Math.max(1, Math.abs(last))) return { value: last, error: lastStep * 10 };
        throw new MathError('the limit could not be found');
    }
    return best;
}

/** ∑ and ∏ with an index: exact term by term, or numerically for ∑ to ∞. */
function series(isSum, args, env) {
    const [body, from, to] = args;
    if (args.length < 3) throw new UnknownError('a sum needs its limits');
    let name;
    let startNode = from;
    if (from.type === 'op' && from.op === '=' && from.args[0].type === 'symbol') [name, startNode] = [from.args[0].value, from.args[1]];
    else name = firstVariable(body) || 'n';
    const start = whole(calc(startNode, env), 'a sum');
    const endValue = calc(to, env);
    const step = isSum ? add : mul;
    if (endValue === Infinity) {
        if (!isSum) throw new UnknownError('an infinite product');
        const term = asFunction(body, name, env);
        return infiniteSum(term, Number(start));
    }
    const end = whole(endValue, 'a sum');
    if (end - start + 1n > BigInt(LIMITS.terms)) throw new UnknownError('too many terms to add one by one');
    let total = rat(isSum ? 0 : 1);
    for (let i = start; i <= end; i++) total = step(total, calc(body, bind(env, name, X(Q(i)))));
    return total;
}

/** Terms that don't shrink to 0 (∑ (-1)ⁿ, ∑ sin n): the biggest near n is as big as those near n₀ + n/16. */
function termsStay(term, n0, n) {
    const biggest = (m) => Math.max(...Array.from({ length: 8 }, (_, j) => Math.abs(term(m + j))));
    const late = biggest(n);
    return late > 1e-12 && late >= 0.5 * biggest(n0 + Math.floor((n - n0) / 16));
}

/** ∑ from n₀ to ∞: partial sums S(N) at N = 2ᵏ, extrapolated in 1/N. */
function infiniteSum(term, n0) {
    const Ns = [];
    const Ss = [];
    let s = 0;
    let n = n0;
    for (let k = 4; k <= 17; k++) {
        const N = 2 ** k;
        for (; n < n0 + N; n++) {
            const t = term(n);
            if (!Number.isFinite(t)) throw new MathError('undefined');
            s += t;
        }
        Ns.push(N);
        Ss.push(s);
        // already exact in doubles — once the terms are known to shrink: ∑ (-1)ⁿ repeats 0 at every even count
        if (k >= 6 && Ss[Ss.length - 1] === Ss[Ss.length - 2] && !termsStay(term, n0, n)) return recognize(s, 0);
    }
    if (termsStay(term, n0, n)) throw new MathError('the series diverges');
    // Diverging like the harmonic series: S(2N) − S(N) doesn't shrink. Shrinking only a little (∑ 1/n^1.01,
    // ∑ 1/(n ln n)) can't be told apart from that by adding terms: no verdict either way.
    const d1 = Ss[Ss.length - 1] - Ss[Ss.length - 2];
    const d2 = Ss[Ss.length - 2] - Ss[Ss.length - 3];
    const d3 = Ss[Ss.length - 3] - Ss[Ss.length - 4];
    const ratio = d1 / d2;
    if (Math.abs(d1) > 1e-12 && ratio >= 0.999 && d2 / d3 >= 0.999) throw new MathError('the series diverges');
    if (Math.abs(d1) > 1e-6 * Math.max(1, Math.abs(s)) && ratio >= 0.9) throw new UnknownError('the series grows too slowly to tell whether it has a sum');
    const H = Ns.slice(-7).map((N) => 1 / N);
    const P = Ss.slice(-7);
    const Q2 = Ss.slice(-8, -1);
    const neville = (H2, P2) => {
        const p = P2.slice();
        for (let m = 1; m < H2.length; m++) {
            for (let i = 0; i < H2.length - m; i++) p[i] = (H2[i + m] * p[i] - H2[i] * p[i + 1]) / (H2[i + m] - H2[i]);
        }
        return p[0];
    };
    const a = neville(H, P);
    const b = neville(Ns.slice(-8, -1).map((N) => 1 / N), Q2);
    return recognize(a, Math.abs(a - b));
}

/**
 * A numeric answer → exact when it is (within its error) a simple fraction,
 * or one times π, π², e or √2, √3, √5, √6, √7. Otherwise the double.
 */
function recognize(y, error = 0) {
    if (!Number.isFinite(y)) return y;
    const tol = Math.max(1e-10, 4 * error) * Math.max(1, Math.abs(y));
    if (tol > 1e-6 * Math.max(1, Math.abs(y))) return knownDigits(y, error);
    // 0 only within the answer's own error: ∫₀^0.00001 x dx is 5·10⁻¹¹, not 0
    if (Math.abs(y) <= Math.max(4 * error, 1e-15)) return rat(0);
    if (Math.abs(y) < 1e-10) return y;
    const bases = [
        [rat(1), 1000], [PI, 100], [X(Q1, 2), 100], [E, 100],
        ...[2n, 3n, 5n, 6n, 7n].map((r) => [X(Q1, 0, 0, { n: 2, r }), 100]),
    ];
    for (const [base, maxDen] of bases) {
        const ratio = y / num(base);
        const f = bestFraction(ratio, maxDen);
        if (f && Math.abs(Number(f.n) / Number(f.d) - ratio) * num(base) <= tol) return mulX(X(f), base);
    }
    return y;
}

/**
 * A numeric answer to the digits its error leaves: ∫|x| over [-1, 2] by quadrature is 2.49999985 ± 9·10⁻⁷, which is
 * 2.5 to the six digits that are known, not 2.49999985339 shown as if all were.
 */
function knownDigits(y, error) {
    if (!(error > 0) || y === 0) return y;
    const digits = Math.floor(-Math.log10(error / Math.abs(y)));
    return digits >= 15 ? y : Number(y.toPrecision(Math.max(1, digits)));
}

/** The closest fraction with denominator ≤ maxDen (continued fractions). */
function bestFraction(x, maxDen) {
    if (!Number.isFinite(x) || Math.abs(x) > 1e12) return null;
    let [h0, h1, k0, k1] = [0, 1, 1, 0];
    let r = x;
    for (let i = 0; i < 40; i++) {
        const a = Math.floor(r);
        const h2 = a * h1 + h0;
        const k2 = a * k1 + k0;
        if (k2 > maxDen) break;
        [h0, h1, k0, k1] = [h1, h2, k1, k2];
        if (Math.abs(r - a) < 1e-15) break;
        r = 1 / (r - a);
    }
    return k1 ? Q(BigInt(h1), BigInt(k1)) : null;
}

// ---- writing values back as text that MathZetta reads ------------------------------------------

/**
 * @param {*} v a value
 * @param {object} [o] { decimal: boolean, places: number|null, digits: 12, maxDigits: 30 }
 */
function format(v, o) {
    if (typeof v === 'boolean') return String(v);
    if (v && v.kind === 's') return JSON.stringify(v.text);
    if (Array.isArray(v)) {
        if (v.group === 'pm' && v.length === 2 && equal(v[1], neg(v[0]))) return `±${wrapped(v[0], o)}`;
        if (MATRIX_KINDS.has(v.group) && isMatrixValue(v)) return `${v.group}(${v.map((r) => `[${r.map((x) => format(x, o)).join(', ')}]`).join(', ')})`;
        const [open, close] = { '()': '()', '[]': '[]', '{}': '{}' }[v.group] || '{}';
        return open + v.map((x) => format(x, o)).join(', ') + close;
    }
    if (typeof v === 'number') return formatDouble(v, o);
    if (o.decimal || o.places !== null) return formatDecimal(v, o);
    return formatExact(v, o);
}

const wrapped = (v, o) => { const t = format(v, o); return /^[\d.]+$|^[a-zπ]+$/i.test(t) ? t : `(${t})`; };

function formatDouble(x, o) {
    if (x === Infinity) return '∞';
    if (x === -Infinity) return '-∞';
    if (Object.is(x, -0) || x === 0) return '0';
    if (o.places !== null && Math.abs(x) < 1e21) return fixedDouble(x, o.places);
    const ax = Math.abs(x);
    if (ax >= 1e15 || ax < 1e-6) {
        const [m, e] = x.toExponential(o.digits - 1).split('e');
        return `${trimZeros(m)}*10^(${Number(e)})`;
    }
    return String(Number(x.toPrecision(o.digits)));
}

const trimZeros = (m) => (m.includes('.') ? m.replace(/\.?0+$/, '') : m);

/** A fraction as a decimal: exact when it terminates within `digits`, rounded otherwise. */
function formatDecimal(v, o) {
    if (isRat(v) && o.places === null) {
        let d = v.c.d;
        let twos = 0;
        let fives = 0;
        while (d % 2n === 0n) { d /= 2n; twos++; }
        while (d % 5n === 0n) { d /= 5n; fives++; }
        const places = Math.max(twos, fives);
        if (d === 1n && places <= o.digits) {
            const scaled = (v.c.n * 10n ** BigInt(places)) / v.c.d;
            const neg = scaled < 0n;
            const digits = babs(scaled).toString().padStart(places + 1, '0');
            const text = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
            if (digits.length <= o.maxDigits) return (neg ? '-' : '') + trimZeros(text);
        }
    }
    if (isRat(v) && o.places !== null) return format(roundV(v, rat(o.places)), { ...o, places: null, decimal: true });
    return formatDouble(num(v), o);
}

function formatExact(v, o) {
    const { c } = v;
    const n = babs(c.n);
    if (n.toString().length > o.maxDigits || c.d.toString().length > o.maxDigits) {
        return formatBig(v, o);
    }
    const power = (name, k) => (k === 1 ? name : `${name}^${k}`);
    const top = [];
    const bottom = [];
    if (v.pi > 0) top.push(power('pi', v.pi));
    if (v.pi < 0) bottom.push(power('pi', -v.pi));
    if (v.e > 0) top.push(power('e', v.e));
    if (v.e < 0) bottom.push(power('e', -v.e));
    if (v.root) top.push(v.root.n === 2 ? `sqrt(${v.root.r})` : `root(${v.root.n}, ${v.root.r})`);
    if (n !== 1n || !top.length) top.unshift(n.toString());
    if (c.d !== 1n) bottom.unshift(c.d.toString());
    const join = (parts) => (parts.length > 1 ? `(${parts.join('*')})` : parts[0]);
    const text = bottom.length ? `${join(top)}/${join(bottom)}` : top.join('*');
    return (c.n < 0n ? '-' : '') + text;
}

/** A number too long to write out: d.ddd…×10^k from its exact digits (a fraction too: 1/10^400 is 1*10^(-400), not 0). */
function formatBig(v, o) {
    if (!isRat(v)) return formatDouble(num(v), o);
    if (v.c.d !== 1n) {
        const x = num(v);
        if (x !== 0 && Number.isFinite(x)) return formatDouble(x, o);   // a double holds it: written as one
        const n = babs(v.c.n);
        const d = v.c.d;
        const k = o.digits + 1 - (n.toString().length - d.toString().length);   // shift so n/d has digits + 1 or + 2 digits
        const q = k >= 0 ? (n * 10n ** BigInt(k)) / d : n / (d * 10n ** BigInt(-k));
        const s = q.toString();
        const rounded = ((BigInt(s.slice(0, o.digits + 1)) + 5n) / 10n).toString();
        const exponent = s.length - 1 - k + (rounded.length > o.digits ? 1 : 0);
        const m = trimZeros(`${rounded[0]}.${rounded.slice(1, o.digits)}`);
        return `${v.c.n < 0n ? '-' : ''}${m}*10^(${exponent})`;
    }
    const s = babs(v.c.n).toString();
    const kept = BigInt(s.slice(0, o.digits + 1));
    const rounded = ((kept + 5n) / 10n).toString();   // o.digits significant digits
    const exponent = s.length - 1 + (rounded.length > o.digits ? 1 : 0);
    const m = trimZeros(`${rounded[0]}.${rounded.slice(1, o.digits)}`);
    return `${v.c.n < 0n ? '-' : ''}${m}*10^(${exponent})`;
}

// ---- public -----------------------------------------------------------------------------------

/**
 * Calculate an expression, exactly where possible.
 *
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {object} [scope] variable values: numbers, BigInts, decimal or expression
 *   strings ('1/3'), arrays, and functions for f(x) calls: { x: 2, f: (t) => t * t }
 * @param {object} [options]
 * @param {boolean} [options.decimal] write the answer as a decimal (exact answers are still exact inside)
 * @param {number} [options.places] round the written answer to this many decimal places
 * @param {number} [options.digits] significant digits for answers that aren't exact (12)
 * @param {number} [options.maxDigits] longest whole number written out in full (50)
 * @returns {{ value: *, text: string, exact: boolean }} the answer as plain JS (numbers,
 *   booleans, strings, arrays), as MathZetta-readable text, and whether it is exact
 * @throws {MathError} when there is no answer (1/0, √−1, a divergent integral)
 * @throws {UnknownError} when it can't be worked out (an unset variable, ∫ without limits)
 */
export function calculate(input, scope = {}, options = {}) {
    if (depth === 0) steps = 0;   // before the scope is read: reading big numbers is charged too
    const tree = typeof input === 'string' ? parseTree(input) : asTree(input);
    const env = {};
    for (const [k, val] of Object.entries(scope)) env[k] = fromJS(val);
    depth++;
    let v;
    try { v = calc(tree, env); } finally { depth--; }
    const o = { decimal: false, places: null, digits: 12, maxDigits: 50, ...options };
    if (o.places === undefined) o.places = null;
    if (o.places !== null && !(Number.isInteger(o.places) && o.places >= 0 && o.places <= LIMITS.places)) {
        throw new UnknownError(`places is a whole number from 0 to ${LIMITS.places}`);   // {{~999999999 1/3}}
    }
    const exact = (x) => (Array.isArray(x) ? x.every(exact) : typeof x !== 'number');
    return { value: toJS(v), text: format(v, o), exact: exact(v) };
}

/**
 * The text of a `{{...}}` block → what replaces it. A leading `~` asks for a
 * decimal, `~3` for three decimal places: {{~ pi}} → 3.14159265359, {{~2 1/3}} → 0.33.
 * Answers with a decimal point in the question come back as decimals too.
 * When there is no answer the block becomes the string "undefined"; when it
 * can't be worked out, the expression is left as written.
 *
 * @returns {string} MathZetta-readable text; anything but a plain number is
 *   bracketed so it can stand anywhere (x^{{1/2}}, 2{{-1}})
 */
export function calculateBlock(text, scope = {}) {
    let expression = text.trim();
    const options = {};
    const approx = /^(~|≈)\s*(\d+)?/.exec(expression);
    if (approx) {
        options.decimal = true;
        if (approx[2] !== undefined) options.places = Number(approx[2]);
        expression = expression.slice(approx[0].length);
    }
    if (/\d\.\d|\.\d/.test(expression)) options.decimal = true;
    try {
        const { text: out } = calculate(expression, scope, options);
        return out.startsWith('"') || /^\d+(\.\d+)?$/.test(out) ? out : `(${out})`;
    } catch (e) {
        if (e instanceof MathError) return '"undefined"';
        if (e instanceof UnknownError) return `(${expression})`;
        throw e;
    }
}

setBlockHandler(calculateBlock);

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [LIMITS, SIN_TABLE, CONSTANTS, ONE, TWO, MANY]) Object.setPrototypeOf(table, null);

Object.setPrototypeOf(MATRIX_FUNCTIONS, null);
