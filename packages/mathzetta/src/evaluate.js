/**
 * 'mathzetta/evaluate' — numeric evaluation in double precision, without
 * generating or running any code. For exact answers (fractions, surds,
 * 2^100) see 'mathzetta/calculate'.
 *
 * Variables come from `scope`; pi, e, tau, ∞, true and false are built in.
 * Symbolic operators (der, int, lim, ...) can't be evaluated and throw.
 */

import { treeOf } from './input.js';
import { expandChain } from './common.js';
import { matrixArithmetic, isMatrixValue, isVectorValue } from './matrix.js';

// ---- matrices (lists of equally long lists): the matrix product, powers, determinants -----------

const M = matrixArithmetic({
    add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b,
    isZero: (x) => Math.abs(x) < 1e-12, zero: () => 0, one: () => 1, size: Math.abs,
    fail: (message) => { throw new Error(message); },
});
const isMatrix = (v) => isMatrixValue(v) && (v.length > 1 || v[0].length > 1);
const isVector = (v) => isVectorValue(v) && !isMatrix(v);
/** Entry by entry, for lists and a number with a list. */
const each = (f) => {
    const g = (a, b) => {
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) throw new Error('Lists of different lengths');
            return a.map((x, i) => g(x, b[i]));
        }
        if (Array.isArray(a)) return a.map((x) => g(x, b));
        if (Array.isArray(b)) return b.map((y) => g(a, y));
        return f(a, b);
    };
    return g;
};
const times = (a, b) => {
    if (isMatrix(a) && isMatrix(b)) return M.times(a, b);
    if (isMatrix(a) && isVector(b)) return M.timesVector(a, b);
    if (isVector(a) && isMatrix(b)) return M.vectorTimes(a, b);
    return each((x, y) => x * y)(a, b);
};
const power = (a, b) => {
    if (!isMatrix(a)) return Array.isArray(a) ? each((x, y) => x ** y)(a, b) : a ** b;
    if (!Number.isInteger(b)) throw new Error('A matrix to a power that is not a whole number');
    return M.power(a, BigInt(b));
};
/** det(A); det([[1, 2], [3, 4]]) arrives as one argument per row. */
const matrixArg = (f) => (xs) => f(xs.length > 1 && xs.every(isVector) ? xs : xs[0]);
const MATRIX_FUNCTIONS = {
    det: matrixArg(M.det), inv: matrixArg(M.inverse), inverse: matrixArg(M.inverse), transpose: matrixArg(M.transpose),
    trace: matrixArg(M.trace), tr: matrixArg(M.trace), rank: matrixArg(M.rank), rref: matrixArg(M.rref),
    identity: ([n]) => M.identity(n), dot: ([u, v]) => M.dot(u, v), cross: ([u, v]) => M.cross(u, v),
    linsolve: ([A, b]) => M.solve(A, b),
};
const rowsOf = (node, scope) => node.args.map((r) => (r.type === 'op' && r.op === '[]' ? r.args.map((c) => value(c, scope)) : [value(r, scope)]));

const CONSTANTS = {
    pi: Math.PI, 'π': Math.PI, e: Math.E, tau: 2 * Math.PI, 'τ': 2 * Math.PI,
    '∞': Infinity, '-∞': -Infinity, true: true, false: false,
};

const factorial = (n) => {
    if (!Number.isInteger(n) || n < 0) return NaN;
    if (n > 170) return Infinity;   // 171! overflows a double; no point looping to it
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
};
/** n·(n−1)···(n−k+1), without the overflow of n!/(n−k)!. */
const perm = (n, k) => {
    if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return NaN;
    let r = 1;
    for (let i = n - k + 1; i <= n && r !== Infinity; i++) r *= i;   // past 170 factors it is ∞: stop counting
    return r;
};
/** n choose k, with k the smaller side: at most ~1,100 factors before a double overflows. */
const comb = (n, k) => {
    if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return NaN;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= k && r !== Infinity; i++) r = r * (n - k + i) / i;
    return Math.round(r);
};
const gcd2 = (a, b) => (b ? gcd2(b, a % b) : Math.abs(a));

