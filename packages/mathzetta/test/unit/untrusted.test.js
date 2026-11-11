/**
 * Untrusted input, continued (formulas.test.js has the first suites): the holes and the long runs the
 * 2026-11 review found — the code checkers, escaping, lookup tables with Object's prototype, and work
 * that ran far past a second. Each test fails if its fix is undone.
 */
import { suite, test, eq, throws } from '../harness.js';
import {
    parse, evaluate, calculate, calculateBlock, toLaTeX, toMathML, toJavaScript, toPython, toSQL, toExcel, toGLSL,
    strToFunction, strToSQL, strToExcel, createRowEvaluator, isSafeGeneratedJs, checkGeneratedPython, toPythonFunction,
    preparePythonTemplate,
} from '../../src/all.js';

const quick = (fn, ms = 1500) => {
    const t = Date.now();
    let failure;
    try { fn(); } catch (error) { failure = error; }
    eq(Date.now() - t < ms, true, `took ${Date.now() - t} ms`);
    if (failure) throw failure;
};

suite('untrusted: the code checkers', () => {
    test('a comment can not hide code from checkGeneratedJs (it read /* " */ … /* " */ as one string)', () => {
        const code = '1 /* " */ + (globalThis.pwned = 7, 2) /* " */';
        eq(isSafeGeneratedJs(code, { variables: /^c\d+$/, keywords: false }), false);
        eq(createRowEvaluator(code)([]).startsWith('Error: not allowed in a formula: a comment'), true);
        eq(globalThis.pwned, undefined);
        for (const c of ['1 // x', 'c0 <!-- x', '--> x']) eq(isSafeGeneratedJs(c, { variables: /^c\d+$/ }), false, c);
        eq(isSafeGeneratedJs('c0 / c1', { variables: /^c\d+$/ }), true);
    });
    test('checkGeneratedPython refuses a string right after a name: f"{…}" is an f-string, and runs code', () => {
        throws(() => checkGeneratedPython('f"{print(1)}"', { variables: ['f', 'x'] }), /a string right after a value/);
        throws(() => checkGeneratedPython('rb"x"', { variables: ['rb'] }), /a string right after a value/);
        eq(checkGeneratedPython('x == "a"', { variables: ['x'] }), 'x == "a"');
    });
    test('generated JavaScript passes its own checker, and the Python its own (fixed, cube roots, rounding)', () => {
        for (const f of ['fixed(x, 2)', 'cbrt(x)', 'round(x, 2)', 'x mod 3', 'round(-x)', 'x xor y', 'root(5, x)']) {
            toPythonFunction(f);
            toPythonFunction(f, { numpy: true });
            eq(isSafeGeneratedJs(strToFunction(['x', 'y'], f).jsFunction, { variables: /^c\d+$/, keywords: false }), true, f);
        }
    });
});

suite('untrusted: escaping and lookups', () => {
    test("a string's text is escaped in LaTeX: it can't close \\text{} or start a command", () => {
        eq(toLaTeX('x = "}\\href{https://e.example}{c"'), 'x = \\text{"\\}\\textbackslash{}href\\{https://e.example\\}\\{c"}');
        eq(toLaTeX('"50%"'), '\\text{"50\\%"}');
        eq(toLaTeX(['x', '1', '\\:a%b']), '\\operatorname{a\\%b}\\left(x\\right)');
    });
    test("a hand-made tree's id goes into MathML only as a number", () => {
        eq(toMathML({ type: 'symbol', value: 'x', id: '"><img src=x onerror=alert(1)>' }), '<math><mi>x</mi></math>');
        eq(toMathML('x'), '<math><mi id="mz-0">x</mi></math>');
    });
    test('-(-5) is never written --5 (a syntax error in JavaScript, a comment in SQL, a decrement in GLSL)', () => {
        for (const input of ['-(-5)', ['-1', '-5', '*'], ['-1', 'x', 'neg', '*']]) {
            for (const write of [toJavaScript, toSQL, toGLSL, toPython, toExcel, toLaTeX]) eq(/--/.test(write(input)), false, `${write.name}: ${write(input)}`);
        }
        const r = strToSQL(['a', 'b'], 'a > -(-5) & b < 3', new Map(), { dialect: 'sqlite' });
        eq(r.sqlExpression, '("a" > -(-5) AND "b" < 3)');
    });
    test('names like toString find nothing in the outputs\' tables', () => {
        eq(typeof toSQL('x ∈ \\text{toString}', { dialect: 'sqlite' }), 'string');
        throws(() => toExcel('x ∈ \\text{valueOf}'), /No spreadsheet formula/);
        eq(toPython('lim(1/x, x, 0, toString)', { sympy: true }), 'sympy.limit(1 / x, x, 0)');
        for (const f of ['valueOf(1)', 'toString(1)', '\\text{isPrototypeOf}(1)']) throws(() => calculate(f), /no function/);
        const slots = preparePythonTemplate('# mathzetta: toString(x) = x + 1\nprint(toString(2))\n').slots;
        eq(slots.map((s) => [s.name, s.error]), [['toString', null]]);
    });
    test('a column name inside a string stays the string', () => {
        const f = strToFunction(['team', 'name'], 'team = "name"');
        eq(f.jsFunction, 'c0 == "name"');
        eq(createRowEvaluator(f.jsFunction)(['name', 'x']), true);
        eq(strToSQL(['team', 'name'], 'team = "name"').sqlExpression, '"team" = \'name\'');
        eq(strToFunction(['x'], "f'(x) + x").success, true);   // a prime is no quote
    });
    test('an unknown name spelt like a slot (c1) is not read as a column', () => {
        const g = strToFunction(['a', 'b'], 'c1 + 1');
        eq(g.types[0], 'unknown');
        eq(String(createRowEvaluator(g.jsFunction)([10, 20])).startsWith('Error: not allowed'), true);
    });
    test('strToExcel reports names that are no column (the caller decides); f(…) only if listed', () => {
        eq(strToExcel(['Value'], 'Value + other').unknownStrings, ['other']);
        eq(strToExcel(['Value'], 'f(Value)').success, false);
        eq(strToExcel(['Value'], 'f(Value)', undefined, { functions: ['f'] }).excelFormula(() => 'B2'), '=f(B2)');
        eq(strToExcel(['Value'], 'Value * 2 + pi').excelFormula(() => 'B2'), '=B2*2+PI()');
    });
    test('zero-argument operators from a postfix array are refused when read, not crashed on later', () => {
        for (const op of ['max', 'gcd', 'int', 'lim', '\\sumidx', 'pmatrix', 'vmatrix']) throws(() => toLaTeX(['0', op]), /needs at least one argument/);
        eq(toLaTeX(['0', '{}']), '\\{\\}');   // the empty set is a group
    });
    test('evaluate refuses the wrong kind of argument by name, not with a TypeError', () => {
        for (const f of ['det(5)', 'trace(2)', 'inv(2)', 'transpose(3)', 'rank(1)', 'dot(1, 2)', 'linsolve(1, 2)']) throws(() => evaluate(f), /needs (a matrix|two lists|a matrix and a list)/);
        throws(() => evaluate('fixed(1, 200)'), /0 to 100 decimals/);
    });
});

