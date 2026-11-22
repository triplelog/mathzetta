/**
 * The helpers JavaScript output calls inline where Math has no function:
 * `${JS_HELPERS.factorial}(x)`. Shared by the writer (render/code.js) and the
 * reader (parse/clean/code.js), so what mathzetta writes it can read back.
 */
export const JS_HELPERS = {
    // as evaluate(): NaN off the domain, and no loop past where a double reaches ∞ (171!, ~1,100 factors)
    factorial: '((n) => { if (!Number.isInteger(n) || n < 0) return NaN; if (n > 170) return Infinity; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; })',
    perm: '((n, k) => { if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return NaN; let r = 1; for (let i = n - k + 1; i <= n && r !== Infinity; i++) r *= i; return r; })',
    comb: '((n, k) => { if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return NaN; k = Math.min(k, n - k); let r = 1; for (let i = 1; i <= k && r !== Infinity; i++) r = r * (n - k + i) / i; return Math.round(r); })',
    gcd: '((args)=>{let gcd = function(a,b) { return (!b)?a:gcd(b,a%b); }; return Math.abs(args.reduce(gcd));})',
    // a determinant by elimination (rows swapped for the largest pivot), as evaluate() works it out
    det: '((m) => { const a = m.map((r) => r.slice()); const n = a.length; let d = 1; for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r; if (a[p][i] === 0) return 0; if (p !== i) { const t = a[p]; a[p] = a[i]; a[i] = t; d = -d; } d *= a[i][i]; for (let r = i + 1; r < n; r++) { const f = a[r][i] / a[i][i]; for (let c = i; c < n; c++) a[r][c] -= f * a[i][c]; } } return d; })',
    // sets as lists, a number being a list of one, as evaluate() takes them
    union: '((a, b) => [...new Set([].concat(a, b))])',
    intersection: '((a, b) => [].concat(a).filter((x) => [].concat(b).includes(x)))',
    // round, mod and odd roots of an expression: written inline for a name or a number (x < 0 ? … x … : … x …), but an
    // expression goes through one of these so it is written (and worked out) once — inline, nesting would double it each level
    round: '((x, d) => { const p = Math.pow(10, d); return (x < 0 ? -Math.round(-x * p) : Math.round(x * p)) / p; })',
    mod: '((a, n) => ((a % n) + n) % n)',
    // real for an odd index, as evaluate() takes it (root(3, -8) is -2): also when the index is only known as it runs
    root: '((n, x) => (x < 0 && Math.abs(n % 2) === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n)))',
    // text search: is t somewhere in s / at its start, whatever the case of the letters A to Z (those only, as
    // SQLite's LOWER folds); a missing value is empty text, a number its digits
    contains: '((s, t) => { const f = (x) => (x == null ? String() : String(x)).replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)); return f(s).includes(f(t)); })',
    startswith: '((s, t) => { const f = (x) => (x == null ? String() : String(x)).replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)); return f(s).startsWith(f(t)); })',
};

/**
 * Python's inline helpers, the twins of JS_HELPERS.contains / .startswith: written by render/code.js,
 * matched as exact text by checkGeneratedPython (python-function.js) and read back by parse/clean/code.js.
 * The text is folded as JavaScript and SQLite fold it: the letters A to Z only (str.lower folds every
 * letter); a missing value (None, or NaN, what pandas and numpy hold for one) is empty text; a whole float
 * is read by its digits (62.0 is "62", as JavaScript writes it).
 */
// No string literals (str() is the empty one; 65 to 90 are A to Z): the reader matches this text after the
// strings of what it reads have become placeholders.
const PY_TEXT = 'lambda x: str().join(chr(ord(c) + 32) if 65 <= ord(c) <= 90 else c for c in (str() if x is None or x != x else str(int(x)) if isinstance(x, float) and x.is_integer() else str(x)))';
const PY_CONTAINS = `lambda s, t, f=${PY_TEXT}: f(t) in f(s)`;
const PY_STARTSWITH = `lambda s, t, f=${PY_TEXT}: f(s).startswith(f(t))`;
export const PY_HELPERS = {
    contains: `(${PY_CONTAINS})`,
    startswith: `(${PY_STARTSWITH})`,
};
/** The same over numpy arrays, element by element (np.vectorize: a scalar works too). */
export const NP_HELPERS = {
    contains: `np.vectorize(${PY_CONTAINS}, otypes=[bool])`,
    startswith: `np.vectorize(${PY_STARTSWITH}, otypes=[bool])`,
};

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [JS_HELPERS, PY_HELPERS, NP_HELPERS]) Object.setPrototypeOf(table, null);
