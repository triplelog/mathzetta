/**
 * Every output means the same thing: evaluate(), calculate(), the generated JavaScript (run) and SQLite's SQL
 * (run, where node:sqlite is there) agree on a value — with negative numbers and halves, which the tables
 * never had (mod takes the divisor's sign, round takes a half away from zero, trunc goes toward zero, an odd
 * root of a negative number is real), text search, roots whose index is a column. python.test.js runs the Python.
 */
import { suite, test, skip, eq, throws } from '../harness.js';
import {
    calculate, createRowEvaluator, evaluate, parse, strToFunction, strToSQL, toJavaScript, toSQL,
} from '../../src/all.js';
import { DatabaseSync, sqliteTest } from '../helpers.js';

const db = DatabaseSync ? new DatabaseSync(':memory:') : null;
/** In a suite that also runs SQLite: say so when it can't. */
const noSqlite = () => { if (!db) skip('the SQLite checks', 'node:sqlite is missing (Node before 22.5)'); };

const close = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) : a === b);

/** What SQLite gave, as a JavaScript value: an INTEGER read as a BigInt is a number; NULL stays null (it is not 0). */
const fromSql = (v) => (typeof v === 'bigint' ? Number(v) : v);

const runJs = (input) => createRowEvaluator(strToFunction([], input).jsFunction)([]);

const runSqlite = (input) => db.prepare(`SELECT ${toSQL(input, { dialect: 'sqlite' })} AS v`).get().v;

/** [input, the value] — the value every output must give. */
const VALUES = [
    ['-7 mod 3', 2], ['7 mod -3', -2], ['7 mod 3', 1], ['-7.5 mod 2', 0.5], ['-1 mod 5', 4],
    ['round(-2.5)', -3], ['round(2.5)', 3], ['round(-2.25, 1)', -2.3], ['round(-0.5)', -1],
    ['trunc(-2.7)', -2], ['trunc(2.7)', 2], ['trunc(-0.5)', 0],
    ['cbrt(-8)', -2], ['root(3, -27)', -3], ['root(5, -32)', -2], ['cbrt(8)', 2],
    ['-1*(2+3)', -5], ['1 + -1*(2+3)', -4], ['10 - -1*(2+3)', 15], ['-(-5)', 5], ['-1*-5', 5],
    ['round(1.234+2.345, 2)', 3.58], ['round(-1.234-2.345, 1)', -3.6],
    ['max(3)', 3], ['mean(1, 2 = 2, 3)', 5 / 3],
    ['50% * 8', 4], ['12.5% + 1', 1.125],
];

suite('agreement: evaluate, calculate, JavaScript and SQLite give one value', () => {
    noSqlite();
    for (const [input, want] of VALUES) {
        test(input, () => {
            eq(close(evaluate(input), want), true, `evaluate ${evaluate(input)}`);
            eq(close(calculate(input).value, want), true, `calculate ${calculate(input).text}`);
            eq(close(runJs(input), want), true, `JavaScript ${toJavaScript(input)} → ${runJs(input)}`);
            if (db) eq(close(fromSql(runSqlite(input)), want), true, `SQLite ${toSQL(input, { dialect: 'sqlite' })} → ${runSqlite(input)}`);
        });
    }
    test('xor is a true or false in JavaScript, not one of its operands', () => {
        eq(runJs('floor(ln(-1) xor -2)'), evaluate('floor(ln(-1) xor -2)'));
        eq(runJs('0 xor -2'), true);
    });
    test('loose = between a number and true or false: 1 = true as JavaScript\'s ==, in evaluate and calculate alike', () => {
        for (const [input, want] of [['1 = true', true], ['0 = false', true], ['2 = true', false], ['1 ≠ true', false], ['true = 1', true],
            ['0.5*2 = true', true], ['[1, 0] = [true, false]', true], ['1 === true', false], ['1 ≠= true', true]]) {
            eq(evaluate(input), want, `evaluate ${input}`);
            eq(calculate(input).value, want, `calculate ${input}`);
        }
        for (const input of ['1 = true', '2 = true', '1 === true']) eq(runJs(input), evaluate(input), `JavaScript ${input}`);
        eq(evaluate('x = true', { x: 1 }), true);
        eq(calculate('x = true', { x: 1 }).value, true);
    });
    test('lists are equal entry by entry in evaluate, as in calculate', () => {
        eq(evaluate('[1, 2] = [1, 2]'), true);
        eq(calculate('[1, 2] = [1, 2]').value, true);
        eq(evaluate('[[1,2],[3,4]]*[[5,6],[7,8]]=[[19,22],[43,50]]'), true);
    });
    test('a sum with no index named is summed over its variable by evaluate too', () => {
        eq(evaluate('\\sum_0^3 i^2'), 14);
        eq(calculate('\\sum_0^3 i^2').text, '14');
    });
});