suite('untrusted: work and size', () => {
    test('identity(n) in evaluate takes 1 to 100, as calculate does (identity(60000) ran out of memory)', () => {
        throws(() => evaluate('identity(60000)'), /from 1 to 100/);
        throws(() => evaluate('identity(2.5)'), /from 1 to 100/);
        eq(evaluate('identity(2)'), [[1, 0], [0, 1]]);
    });
    test("generated JavaScript's factorial, perm and comb stop where a double reaches ∞", () => {
        const row = (f, values) => createRowEvaluator(strToFunction(['a', 'b'], f).jsFunction)(values);
        quick(() => eq(row('a!', [99999999999999, 0]), Infinity), 200);
        quick(() => eq(row('comb(a, b)', [400000000, 200000000]), Infinity), 200);
        quick(() => eq(row('perm(a, b)', [300000000, 299999999]), Infinity), 200);
        eq(row('comb(a, b)', [52, 5]), 2598960);
        eq(Number.isNaN(row('comb(a, b)', [2, 5])), true, 'as evaluate: NaN off the domain');
    });
    test('calculate charges big-number work to its budget: ∑ 1/i to 8000 stops within about a second', () => {
        quick(() => throws(() => calculate('\\sum_{i=1}^{8000} 1/i'), /too much to work out/), 2500);
        eq(calculate('\\sum_{i=1}^{1000} 1/i').text, '7.48547086055');
        quick(() => throws(() => calculate('\\sum_{i=1}^{50} 20000!/20000!'), /too much to work out/));
        // trial division for √ of numbers below 10^24 is charged too: 40 of them stay inside the budget, and the time
        quick(() => eq(calculate('\\sum_{i=1}^{40} sqrt(999999999999999999999000+i)').text, '40000000000000'), 1500);
    });
    test('perm and comb refuse an exact answer past the size limit before multiplying', () => {
        quick(() => throws(() => calculate('comb(10^1000, 100000)'), /too large/), 200);
        quick(() => throws(() => calculate('perm(200000, 100000)'), /too large/), 200);
        eq(calculate('comb(52, 5)').text, '2598960');
    });
    test('decimal places are bounded: round(1/3, 10^9) and {{~999999999 1/3}} took 9 s', () => {
        quick(() => throws(() => calculate('round(1/3, 10^9)'), /too many decimal places/), 200);
        quick(() => eq(calculateBlock('~999999999 1/3').includes('1/3'), true), 200);
        throws(() => calculate('1/3', {}, { places: 1e9 }), /places is a whole number/);
        eq(calculateBlock('~3 1/3'), '0.333');
    });
});

suite('formulas: choices for unknown names', () => {
    test("strToFunction's third argument makes a word a column, a number or a string", () => {
        const choose = (type, value) => new Map([['rate', { type, value }]]);
        const run = (map, row) => createRowEvaluator(strToFunction(['price', 'tax'], 'price * rate', map).jsFunction)(row);
        eq(run(choose('column', 'tax'), [10, 0.5]), 5);
        eq(run(choose('integer', '3'), [10, 0]), 30);
        eq(run(choose('float', '0.25'), [10, 0]), 2.5);
        eq(strToFunction(['price'], 'price * rate', choose('column', 'nothing')).types, ['column', 'unknown', 'operator']);
        eq(strToFunction(['price'], 'price * rate').unknownStrings, ['rate']);
    });
});

suite('formulas: LaTeX over columns', () => {
    test("a column's placeholder stays whole in LaTeX, where letters side by side are a product", () => {
        const run = (f) => createRowEvaluator(strToFunction(['x', 'Value', 'Count'], f).jsFunction)([4, 50, 200]);
        eq(strToFunction(['x'], '\\sqrt{x}+x').jsFunction, 'Math.sqrt(c0) + c0');
        eq(run('\\sqrt{x}+x'), 6);
        eq(run('\\frac{Value}{Count} \\cdot 100'), 25);
    });
});
