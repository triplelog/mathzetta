// MathZetta reads what it writes: every input in test/cases, written as LaTeX,
// text, JavaScript, Python, numpy, SymPy, SQL (both dialects) and GLSL, then parsed
// back, has the same value as the input (evaluated with the same variables).
// The few that don't are listed below with the reason; the run fails if a
// new one appears, and if a listed one starts working (then remove it).
import { readFileSync, readdirSync } from 'node:fs';
import { suite, test, eq } from '../harness.js';
import { parse, parseTree, evaluate, walk, toLaTeX, toText, toJavaScript, toPython, toSQL, toGLSL, toExcel } from '../../src/all.js';

const FORMATS = {
    latex: toLaTeX,
    text: toText,
    javascript: toJavaScript,
    python: (t) => toPython(t),
    numpy: (t) => toPython(t, { numpy: true }),
    sympy: (t) => toPython(t, { sympy: true }),
    sql: (t) => toSQL(t),
    sqlite: (t) => toSQL(t, { dialect: 'sqlite' }),
    glsl: toGLSL,
    excel: (t) => toExcel(t),
};

const EVERY = Object.keys(FORMATS);
const BUT = (...not) => EVERY.filter((f) => !not.includes(f));
/** [inputs, formats, why]: what doesn't come back the same, and why that is all right. */
const KNOWN = [
    [['"1"===1', '0===false', '1===true', '""===0'], BUT('javascript', 'text'),
        "JavaScript's strict equality; every other language writes plain ="],
    [['1.333..'], BUT('latex', 'text'), 'a repeating decimal, written out as 1.333'],
    [['Math.round(x/7,2)+math.round(x/7)+round(13.244,i)'], ['glsl'],
        'a digit count that is a variable: GLSL has no way to round to i places, so it rounds to whole numbers'],
    [['random()', '=RAND()'], EVERY, 'a random number: no one value to compare'],
    [['A ∩ B', 'a ± b', '[1, 2]'], ['sql'], 'PostgreSQL arrays and set operations (ARRAY[…], INTERSECTION) are written but not read back'],
    [['fixed(2.5, 3)', 'fixed(3.14159, 2)', 'fixed(1/3, 4)', 'fixed(-2.5, 0)', 'fixed(2.5)', 'fixed(x, y)', 'fixed(x, 2)', '=FIXED(x, 1)'], ['python', 'numpy', 'sympy', 'sqlite'],
        "fixed's digit count sits inside a string ('.2f', '%.2f') the reader doesn't open; JavaScript, SQL, Excel and GLSL read back"],
    [['fixed(x, y)'], ['sql', 'glsl'],
        'read back as round(x, y): with a digit count that is not a whole number, fixed takes its whole part and round does not; GLSL (no text) has to ignore a non-literal count'],
    [['sum(i^2-17,i=0,infinity)!=product(i^2-17,i\\in T)'], ['latex', 'text'], 'an infinite sum and a product over an unknown set T: no value to compare'],
    [['\\sin\\theta', 'r\\cos\\theta', '1 + \\tan^2\\theta = \\sec^2\\theta', '\\theta = \\tan^{-1}\\left(\\frac{y}{x}\\right)',
        '\\theta = \\arctan(y/x)', '\\alpha', 'ε^21', '\\Pi*\\gamma', '\\Delta x', '\\frac{\\Delta y}{\\Delta x}'], ['glsl'],
        'GLSL names have no Greek letters: θ is written theta, Δx delta_x — another variable when read back'],
    [['\\sqrt{2} \\notin \\mathbb{Q}', 'x in sympy.Rationals', 'x in sympy.Complexes'], ['javascript', 'sql', 'sqlite', 'glsl'],
        'ℚ has no test in code (a double is always a fraction): it is written as a set known by name'],
    [['∞', 'Infinity + NaN', '(-\\infty, 0) \\cup (0,\\infty)'], ['sql'], "PostgreSQL's ∞ is the string 'Infinity'"],
    [['[[1,2],[3,4]]*[[5,6],[7,8]]=[[17,23],[39,53]]'], ['sql'], 'PostgreSQL has no matrix product'],
    [['\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}', 'bmatrix([1, 2], [3, 4]) * bmatrix(x, y)'], ['sql', 'glsl'],
        'a matrix as a PostgreSQL array or a GLSL mat2 is written but not read back'],
    [['[[1, 2], [3, 4]]'], ['sql'], 'a PostgreSQL array of arrays is written but not read back'],
    [['\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', '\\begin{vmatrix} 1 & 2 \\\\ 3 & 4 \\end{vmatrix}'], ['excel'],
        "a spreadsheet's array constant {1,2;3,4} (and MDETERM) is written but not read back"],
    [['bmatrix([1, 2], [3, 4]) * bmatrix(x, y)'], ['javascript', 'python', 'numpy', 'sympy'],
        'a column of one-entry rows, [[x], [y]], reads back as the list [x, y]: the product is the same numbers, one level of brackets less'],
];

