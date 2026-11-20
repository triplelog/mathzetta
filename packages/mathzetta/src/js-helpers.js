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
    root: '((n, x) => (x < 0 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n)))',
};

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [JS_HELPERS]) Object.setPrototypeOf(table, null);