const ONE = {
    neg: (a) => -a, pm: (a) => [a, -a], '!': factorial, '\\not': (a) => !a,
    sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, det: (A) => M.det(A),
    ln: Math.log, loglog: (a) => Math.log(Math.log(a)), logloglog: (a) => Math.log(Math.log(Math.log(a))),   // ln ln, as every renderer and calculate()
    expm1: Math.expm1,
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    csc: (a) => 1 / Math.sin(a), sec: (a) => 1 / Math.cos(a), cot: (a) => 1 / Math.tan(a),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
    arcsinh: Math.asinh, arccosh: Math.acosh, arctanh: Math.atanh,
};

const TWO = {
    '+': (a, b) => (Array.isArray(a) || Array.isArray(b) ? each((x, y) => x + y)(a, b) : a + b),
    '-': (a, b) => (Array.isArray(a) || Array.isArray(b) ? each((x, y) => x - y)(a, b) : a - b),
    '*': times,
    '/': (a, b) => (isMatrix(b) ? times(a, M.inverse(b)) : Array.isArray(a) || Array.isArray(b) ? each((x, y) => x / y)(a, b) : a / b),
    '^': power, mod: (a, b) => a % b,
    log: (base, x) => Math.log(x) / Math.log(base),
    root: (n, x) => x ** (1 / n),
    atan2: Math.atan2,
    round: (x, d) => Math.round(x * 10 ** d) / 10 ** d,
    '±': (a, b) => [a + b, a - b],
    fixed: (x, d) => Number(x).toFixed(d),   // text, with exactly d decimals
    perm, comb,
    '=': (a, b) => a == b, '===': (a, b) => a === b, '≠': (a, b) => a != b, '≠=': (a, b) => a !== b,
    '≈': (a, b) => Math.abs(a - b) < 1e-9,
    '≡': (a, b) => a === b,
    '∪': (a, b) => [...new Set([...[].concat(a), ...[].concat(b)])],
    '∩': (a, b) => [].concat(a).filter((x) => [].concat(b).includes(x)),
    '<': (a, b) => a < b, '>': (a, b) => a > b, '≤': (a, b) => a <= b, '≥': (a, b) => a >= b,
    '&': (a, b) => a && b, '|': (a, b) => a || b,
    '\\xor': (a, b) => Boolean(a) !== Boolean(b), '\\nor': (a, b) => !(a || b), '\\nand': (a, b) => !(a && b),
};

const MANY = {
    max: (xs) => Math.max(...xs), min: (xs) => Math.min(...xs),
    sum: (xs) => xs.reduce((a, b) => a + b, 0), prod: (xs) => xs.reduce((a, b) => a * b, 1),
    mean: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
    gcd: (xs) => xs.reduce(gcd2),
    '()': (xs) => xs, '[]': (xs) => xs, '{}': (xs) => xs,
};

/**
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {object} [scope] variable values, e.g. { x: 2 }
 * @returns {number|boolean|string|Array}
 */
export function evaluate(input, scope = {}) {
    if (depth === 0) steps = 0;
    depth++;
    try { return value(treeOf(input), scope); } finally { depth--; }
}

// the work of the evaluate() call in progress: a sum of sums can't run for ever
const STEPS = 5000000;
let steps = 0;
let depth = 0;