const known = new Map();
for (const [inputs, formats] of KNOWN) for (const input of inputs) for (const f of formats) known.set(`${f}\t${input}`, true);

const DIR = new URL('../cases/', import.meta.url);
const inputs = new Set();
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.tsv'))) {
    for (const line of readFileSync(new URL(file, DIR), 'utf8').split('\n').slice(1)) {
        const input = line.split('\t')[0]?.trim();
        if (input) inputs.add(input);
    }
}

const VALUES = [0.7, 1.3, 2.1, 0.4, 1.9, 3.2, 0.6, 2.5];
const CONSTANTS = new Set(['pi', 'e', 'tau', 'true', 'false', 'null', 'undefined']);
const same = (a, b) => {
    if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) === Number(b);
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
    return (Number.isNaN(a) && Number.isNaN(b)) || a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
};

// a second pass with negative and whole values: mod, round, trunc and roots differ between languages there
const SIGNED = [-2, 3, -1.5, 4, -0.5, 2, -3, 1];

suite('round trip: mathzetta reads what it writes', () => {
    const failures = Object.fromEntries(EVERY.map((f) => [f, []]));
    const counts = Object.fromEntries(EVERY.map((f) => [f, 0]));
    const unexpectedPasses = new Set();
    let checked = 0;
    for (const values of [VALUES, SIGNED]) {
        for (const input of inputs) {
            let tree;
            try { tree = parseTree(input); } catch { continue; }
            const scope = {};
            let n = 0;
            walk(tree, (node) => {
                if (node.type === 'symbol' && /^[A-Za-zα-ωΑ-Ω]\w*$/.test(node.value) && !CONSTANTS.has(node.value) && !(node.value in scope)) {
                    scope[node.value] = values[n++ % values.length];
                }
            });
            let want;
            try { want = evaluate(tree, scope); } catch { continue; }   // only inputs with a value
            if (typeof want === 'number' && Number.isNaN(want)) continue;   // NaN read back as NaN would prove nothing
            for (const [format, write] of Object.entries(FORMATS)) {
                let code;
                try { code = write(tree); } catch { continue; }   // e.g. 5! has no SQLite
                let ok = false;
                try { ok = same(want, evaluate(parseTree(code), scope)); } catch { /* not ok */ }
                checked++;
                counts[format]++;
                const expected = known.has(`${format}\t${input}`);
                const where = values === VALUES ? '' : ' (negative and whole values)';
                if (!ok && !expected) failures[format].push(`${input}  →  ${code}${where}`);
                if (ok && expected && values === VALUES) unexpectedPasses.add(`${format}: ${input}`);
            }
        }
    }
    for (const format of EVERY) {
        test(`${format}: read back with the same value`, () => eq(failures[format], []));
    }
    test('every listed exception still fails (remove the ones that work now)', () => eq([...unexpectedPasses], []));
    // each format on its own, near what it checks today: a writer that starts throwing (and is skipped) shows here
    test('the sweep covers the cases, in every format', () => {
        // on 2026-11-11: 2068 for most, sympy 1978, sql 2027, glsl 2013, sqlite 1905, excel 1965 (the rest have
        // no such code: SQL and GLSL refuse derivatives, integrals, limits, sums to n and set operations)
        // 2026-11-19: glsl 1933, now that GLSL refuses text (a quoted string was written into the shader as it stood)
        const FLOOR = { sympy: 1950, sql: 2000, glsl: 1910, sqlite: 1880, excel: 1940 };
        eq(checked > 20000, true, `${checked} checks`);
        eq(EVERY.filter((f) => counts[f] < (FLOOR[f] ?? 2040)).map((f) => `${f}: ${counts[f]}`), []);
    });
});