/** Text search: one answer everywhere — A to Z fold, nothing else does, nothing is a pattern, a number is its digits. */
const TEXT_SEARCH = [
    ['"ab" in "CAB"', true], ['"ab" ∉ "CAB"', false], ['contains("CAB", "AB")', true], ['"ba" in "CAB"', false],
    ['startswith("Abc", "ab")', true], ['startswith("Abc", "bc")', false], ['not startswith("Abc", "AB")', false],
    ['"é" in "É"', false], ['"%" in "a_b"', false], ['"_" in "a_b"', true], ['"6" in 62', true], ['startswith(62, "6")', true],
    ['2 * startswith("ab", "A") + 1', 3], ['2 * ("x" ∉ "ab") + 1', 3], ['"" in "ab"', true],
];

suite('agreement: text search gives one answer in evaluate, calculate, JavaScript and SQLite', () => {
    noSqlite();
    for (const [input, want] of TEXT_SEARCH) {
        test(input, () => {
            eq(evaluate(input), want, 'evaluate');
            eq(calculate(input).value, want, `calculate ${calculate(input).text}`);
            eq(runJs(input), want, `JavaScript ${toJavaScript(input)}`);
            // SQLite has no true or false: a test is the INTEGER 1 or 0 (never NULL)
            if (db) eq(fromSql(runSqlite(input)), Number(want), `SQLite ${toSQL(input, { dialect: 'sqlite' })}`);
        });
    }
    test('startswith takes two arguments in evaluate and calculate too', () => {
        throws(() => evaluate('startswith("ab")'), /startswith\(name, "Mc"\)/);
        throws(() => calculate('startswith("ab", "a", 1)'), /startswith\(name, "Mc"\)/);
    });
});

suite('agreement: a root whose index is a column (known only as it runs) is real for an odd index', () => {
    noSqlite();
    // over a table's columns, as tabview runs a formula: n and x are columns, so the code can't see the index
    const H = ['n', 'x'];
    const rows = [[3, -8, -2], [-3, -8, -0.5], [5, -32, -2], [2, 9, 3], [3, 27, 3], [1, -4, -4]];
    for (const [n, x, want] of rows) {
        test(`root(${n}, ${x}) = ${want}`, () => {
            eq(close(evaluate('root(n, x)', { n, x }), want), true, `evaluate ${evaluate('root(n, x)', { n, x })}`);
            eq(close(createRowEvaluator(strToFunction(H, 'root(n, x)').jsFunction)([n, x]), want), true, 'JavaScript');
            if (db) {
                const sql = strToSQL(H, 'root(n, x)', new Map(), { dialect: 'sqlite' }).sqlExpression;
                eq(close(db.prepare(`SELECT ${sql} AS v FROM (SELECT ? AS n, ? AS x)`).get(n, x).v, want), true, `SQLite ${sql}`);
            }
        });
    }
    test('an even index of a negative number has no real value everywhere', () => {
        eq(Number.isNaN(evaluate('root(n, x)', { n: 2, x: -4 })), true);
        eq(Number.isNaN(createRowEvaluator(strToFunction(H, 'root(n, x)').jsFunction)([2, -4])), true);
    });
});