function value(node, scope) {
    if (++steps > STEPS) throw new Error('Too much to work out');
    switch (node.type) {
        case 'number':
            return Number(node.value);
        case 'string':
            return node.value.slice(1, -1);
        case 'symbol':
            if (Object.prototype.hasOwnProperty.call(scope, node.value)) return scope[node.value];
            if (Object.prototype.hasOwnProperty.call(CONSTANTS, node.value)) return CONSTANTS[node.value];
            throw new Error(`No value for '${node.value}'`);
    }

    const chained = expandChain(node);   // 3 < x < 7: both links
    if (chained) return value(chained, scope);
    const { op, args } = node;
    if (op === '?:') return value(args[0], scope) ? value(args[1], scope) : value(args[2], scope);
    if (op === '∈' || op === '∉') return membership(node, scope);
    if (op === 'random') return Math.random();
    if ((op === '\\sumidx' || op === '\\prodidx') && args.length === 3 && args[1].type === 'op' && args[1].op === '='
        && args[1].args[0].type === 'symbol') {
        // ∑ from i = a to b, a whole number of steps (at most a million)
        const [body, from, to] = [args[0], args[1].args[1], args[2]];
        const name = args[1].args[0].value;
        const lo = value(from, scope), hi = value(to, scope);
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo > 1e6) throw new Error(`Can't evaluate '${op}' over that range`);
        let acc = op === '\\sumidx' ? 0 : 1;
        for (let i = lo; i <= hi; i++) {
            const v = value(body, { ...scope, [name]: i });
            acc = op === '\\sumidx' ? acc + v : acc * v;
        }
        return acc;
    }
    if (op === 'pmod') {
        const [statement, modulus] = args;
        const n = value(modulus, scope);
        if (statement.type === 'op' && ['≡', '='].includes(statement.op)) {
            const [l, r] = statement.args.map((s) => value(s, scope));
            return (l - r) % n === 0;
        }
        return value(statement, scope) % n;
    }

    if (op === 'pmatrix' || op === 'bmatrix') return rowsOf(node, scope);
    if (op === 'vmatrix') return M.det(rowsOf(node, scope));
    if (op === '^' && args[1].type === 'symbol' && args[1].value === 'T' && !Object.prototype.hasOwnProperty.call(scope, 'T')) {
        const m = value(args[0], scope);
        if (isMatrix(m)) return M.transpose(m);
    }
    const vals = args.map((a) => value(a, scope));
    if (op.startsWith('\\:') && Object.prototype.hasOwnProperty.call(MATRIX_FUNCTIONS, op.slice(2))) return MATRIX_FUNCTIONS[op.slice(2)](vals);
    if (ONE[op] && vals.length === 1) return ONE[op](vals[0]);
    if (TWO[op] && vals.length === 2) return TWO[op](vals[0], vals[1]);
    if (MANY[op]) return MANY[op](vals);
    throw new Error(`Can't evaluate '${op}'`);
}

const NUMBER_SETS = {
    'ℝ': Number.isFinite,
    'ℤ': Number.isInteger,
    'ℕ': (v) => Number.isInteger(v) && v > 0,
    'ℚ': Number.isFinite,   // a double is always a fraction
    'ℂ': (v) => typeof v === 'number' && !Number.isNaN(v),
};

function membership(node, scope) {
    const [x, set] = node.args;
    const v = value(x, scope);
    let inside;
    if (set.type === 'symbol' && NUMBER_SETS[set.value]) {
        inside = NUMBER_SETS[set.value](v);
        return node.op === '∈' ? inside : !inside;
    }
    if (set.type === 'op' && ['()', '[]', '(]', '[)'].includes(set.op) && set.args.length === 2) {
        const [lo, hi] = set.args.map((a) => value(a, scope));
        const lower = set.op[0] === '[' ? v >= lo : v > lo;
        const upper = set.op[1] === ']' ? v <= hi : v < hi;
        inside = lower && upper;
    } else {
        const items = value(set, scope);
        inside = Array.isArray(items) && items.includes(v);
    }
    return node.op === '∈' ? inside : !inside;
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [CONSTANTS, ONE, TWO, MANY, NUMBER_SETS, MATRIX_FUNCTIONS]) Object.setPrototypeOf(table, null);
