// MathZetta reads what it writes: every input in test/cases, written as LaTeX,
// text, JavaScript, Python, numpy, SymPy, SQL (both dialects) and GLSL, then parsed
// back, has the same value as the input (evaluated with the same variables).
// The few that don't are listed below with the reason; the run fails if a
// new one appears, and if a listed one starts working (then remove it).
import { readFileSync, readdirSync } from 'node:fs';
import { suite, test, eq } from '../harness.js';
import { parseTable } from '../checks.js';
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
    // since 2026-11-22 Python, numpy, SymPy and SQL write a strict comparison of a number with a true or false (or a
    // text) as its answer, FALSE (GLSL too), and a plain = between them is false in evaluate too; LaTeX still differs
    [['0===false', '1===true'], ['latex'],
        "JavaScript's strict equality; these languages write plain ="],
    [['"1"===1', '""===0'], ['latex'],
        "the same, with text (SymPy and GLSL refuse text, so they aren't checked)"],
    [['Math.round(x/7,2)+math.round(x/7)+round(13.244,i)'], ['glsl'],
        'a digit count that is a variable: GLSL has no way to round to i places, so it rounds to whole numbers'],
    [['random()', '=RAND()'], EVERY, 'a random number: no one value to compare'],
    [['a ± b', '[1, 2]'], ['sql'], 'PostgreSQL arrays and set operations (ARRAY[…], INTERSECTION) are written but not read back'],
    [['fixed(2.5, 3)', 'fixed(3.14159, 2)', 'fixed(1/3, 4)', 'fixed(-2.5, 0)', 'fixed(2.5)', 'fixed(x, y)', 'fixed(x, 2)', '=FIXED(x, 1)'], ['python', 'numpy', 'sympy', 'sqlite'],
        "fixed's digit count sits inside a string ('.2f', '%.2f') the reader doesn't open; JavaScript, SQL, Excel and GLSL read back"],
    [['fixed(x, y)'], ['sql', 'glsl'],
        'read back as round(x, y): with a digit count that is not a whole number, fixed takes its whole part and round does not; GLSL (no text) has to ignore a non-literal count'],
    [['\\sin\\theta', 'r\\cos\\theta', '1 + \\tan^2\\theta = \\sec^2\\theta', '\\theta = \\tan^{-1}\\left(\\frac{y}{x}\\right)',
        '\\theta = \\arctan(y/x)', '\\alpha', 'ε^21', '\\Pi*\\gamma', '\\Delta x', '\\frac{\\Delta y}{\\Delta x}'], ['glsl'],
        'GLSL names have no Greek letters: θ is written theta, Δx delta_x — another variable when read back'],
    [['∞', 'Infinity + NaN'], ['sql'], "PostgreSQL's ∞ is the string 'Infinity'"],
    [['\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'], ['sql'],
        'a matrix as a PostgreSQL array is written but not read back (a GLSL mat2 is read back since 2026-11-22)'],
    [['bmatrix([1, 2], [3, 4]) * bmatrix(x, y)'], ['glsl'], 'the same, in a product (PostgreSQL refuses a matrix product)'],
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
    // the tables' own reader: no comment lines, and the header row (the first) is not an input
    for (const row of parseTable(readFileSync(new URL(file, DIR), 'utf8')).slice(1)) {
        const input = row[0]?.trim();
        if (input) inputs.add(input);
    }
}

const VALUES = [0.7, 1.3, 2.1, 0.4, 1.9, 3.2, 0.6, 2.5];
const CONSTANTS = new Set(['pi', 'e', 'tau', 'true', 'false', 'null', 'undefined']);
/** One value read two ways: lists entry by entry, a true or false as 1 or 0 (code has no booleans), numbers within 1e-9. */
const same = (a, b) => {
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
    if (typeof a === 'boolean' || typeof b === 'boolean') {
        const truth = (v) => (typeof v === 'boolean' ? Number(v) : v === 0 || v === 1 ? v : NaN);
        return truth(a) === truth(b);
    }
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
        return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
    }
    // fixed() gives text ("2.50"); SQL and GLSL have no such text and write the rounded number: the same value
    if (typeof a === 'string' && typeof b === 'number' && /^-?\d+(\.\d+)?$/.test(a)) return same(Number(a), b);
    return a === b;
};

// a second pass with negative and whole values: mod, round, trunc and roots differ between languages there
const SIGNED = [-2, 3, -1.5, 4, -0.5, 2, -3, 1];

suite('round trip: mathzetta reads what it writes', () => {
    const failures = Object.fromEntries(EVERY.map((f) => [f, []]));
    const counts = Object.fromEntries(EVERY.map((f) => [f, 0]));
    const knownFailed = new Set();    // listed exceptions that failed in some pass: still needed
    const knownChecked = new Set();   // listed exceptions that were checked at all
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
                if (expected) knownChecked.add(`${format}\t${input}`);
                if (!ok && expected) knownFailed.add(`${format}\t${input}`);
            }
        }
    }
    for (const format of EVERY) {
        test(`${format}: read back with the same value`, () => eq(failures[format], []));
    }
    // in either pass (whole and negative values too); a listed one that is never checked (no value, no code) is dead
    test('every listed exception still fails (remove the ones that work now)', () => {
        eq([...known.keys()].filter((k) => knownChecked.has(k) && !knownFailed.has(k)).map((k) => k.replace('\t', ': ')), [], 'pass now');
        eq([...known.keys()].filter((k) => !knownChecked.has(k)).map((k) => k.replace('\t', ': ')), [], 'never checked');
    });
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

// Text search ("ab" in name, startswith(name, "ab")) is written as inline helpers in JavaScript, Python and numpy:
// the reader takes them back (matched as exact text, so they hold no string literal: strings are placeholders by then)
suite('round trip: text search comes back from the code outputs', () => {
    const TEXT = ['"aa" in name', '"aa" ∉ name', 'contains(name, "AA")', 'startswith(name, "ted")', 'not startswith(name, "T")',
        '2 * startswith(name, "A") + ("x" ∉ name)', 'startswith(name, "a") and "ron" in name or h > 60'];
    const SCOPES = [{ name: 'Aaron', h: 62 }, { name: 'Ted Williams', h: 43 }, { name: 'Xavier', h: 70 }];
    for (const format of ['javascript', 'python', 'numpy', 'text', 'latex']) {
        test(format, () => {
            for (const input of TEXT) {
                const written = FORMATS[format](input);
                const back = parse(written);
                for (const scope of SCOPES) {
                    const [got, want] = [evaluate(back, scope), evaluate(input, scope)];
                    eq(same(got, want), true, `${input} → ${written} → ${back.join(' ')}: ${got}, not ${want}`);
                }
            }
        });
    }
});