suite('code people type', () => {
    const cases = [
        ['np.where(x > 0, 1/x, 0)', 'x 0 > 1 x / 0 ?:'],
        ['1/x if x > 0 else 0', 'x 0 > 1 x / 0 ?:'],
        ['a if p else b if q else c', 'p a q b c ?: ?:'],
        ['np.maximum(a, b) + np.sqrt(np.abs(x))', 'a b 2 max x abs sqrt +'],
        ['np.logical_and(x >= 0, np.logical_not(y))', 'x 0 ≥ y \\not &'],
        ['np.isin(x, [1, 2])', 'x 1 2 2 {} ∈'],
        ['[1, 2].includes(x) && !done', 'x 1 2 2 {} ∈ done \\not &'],
        ['Number.isInteger(n)', 'n ℤ ∈'],
        ['float(n).is_integer()', 'n ℤ ∈'],
        ['math.isclose(a, b)', 'a b ≈'],
        ['math.factorial(n) / math.factorial(n - k)', 'n ! n k - ! /'],
        ['sum(i ** 2 for i in range(1, n + 1))', 'i 2 ^ i 1 = n 3 \\sumidx'],
        ['scipy.integrate.quad(lambda t: t ** 2, 0, 1)[0]', 't 2 ^ t 0 1 4 int'],
        ['True and not False', 'true false \\not &'],
        ['x % (y + 1)', 'x y 1 + mod'],
        ['Math.abs(x - 1) < 1e-9', 'x 1 - abs 1 10 -9 ^ * <'],
        ['CASE WHEN x > 0 THEN 1 WHEN x < 0 THEN -1 ELSE 0 END', 'x 0 > 1 x 0 < -1 0 ?: ?:'],
        ['POWER(x, 2) + GREATEST(a, b) + LOG(2, y) + PI()', 'x 2 ^ a b 2 max + 2 y log + pi +'],
        ['x NOT IN (1, 2) AND y <> 3', 'x 1 2 2 {} ∉ y 3 ≠ &'],
        ['mz_sq(x) + fract(y) + atan(y, x)', 'x 2 ^ y y floor - + y x atan2 +'],
        ['\\begin{cases} x^2 & \\text{if } x \\ge 0 \\\\ -x & \\text{otherwise} \\end{cases}', 'x 0 ≥ x 2 ^ x neg ?:'],
        ['\\text{round}\\left(x, 2\\right) + \\operatorname{atan2}(y, x)', 'x 2 round y x atan2 +'],
        ['sympy.diff(x**3, x)', 'x 3 ^ x der'],
        ['sympy.integrate(t**2, (t, 0, b))', 't 2 ^ t 0 b 4 int'],
        ['sympy.integrate(sympy.sin(x), x)', 'x sin x 2 int'],
        ['sympy.limit(1/x, x, 0, "+")', '1 x / x 0 "+" 4 lim'],
        ['sympy.summation(i**2, (i, 1, n))', 'i 2 ^ i 1 = n 3 \\sumidx'],
        ['sympy.Rational(1, 3) * x', '1 3 / x *'],
        ['sympy.Piecewise((x**2, x > 0), (-x, True))', 'x 0 > x 2 ^ x neg ?:'],
        ['sympy.Eq(y, sympy.sqrt(x))', 'y x sqrt ='],
        ['sympy.Contains(x, sympy.Interval.Ropen(0, 1))', 'x 0 1 2 [) ∈'],
        ['sympy.And(x > 0, sympy.Not(y)) + sympy.exp(x) + sympy.oo', 'x 0 > y \\not & e x ^ + ∞ +'],
        ['=IF(B2>0, SQRT(B2), 0)', 'B2 0 > B2 sqrt 0 ?:'],
        ['=SUM($D$2:$D$101) / COUNT(D2:D101)', 'D2:D101 1 sum D2:D101 1 \\:COUNT /'],
        ['=-x^2 + 2^3^2', 'x neg 2 ^ 2 3 ^ 2 ^ +'],
        ['=ATAN2(x, y) + LOG(x, 2) + _xlfn.CEILING.MATH(z)', 'y x atan2 2 x log + z ceil +'],
        ['=AND(x>=0, OR(y<>1, NOT(z)))', 'x 0 ≥ y 1 ≠ z \\not | &'],
    ];
    for (const [code, postfix] of cases) {
        test(code, () => eq(parse(code).join(' '), postfix));
    }
});