suite('agreement: membership in a column is a text search (a column holds one value, never a list)', () => {
    noSqlite();
    const H = ['name', 'team'];
    const rows = [['Cab Team', 'ab', true], ['Cab Team', 'AB', true], ['Cab Team', 'zz', false], [null, 'ab', false], ['abc', null, true], [62, 6, true]];
    for (const [name, team, want] of rows) {
        test(`team in name with name ${JSON.stringify(name)}, team ${JSON.stringify(team)}`, () => {
            // each spelling, and its negation: the opposite answer for every row, a missing value included
            const forms = [['team in name', want], ['contains(name, team)', want], ['team not in name', !want], ['not contains(name, team)', !want]];
            for (const [f, expected] of forms) {
                eq(createRowEvaluator(strToFunction(H, f).jsFunction)([name, team]), expected, `JavaScript ${f}`);
                if (db) {
                    const sql = strToSQL(H, f, new Map(), { dialect: 'sqlite' }).sqlExpression;
                    const v = db.prepare(`SELECT ${sql} AS v FROM (SELECT ? AS name, ? AS team)`).get(...[name, team].map((v) => (Number.isInteger(v) ? BigInt(v) : v))).v;   // whole numbers as INTEGER, as a table holds them
                    eq(fromSql(v), Number(expected), `SQLite ${sql} (1 or 0, never NULL)`);
                }
            }
        });
    }
    test('evaluate and calculate: a text in the scope is searched, a list is still a list', () => {
        eq(evaluate('team in name', { team: 'ab', name: 'CAB' }), true);
        eq(evaluate('x in L', { x: 2, L: [1, 2] }), true);
        eq(calculate('team in name', { team: '"ab"', name: '"Cab"' }).text, 'true');
        eq(evaluate('"ab" in "CAB"'), true, 'a quoted text on the right is a text too');
    });
});

