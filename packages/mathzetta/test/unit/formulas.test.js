/**
 * Running maths: evaluate(), formulas over table columns as JavaScript (the row evaluator, the generated-code whitelist) and as SQL (the SQLite dialect, checked against evaluate() in a real SQLite).
 */
import { suite, test, eq, throws } from '../harness.js';
import {
    evaluate,
    parse,
    strToFunction,
    strToSQL,
    createRowEvaluator,
    checkGeneratedJs,
    isSafeGeneratedJs,
    UnsafeCodeError,
    toJavaScript,
    toSQL,
    toPython,
    toExcel,
    toPythonFunction,
    toLaTeX,
    toMathML,
    toText,
    filterShader,
    parseTree,
    calculate,
    fromPostfix,
} from '../../src/all.js';

// ---- from evaluate-formulas.test.js ----
const E = (s, scope) => evaluate(parse(s), scope);

suite('evaluate', () => {
    test('arithmetic and functions', () => {
        eq(E('2+3*4'), 14);
        eq(E('2^3^2'), 512);
        eq(E('sqrt(16) + 5!'), 124);
        eq(E('log_2(8)'), 3);
        eq(E('\\binom{5}{2}'), 10);
    });
    test('variables come from the scope', () => eq(E('x^2+1', { x: 3 }), 10));
    test('membership', () => {
        eq(E('2 ∈ {1, 2}'), true);
        eq(E('1 ∈ (1, 2]'), false);
    });
    test('unknown variables and symbolic operators throw', () => {
        throws(() => E('x+1'), /No value for 'x'/);
        throws(() => E('der(x^2, x)', { x: 1 }), /Can't evaluate 'der'/);
    });
});

suite('formulas', () => {
    const header = ['Name', 'Value', 'Count'];
    test('columns become row lookups', () => {
        const f = strToFunction(header, 'Value * 2 + count');
        eq(f.jsFunction, 'c1 * 2 + c2');
        eq(createRowEvaluator(f.jsFunction)(['a', 10, 3]), 23);
    });
    test('string comparisons', () => {
        const f = strToFunction(header, 'Name == "Alpha"');
        eq(createRowEvaluator(f.jsFunction)(['Alpha', 1, 1]), true);
    });
    test('a column named like an operator is still a column', () => {
        const header = ['neg', 'max', 'sum'];
        const f = strToFunction(header, 'not (max > 2) and neg < 0');
        eq(f.success, true);
        eq(createRowEvaluator(f.jsFunction)([-1, 1, 0]), true);
        eq(createRowEvaluator(f.jsFunction)([-1, 3, 0]), false);
        eq(strToSQL(header, 'neg + max * sum').sqlExpression, '"neg" + "max" * "sum"');
    });
    test('unknown words are reported', () => {
        const f = strToFunction(header, 'Value + Missing');
        eq(f.unknownStrings, ['Missing']);
    });
    test('SQL quotes columns and strings', () => {
        eq(strToSQL(header, 'Value > 3 & Name == "O\'Neil"').sqlExpression, `("Value" > 3 AND "Name" = 'O''Neil')`);
    });
});

suite('evaluate: limits of the arithmetic', () => {
    test('huge factorials are Infinity at once', () => {
        eq(E('171!'), Infinity);
        eq(E('1000000000!'), Infinity);
        eq(E('5!'), 120);
    });
    test('permutations do not overflow through n!', () => {
        eq(E('perm(200, 3)'), 200 * 199 * 198);
        eq(Number.isNaN(E('perm(3, 5)')), true);
    });
});

suite('row evaluator', () => {
    test('column references inside string literals are left alone', () => {
        const f = strToFunction(['Name', 'Value'], 'Name == "c1"');
        eq(createRowEvaluator(f.jsFunction)(['c1', 2]), true);
        eq(createRowEvaluator(f.jsFunction)(['x', 2]), false);
    });
});

// ---- from safe.test.js ----
const H = ['HR', 'team'];
const run = (formula, row = [5, 'NYA']) => createRowEvaluator(strToFunction(H, formula).jsFunction)(row);
const refused = (v) => typeof v === 'string' && v.startsWith('Error: not allowed');

suite('safe code generation', () => {
    test('unknown functions and globals are reported and never run', () => {
        let called = false;
        globalThis.alertForTest = () => { called = true; };
        for (const f of ['alert(1)', 'fetch("//x")', 'eval("1")', 'import("x")', 'f(HR)', 'alertForTest(1)', 'HR; alertForTest(1)', 'globalThis', 'this', 'window.location', 'process.exit()']) {
            const r = strToFunction(H, f);
            eq(r.success === false || r.unknownStrings.length > 0, true, `${f} is reported`);
            if (r.success) eq(refused(createRowEvaluator(r.jsFunction)([1, 'x'])), true, `${f} is not compiled`);
        }
        eq(called, false, 'nothing was called');
        delete globalThis.alertForTest;
    });
    test('strings are inert, however they are quoted', () => {
        eq(run('team = `${HR}`'), false);
        eq(strToFunction(H, 'team = `${alert(1)}`').jsFunction, 'c1 == "${alert(1)}"');
        eq(run('team = "x\\" ); alert(1); (\\""'), false);
        eq(run("team = 'NYA'"), true);
        eq(toJavaScript('"a" + \'b\''), '"a" + "b"');
    });
    test('ordinary formulas still compile, helpers included', () => {
        eq(run('HR > 3 and team = "NYA"'), true);
        eq(run('sqrt(HR) + 5!'), Math.sqrt(5) + 120);
        eq(run('gcd(HR, 10)'), 5);
        eq(run('perm(HR, 2) + comb(HR, 2)'), 30);
        eq(run('round(HR / 3, 2)'), 1.67);
        eq(run('team ∈ {"NYA", "BOS"}'), true);
        eq(run('HR ∈ [1, 6)'), true);
        eq(run('max(HR, 3) + abs(-HR) + floor(HR / 2)'), 12);
    });
    test('the gate itself', () => {
        const ok = (c) => isSafeGeneratedJs(c, { variables: /^c\d+$/ });
        for (const c of ['Math.sqrt(c0) > 2', 'Math.E ** 2', '[c0, 1].includes(2)', 'Number.isInteger(c1)', '"a\\"b" == c0', '(c0 ? 1 : 2)']) eq(ok(c), true, c);
        for (const c of ['c0["constructor"]', 'c0.constructor', 'Math.constructor', '(1).constructor', 'Math.max.call(null, 1)', 'Math["max"]',
            "'x'", '`x`', '`${c0}`', 'c0 \\ 1', 'globalThis', 'alert', 'c0.__proto__', 'Function', 'x.y', '"\\x41"', 'new Date']) eq(ok(c), false, c);
        eq(ok('((n) => n * 2)(c0)'), false, "a helper's locals (n, k, r …) are allowed only inside the helpers themselves");
        eq(ok(toJavaScript('c0! + gcd(c0, 4) + comb(c0, 2)')), true, 'the helpers, written exactly as render/code.js writes them, pass');
        eq(ok('+{a:function(){}["constructor"]("return process.env")()}'), false, 'nothing reaches the Function constructor through an object literal');
        eq(ok('{}["constructor"]', { variables: ['a'] }), false, '} ends a value: no indexing after it');
        eq(ok('Array(100000000)'), false, 'Array is not a name a formula may use');
        eq(isSafeGeneratedJs('let c0 = 1', { variables: /^c\d+$/, keywords: false }), false, 'keywords: false refuses statements');
        let threw = null;
        try { checkGeneratedJs('alert(c0)', { variables: /^c\d+$/ }); } catch (e) { threw = e; }
        eq(threw instanceof UnsafeCodeError, true);
        eq(isSafeGeneratedJs('r * g + b', { variables: ['r', 'g', 'b'] }), true);
        eq(isSafeGeneratedJs('r * q', { variables: ['r', 'g', 'b'] }), false);
        const gen = { variables: /^\$\w+$/, indexable: /^\$[A-Z]/, strings: false };
        eq(isSafeGeneratedJs('$O[$j] = $I[$j + 1] * 2;', gen), true, 'generated arrays may be indexed');
        eq(isSafeGeneratedJs('$x[0]', gen), false, 'only the indexable ones');
        eq(isSafeGeneratedJs('($I)[0]', gen), false, 'not through brackets');
        eq(isSafeGeneratedJs('$I["constructor"]', gen), false, 'no strings at all when strings: false');
        eq(isSafeGeneratedJs('$I[(![] + [])]', gen), true, 'harmless without strings or other indexing: a key "false"');
        eq(isSafeGeneratedJs('(![] + [])[0]', gen), false, 'no indexing into a value, so no JSFuck');
    });
});

// ---- from sql-sqlite.test.js ----
const lite = (s, options = {}) => toSQL(s, { dialect: 'sqlite', ...options });

// node:sqlite (Node 22.5+) prints an ExperimentalWarning on first load; keep
// it out of the test output. Older Nodes skip the tests that run SQL.
async function loadSqlite() {
    const emit = process.emitWarning;
    process.emitWarning = (warning, ...rest) => {
        const text = typeof warning === 'string' ? warning : warning?.message;
        if (/SQLite is an experimental feature/.test(text ?? '')) return;
        emit.call(process, warning, ...rest);
    };
    try {
        return (await import('node:sqlite')).DatabaseSync;
    } catch {
        return null;
    } finally {
        process.emitWarning = emit;
    }
}
const DatabaseSync = await loadSqlite();

suite('sql: sqlite dialect strings', () => {
    const cases = [
        ['(a+b)/(c+d)', 'CAST(a + b AS REAL) / (c + d)'],
        ['a/b/c', 'CAST(a AS REAL) / b / c'],
        ['1/x', '1.0 / x'],
        ['-a/b', 'CAST(-a AS REAL) / b'],
        ['a/(b/c)', 'CAST(a AS REAL) / (CAST(b AS REAL) / c)'],
        ['2.5/x', '2.5 / x'],
        ['x^2/2', 'POWER(x, 2) / 2'],
        ['mean(a,b,c)', '((a + b + c) / 3.0)'],
        ['max(a,b,c)', 'MAX(a, b, c)'],
        ['min(a,b)', 'MIN(a, b)'],
        ['csc(x) + sec(x) * cot(x)', '(1.0 / SIN(x)) + (1.0 / COS(x)) * (1.0 / TAN(x))'],
        ['expm1(x)', '(EXP(x) - 1)'],
        ['x < ∞', 'x < 9e999'],
        ['-∞', '-9e999'],
        ['e^x', 'POWER(EXP(1), x)'],
        ['pi r^2', 'PI() * POWER(r, 2)'],
        ['x ∈ [1, 5)', '(x >= 1 AND x < 5)'],
        ['x ∉ {1, 2, 3}', 'x NOT IN (1, 2, 3)'],
        ['x ∈ ℤ', "(typeof(x) IN ('integer', 'real') AND x = TRUNC(x))"],
        ['a mod 3', 'MOD(MOD(a, 3) + 3, 3)'],   // mod takes the divisor's sign; SQL's MOD takes a's
        ['log_2(x)', 'LOG(2, x)'],
        ['x ≈ 1', 'ABS((x) - (1)) < 1e-9'],
        ['"O\'Neil" = name', "'O''Neil' = name"],
        ['if x > 1 then 2 else 3', 'CASE WHEN x > 1 THEN 2 ELSE 3 END'],
    ];
    for (const [input, expected] of cases) test(input, () => eq(lite(input), expected));

    test('quoted identifiers', () => eq(lite('a/b', { quoteIdentifiers: true }), 'CAST("a" AS REAL) / "b"'));
    test('postgres stays the default', () => {
        eq(toSQL('(a+b)/(c+d)'), '(a + b) / (c + d)');
        eq(toSQL('max(a,b)'), 'GREATEST(a, b)');
        eq(toSQL('x < ∞'), "x < 'Infinity'");
        eq(toSQL('a/b', { dialect: 'postgres' }), 'a / b');
    });
    test('unknown dialects throw', () => throws(() => toSQL('a', { dialect: 'mysql' }), /Unknown SQL dialect/));

    const unsupported = ['5!', 'gcd(a, b)', 'perm(5, 2)', 'comb(5, 2)', 'der(x^2, x)', 'int(x, x)',
        'lim(1/x, x→0)', 'x = ±3', 'a ± b', '(a, b)', 'a_1', '{1, 2} ∪ {3}', '{1, 2} ∩ {3}'];
    for (const input of unsupported) test(`${input} throws`, () => throws(() => lite(input), /No SQLite SQL for/));
    test('gcd message', () => throws(() => lite('gcd(a, b)'), /^No SQLite SQL for gcd$/));
});

suite('sql: strToSQL dialect', () => {
    const header = ['H', 'AB', 'HR'];
    test('3-argument form is postgres', () => eq(strToSQL(header, 'max(H, HR)').sqlExpression, 'GREATEST("H", "HR")'));
    test('sqlite option', () => {
        eq(strToSQL(header, 'H / AB', new Map(), { dialect: 'sqlite' }).sqlExpression, 'CAST("H" AS REAL) / "AB"');
        eq(strToSQL(header, 'max(H, HR)', undefined, { dialect: 'sqlite' }).sqlExpression, 'MAX("H", "HR")');
    });
    test('unsupported operators are an error result', () => {
        const r = strToSQL(header, 'HR!', new Map(), { dialect: 'sqlite' });
        eq(r.success, false);
        eq(r.error, 'No SQLite SQL for a factorial');
    });
    test('columns that look like constants stay columns', () => {
        eq(strToSQL(['e', 'pi'], 'e * pi').sqlExpression, '"e" * "pi"');
        eq(strToSQL(['e', 'pi'], 'e * pi', new Map(), { dialect: 'sqlite' }).sqlExpression, '"e" * "pi"');
    });
});

// Run the generated SQL in SQLite and compare with evaluate().
suite('sql: sqlite results match evaluate()', () => {
    if (!DatabaseSync) {
        test('node:sqlite unavailable: skipped', () => {});
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

// ---- added 2026-11-03: evaluate() on sets, intervals, chains and its refusals ----
suite('evaluate: sets, intervals, chains', () => {
    const E = (s, scope) => evaluate(s, scope);
    test('number sets', () => {
        eq(E('2 ∈ ℝ'), true); eq(E('2.5 ∈ ℤ'), false); eq(E('0 ∈ ℕ'), false); eq(E('3 ∈ ℕ'), true);
        eq(E('2 ∈ ℚ'), true); eq(E('2 ∈ ℂ'), true); eq(E('2.5 ∉ ℤ'), true);
    });
    test('intervals, open and closed at each end', () => {
        eq(E('1 ∈ (0, 1)'), false); eq(E('1 ∈ (0, 1]'), true); eq(E('0 ∈ [0, 1)'), true); eq(E('0 ∈ (0, 1]'), false);
        eq(E('1 ∈ [0, 1]'), true); eq(E('x ∉ [0, 1]', { x: 2 }), true);
    });
    test('finite sets, union, intersection, congruence', () => {
        eq(E('5 ∉ {1,2,3}'), true); eq(E('{1,2} ∪ {2,3}'), [1, 2, 3]); eq(E('{1,2} ∩ {2,3}'), [2]);
        eq(E('7 ≡ 2 (mod 5)'), true); eq(E('7 (mod 5)'), 2);
    });
    test('± gives both values; loglog is ln ln, as every renderer and calculate()', () => {
        eq(E('5 ± 2'), [7, 3]);
        eq(Math.abs(E('loglog(100)') - Math.log(Math.log(100))) < 1e-12, true);
        eq(Math.abs(E('logloglog(10^10)') - Math.log(Math.log(Math.log(1e10)))) < 1e-12, true);
    });
    test('indexed sums and products over a finite range', () => {
        eq(E('sum(i^2, i=1, 5)'), 55); eq(E('\\prod_{k=1}^{4} k'), 24); eq(E('\\sum_{i=1}^{n} i', { n: 10 }), 55);
        throws(() => E('\\sum_{i=1}^{\\infty} i'), /over that range/);
    });
    test('a chain of comparisons is read as maths', () => {
        eq(E('3 < x < 7', { x: 5 }), true); eq(E('3 < x < 7', { x: 10 }), false); eq(E('1 ≤ x ≤ 1', { x: 1 }), true);
    });
    test('refusals: a name with no value, a symbolic operation', () => {
        throws(() => E('x + 1'), /No value for 'x'/);
        throws(() => E('der(x^2, x)', { x: 2 }), /Can't evaluate 'der'/);
    });
});

// ---- added 2026-11-03: the security review's cases, each one refused or made inert ----
suite('security: untrusted formulas', () => {
    const refuses = (fn, pattern) => throws(fn, pattern);
    test("a limit's side is r or l: text there can't close the quotes", () => {
        // JavaScript and numeric Python have no limit at all now (refused by name); SymPy writes only r or l
        refuses(() => toJavaScript("lim(x, x, 0, ' + alert(document.domain) + ')"), /No JavaScript for a limit/);
        refuses(() => toPython("lim(x, x, 0, ' + alert(1) + ')", { sympy: true }), /No SymPy for text/);
        eq(toPython('lim(x, x, 0, q)', { sympy: true }), 'sympy.limit(x, x, 0)');   // a side that is no side: none written
        eq(toPython('lim(x, x, 0, r)', { sympy: true }), 'sympy.limit(x, x, 0, "+")');
    });
    test('SQL: no function the caller did not list, no name that is not a column', () => {
        const r = strToSQL(['Value'], '\\text{SELECT secret FROM users WHERE}(1) = "admin"', new Map(), { dialect: 'sqlite' });
        eq(r.success, false);
        eq(strToSQL(['Value'], 'Value + other', new Map(), { dialect: 'sqlite' }).success, false);
        eq(strToSQL(['Value'], 'Value * 2 > 3', new Map(), { dialect: 'sqlite' }).success, true);
        refuses(() => toSQL('\\text{DROP TABLE x}(1)'), /No SQL for the function/);
        refuses(() => toSQL('load_extension(x)'), /No SQL for the function/);
        eq(toSQL('median(x)', { functions: ['median'] }), 'MEDIAN(x)');
        eq(toSQL('\\text{a b} + 1'), '"a b" + 1');   // a name that isn't an identifier is always quoted
    });
    test("SQL: a string's text can't end the literal early (SQL reads no backslash escapes)", () => {
        eq(toSQL("'x\\' OR 1=1; --' + 1"), "'x'' OR 1=1; --' || 1");
        eq(toSQL('"x\\" OR 1=1; --" + 1'), "'x\" OR 1=1; --' || 1");   // single quotes in both dialects: "…" is a column in SQL
        eq(toSQL('"x\\" OR 1=1; --" + 1', { stringQuote: '"' }), '"x"" OR 1=1; --" || 1');
        eq(toSQL("'x\\' OR 1=1; --' + 1", { stringQuote: "'" }), "'x'' OR 1=1; --' || 1");
        eq(toSQL('`a` + 1'), "'a' || 1");
        eq(toSQL("'plain' + 1"), "'plain' || 1");
        eq(strToSQL(['a'], "a = 'x\\' OR 1=1 --'").sqlExpression, `"a" = 'x'' OR 1=1 --'`);
    });
    test('spreadsheets: no function the caller did not list (WEBSERVICE, IMPORTXML)', () => {
        refuses(() => toExcel('\\text{WEBSERVICE}(1)'), /the function WEBSERVICE/);
        refuses(() => toExcel('\\text{a b} + 1'), /the name/);
    });
    test('Python: no string index, no dunder string', () => {
        refuses(() => toPythonFunction('x_{"__class__" + ""}', { params: ['x'] }), /string inside \[ \]|the string/);
        eq(toPythonFunction('x_{i+1}', { params: ['x', 'i'] }).code.includes('x[i + 1]'), true);
    });
    test("Object's own names (constructor, toString, __proto__) are ordinary names everywhere", () => {
        for (const n of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
            for (const out of [toLaTeX([n]), toMathML([n]), toText([n]), toJavaScript([n]), toSQL([n])]) {
                eq(/native code|function /.test(out), false, `${n}: ${out}`);
            }
        }
        eq(toJavaScript('\\text{toString} + 1'), 'toString + 1');
    });
    test('names from a postfix array or tree are escaped in MathML and LaTeX', () => {
        eq(toMathML(['1', '1', '\\:<img src=x onerror=alert(1)>']).includes('<img'), false);
        eq(toMathML({ type: 'number', value: '<b>1</b>' }).includes('<b>'), false);
        eq(toLaTeX(['1', '1', '\\:\\href{javascript:alert(1)}{x}']).includes('\\href{'), false);
    });
    test("filterShader: the caller's uniform and picture names must be GLSL identifiers", () => {
        const parse = (t) => parseTree(t);
        refuses(() => filterShader('x', { parse, uniforms: { 'a; } void main(){': 'float' } }), /GLSL name and type/);
        refuses(() => filterShader('x', { parse, uniforms: { amt: 'float; uniform x' } }), /GLSL name and type/);
        refuses(() => filterShader('x', { parse, images: ['mask x'] }), /GLSL identifier/);
    });
});

// ---- added 2026-11-03: nothing an untrusted formula can do runs for long ----
suite('limits: work, size and depth', () => {
    const quick = (fn, ms = 2000) => {
        // fn holds its own assertion (an answer, or a refusal with `throws`): it must pass, and fast
        const t = Date.now();
        let failure;
        try { fn(); } catch (error) { failure = error; }
        eq(Date.now() - t < ms, true, `took ${Date.now() - t} ms`);
        if (failure) throw failure;
    };
    test('perm and comb stop once the answer is ∞', () => {
        quick(() => eq(evaluate('perm(100000000000, 100000000000)'), Infinity), 200);
        quick(() => eq(evaluate('comb(100000000000, 50000000000)'), Infinity), 200);
        eq(evaluate('comb(52, 5)'), 2598960);
        eq(evaluate('comb(1000, 999)'), 1000);
    });
    test('sums of sums run out of steps instead of running for ever', () => {
        throws(() => evaluate('\\sum_{i=1}^{100000} \\sum_{j=1}^{100000} 1'), /Too much to work out/);
        throws(() => calculate('\\sum_{i=1}^{\\infty} \\sum_{j=1}^{\\infty} 1/(i^2 j^2)'), /too much to work out/);
        eq(calculate('\\sum_{i=1}^{\\infty} 1/i^2').text, 'pi^2/6');
    });
    test('input is at most 5000 characters unless the caller says otherwise', () => {
        throws(() => parse('x+'.repeat(3000) + '1'), /Longer than 5000 characters/);
        eq(parse('x+'.repeat(400) + '1', { maxLength: 10000 }).length, 801);
        throws(() => parse('x+'.repeat(3000) + '1', { maxLength: 10000 }), /Nested too deeply/);   // 3000 terms: deeper than 1000
        try { parse('x+'.repeat(3000) + '1'); } catch (e) { eq(e.message.length < 200, true, 'the message quotes the start of the input, not all of it'); }
    });
    test('trees are at most 1000 levels deep', () => {
        throws(() => fromPostfix(['x', ...Array(1500).fill('neg')]), /Nested too deeply/);
        throws(() => evaluate(['1', ...Array(5000).fill('neg')]), /Nested too deeply/);
    });
    test('outputs that copy an operand can not double their way to gigabytes', () => {
        quick(() => throws(() => toJavaScript('x between 1 and '.repeat(40) + '2'), /too long/));
        quick(() => throws(() => parse('trunc('.repeat(30) + 'x' + ')'.repeat(30)), /expands too much/));
    });
    test('a filter pass has at most 24 neighbourhood calls (the GPU watchdog)', () => {
        const parse = (t) => parseTree(t);
        eq(typeof filterShader('gaussian(8) * '.repeat(24) + '1', { parse }), 'string');
        throws(() => filterShader('gaussian(8) * '.repeat(25) + '1', { parse }), /At most 24 neighbourhood/);
    });
    test("English operands don't backtrack across a long word", () => {
        quick(() => parse('x is within ' + 'a'.repeat(4900) + ' of 2'), 500);
    });
});