// Run the generated SQL in SQLite and compare with evaluate().
suite('agreement: SQLite gives what evaluate() gives, row by row', () => {
    if (!DatabaseSync) {
        sqliteTest('every formula', () => {});
        return;
    }
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a INTEGER, b INTEGER, x REAL, y REAL, s TEXT)');
    const rows = [
        { a: 7, b: 2, x: 2.5, y: 0.5, s: "O'Neil" },
        { a: -7, b: 3, x: 0.25, y: 1.5, s: 'Alpha' },
        { a: 10, b: 5, x: 1, y: 0.75, s: 'Beta' },
        { a: 3, b: 4, x: 0.9, y: 2, s: 'Alpha' },
    ];
    const insert = db.prepare('INSERT INTO t (a, b, x, y, s) VALUES (?, ?, ?, ?, ?)');
    for (const r of rows) insert.run(r.a, r.b, r.x, r.y, r.s);

    const same = (got, want) => {
        if (typeof want === 'boolean') want = Number(want);
        if (Number.isNaN(want)) return got === null;   // SQLite has no NaN: it gives NULL
        if (typeof want === 'number' && typeof got === 'number') {
            if (!Number.isFinite(want)) return got === want;
            return Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
        }
        return got === want;
    };
    const check = (label, sql, expected) => {
        const got = db.prepare(`SELECT ${sql} AS v FROM t ORDER BY id`).all().map((r) => r.v);
        got.forEach((g, i) => {
            if (!same(g, expected[i])) throw new Error(`row ${i}: SQLite ${g}, evaluate ${expected[i]} (${sql})`);
        });
    };

    const formulas = [
        // arithmetic, with the integer-division traps
        'a / b', 'a / b / 2', '(a + b) / (a - b)', '1 / b', '-a / b', 'a / (b / 3)', '7 / 2', 'a / b * b',
        'mean(a, b)', 'mean(a, b, 4)', 'sum(a, b, x)', 'prod(a, b)', 'a - b - 1', '2a + 3b', 'a / b > 3',
        // powers, roots, logs
        'a^2 / b', 'b^(-1)', '2^b', 'x^y', 'sqrt(x)', 'root(3, x)', 'cbrt(a)', '\\sqrt{b}^3',
        'ln(x)', 'log_2(b)', 'log10(b)', 'e^x', 'exp(y)', 'expm1(y)',
        // trig and hyperbolic
        'sin(x) + cos(y)', 'tan(x)', 'csc(x)', 'sec(x)', 'cot(x)', 'arcsin(y / 2)', 'arccos(y / 2)', 'arctan(x)',
        'sinh(x)', 'cosh(x)', 'tanh(x)', 'arcsinh(x)', 'arccosh(b + 1)', 'arctanh(x / 3)', 'atan2(a, b)', 'x°',
        'pi x^2', 'tau', 'x < ∞', '-∞ < a',
        // min/max, rounding, mod
        'max(a, b, x)', 'min(a, y)', 'max(a, b) / min(b, 3)', 'abs(a)', 'floor(x a)', 'ceil(x a)', 'round(x / 3, 2)',
        'round(a / b)', 'a mod b', '(a + 1) mod 3', 'a ≡ b (mod 3)',
        // comparisons and logic
        'a > b', 'a = 10', 'a ≠ 3', 'a ≤ b', 'x ≥ y', 'x ≈ 0.25', 'a > 0 and b < 4', 'a > 5 or x < 0.5',
        'not (a > 0)', 'a > 0 xor b > 3', 'a > 0 nand b > 3', 'a > 0 nor b > 3', 'true & a > 0',
        'if a > 0 then a / b else x', 'a > 5 ? 1 : 0',
        // membership
        'a ∈ [3, 7]', 'a ∈ (3, 7]', 'a ∈ [3, 7)', 'a ∉ {7, 10}', 'b ∈ {2, 3}', 'a ∈ ℤ', 'x ∈ ℤ', 'a ∈ ℕ', 'x ∈ ℝ',
        's = "Alpha"', 's = "O\'Neil"', 's ∈ {"Alpha", "Beta"}',
    ];
    for (const formula of formulas) {
        test(formula, () => {
            const postfix = parse(formula);
            // evaluate() has no value for the degree sign, so give it one.
            const expected = rows.map((r) => evaluate(postfix, { ...r, '°': Math.PI / 180 }));
            check(formula, toSQL(postfix, { dialect: 'sqlite', quoteIdentifiers: true }), expected);
        });
    }

    test('strToSQL over baseball columns', () => {
        db.exec('CREATE TABLE bat (id INTEGER PRIMARY KEY, H INTEGER, AB INTEGER, HR INTEGER)');
        const stats = [[150, 500, 30], [98, 410, 4], [0, 12, 0]];
        const add = db.prepare('INSERT INTO bat (H, AB, HR) VALUES (?, ?, ?)');
        for (const s of stats) add.run(...s);
        const header = ['H', 'AB', 'HR'];
        for (const formula of ['H / AB', 'h/ab > 0.25', 'HR / AB * 100', 'max(H, HR * 5)', 'round(H / AB, 3)',
            'HR ∈ [1, 30)', '(H - HR) / (AB - HR)', 'mean(H, AB, HR)']) {
            const sql = strToSQL(header, formula, new Map(), { dialect: 'sqlite' });
            const fn = strToFunction(header, formula);
            const expected = stats.map(([h, ab, hr]) => evaluate(fn.postfixArray, { c0: h, c1: ab, c2: hr }));
            const got = db.prepare(`SELECT ${sql.sqlExpression} AS v FROM bat ORDER BY id`).all().map((r) => r.v);
            got.forEach((g, i) => {
                if (!same(g, expected[i])) throw new Error(`${formula} row ${i}: SQLite ${g}, evaluate ${expected[i]} (${sql.sqlExpression})`);
            });
        }
    });
});
