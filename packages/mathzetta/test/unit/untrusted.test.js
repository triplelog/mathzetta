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

// The review before 1.2 (2026-11-19): each test fails if its fix is undone.
suite('review before 1.2: outputs', () => {
    test('one value is its own max or min, kept in brackets (it was a + b * 2)', () => {
        eq(toPython('max(a + b) * 2'), '(a + b) * 2');
        eq(toPython('min(not (x > 1)) + 1'), '(not (x > 1)) + 1');
        eq(toSQL('max(a + b) * 2', { dialect: 'sqlite' }), '(a + b) * 2');
        eq(toExcel('2 - max(a - b)'), '=2-(a-b)');
        eq(toGLSL('max(a + b) * 2'), '(a + b) * 2.0');
    });
    test('round, odd roots and mod write an expression once: nesting grows the output linearly', () => {
        for (const fn of ['round(X)+1', 'round(X, 2)+1', 'root(5, X)+1', 'x mod (X)']) {
            let s = 'x+1';
            for (let i = 0; i < 12; i++) s = fn.replace('X', s);
            for (const write of [toJavaScript, toPython, (t) => toPython(t, { numpy: true }), (t) => toPython(t, { sympy: true })]) {
                const code = write(s);
                eq(code.length < 5000, true, `${fn}: ${code.length} characters`);
            }
        }
        // and each reads back with the same value (two deep: reading a lambda back writes its argument out again, and the
        // reader gives up on conditionals nested past a few thousand characters)
        for (const fn of ['round(X)+1', 'round(X, 2)+1', 'root(5, X)+1', 'x mod (X)']) {
            let s = 'x+1';
            for (let i = 0; i < 2; i++) s = fn.replace('X', s);
            for (const x of [-1.7, 2.35]) {
                const want = evaluate(s, { x });
                for (const write of [toJavaScript, toPython, (t) => toPython(t, { numpy: true }), (t) => toPython(t, { sympy: true })]) {
                    const code = write(s);
                    eq(Math.abs(evaluate(code, { x }) - want) < 1e-9, true, `${code} at x = ${x}`);
                }
            }
        }
    });
    test('a call is never repeated: x mod random() draws one number', () => {
        eq(toJavaScript('x mod random()').split('Math.random()').length, 2);
        eq(createRowEvaluator(strToFunction(['x'], 'x mod (x + 1)').jsFunction)([5]), 5);
    });
    test('a number in a set operation is a set of one in Python and SymPy', () => {
        eq(toPython('{1,2} ∪ 3'), 'sorted(set({1, 2}) | set([3]))');
        eq(toPython('{1,2} ∪ 3', { sympy: true }), 'sympy.Union(sympy.FiniteSet(1, 2), sympy.FiniteSet(3))');
    });
});

suite('review before 1.2: reading and calculating', () => {
    test('§ inside a quoted string is text; outside, it is still refused', () => {
        eq(parse('name = "§3"'), ['name', '"§3"', '=']);
        eq(strToFunction(['name'], 'name = "§ 2"').jsFunction, 'c0 == "§ 2"');
        throws(() => parse('a § b'));
        throws(() => parse('a  b'));
    });
    test('a percentage is a number in formulas, as toSQL writes it', () => {
        eq(strToSQL(['a'], '50% * a', new Map()).sqlExpression, '0.5 * "a"');
        eq(strToExcel(['a'], '50% * a').unknownStrings, []);
    });
    test('a numeric integral shows the digits its error leaves (not 2.49999985339)', () => {
        eq(calculate('int(abs(x), x, -1, 2)').text, '2.5');
        eq(calculate('int(abs(x-0.3), x, 0, 1)').text, '0.29');
    });
    test('a tiny negative fraction is a tiny negative double (>> rounds a negative BigInt down)', () => {
        eq(calculate("-1/10^400").value === 0, true);   // -0: it was -1.09e-301
        eq(calculate('-1/10^400').text, '-1*10^(-400)');
        eq(Math.abs(calculate('-(2^2000)/3^1000').value / -8.68433580377441e124 - 1) < 1e-12, true);
    });
});

suite('review before 1.2, second pass: nothing runs for long', () => {
    const within = (ms, run) => {
        const t = Date.now();
        try { run(); } catch { /* refusing is fine */ }
        eq(Date.now() - t < ms, true, `took ${Date.now() - t} ms`);
    };
    test('log(a, b with no closing bracket is refused, not doubled until memory runs out', () => {
        within(300, () => parse('3+log(8,2'));
        within(300, () => parse('log(x,log(x,'));
        throws(() => parse('log(x,log(x,'));
        eq(parse('log(8,2)+1'), ['2', '8', 'log', '1', '+']);
    });
    test('a definition of a conditional inside another is read once (was twice per level: 24 deep, 9 s)', () => {
        let nested = 'x';
        for (let i = 0; i < 40; i++) nested = `a=(${nested})<2?3:4`;
        within(300, () => parse(nested));
        eq(parse('f(x) = x < 0 ? x^2 : 2x').join(' '), 'x 1 \\:f x 0 < x 2 ^ 2 x * ?: =');
        eq(parse('x = 1 ? a : b').join(' '), 'x 1 = a b ?:');
    });
    test('(lambda x: x+x+…)(…) nested stops at 100k characters', () => {
        let nested = 'y';
        for (let i = 0; i < 6; i++) nested = `(lambda x: ${Array(40).fill('x').join('+')})(${nested})`;
        within(500, () => parse(nested));
        eq(parse('(lambda v: v*v)(x+1)').join(' '), 'x 1 + x 1 + *');
    });
    test('a block handler that answers with a block is not asked again for ever', () => {
        within(300, () => parse('{{1}}', { blocks: () => '{{1}}' }));
        eq(parse('2{{1+1}} + {{3}}{{4}}').join(' '), '2 2 * 3 4 * +');
    });
    test('every output writes a node once: chains that fell back to a second rule doubled at each level', () => {
        within(500, () => toPython('x' + '/y'.repeat(40), { sympy: true }));
        within(500, () => toJavaScript('x' + ' mod y'.repeat(40)));
        within(500, () => toExcel('ceil('.repeat(40) + 'x' + ')'.repeat(40)));
        within(500, () => toSQL('x' + ' mod y'.repeat(40)));
        within(500, () => toPython('if x>0 then '.repeat(30) + '1' + ' else 0'.repeat(30), { numpy: true }));
    });
    test('calculate charges factorials, perm, comb and matrix products to its budget', () => {
        within(3000, () => calculate('\\sum_{i=1}^{1000} 0*20000!'));
        throws(() => calculate('\\sum_{i=1}^{1000} 0*20000!'), /too much to work out/);
        throws(() => calculate('\\sum_{i=1}^{3000} 0*comb(100000, 11000)'), /too much to work out/);
        throws(() => calculate('identity(100)^(2^300)'), /too much to work out/);
        within(3000, () => parse('{{\\sum_{i=1}^{300} 0*20000!}}'));
        within(3000, () => evaluate('identity(100)^(2^1000)'));
        throws(() => evaluate('identity(100)^(2^1000)'), /Too much to work out/);
        eq(calculate('comb(52,5)').text, '2598960');
        eq(calculate('[[1,2],[3,4]]^10').value, [[4783807, 6972050], [10458075, 15241882]]);
        eq(evaluate('[[1,2],[3,4]]^10'), [[4783807, 6972050], [10458075, 15241882]]);
        eq(calculate('\\sum_{i=1}^{100} i!').exact, true);
    });
});

suite('review before 1.2, second pass: the checkers and the outputs', () => {
    test('checked formula JavaScript has no assignment, and no code assigns to a member', () => {
        for (const code of ['Math.abs = Math.sqrt', 'Math.max = () => 42', 'c0 = [1], c0 = [...c0, ...c0]', 'c0++', 'c0 += 1']) {
            eq(String(createRowEvaluator(code)([1])).startsWith('Error: not allowed'), true, code);
        }
        eq(Math.abs(-4), 4);
        eq(createRowEvaluator('c0 == 1 ? 2 : 3')([1]), 2);
        eq(createRowEvaluator('c0 >= 1 && c0 <= 2 && c0 === 1')([1]), true);
        eq(isSafeGeneratedJs('let $a = 1; $a += 2; $O[0] = $a; $a++', { variables: /^\$\w+$/, indexable: /^\$[A-Z]/ }), true);   // statements, where allowed
        eq(isSafeGeneratedJs('let $a = 1; Math.abs = $a', { variables: /^\$\w+$/ }), false);
    });
    test('checked Python: SymPy code has no text (sympify runs it), sympy.S is only its sets, a bound name is no built-in', () => {
        throws(() => checkGeneratedPython('sympy.S("lambdify((), 1)()")'));
        throws(() => checkGeneratedPython('sympy.S(1)'), /sympy\.S/);
        throws(() => checkGeneratedPython('sympy.sqrt("open(1)")'), /string/);
        throws(() => checkGeneratedPython('(lambda exit: 0)(0) + scipy.integrate.quad(exit, 0, 1)[0]'), /bound name/);
        eq(checkGeneratedPython('sympy.S.Reals'), 'sympy.S.Reals');
        eq(checkGeneratedPython('sympy.limit(x, x, 0, "+")', { variables: ['x'] }), 'sympy.limit(x, x, 0, "+")');
        for (const formula of ['\\sum_{i=1}^3 i^2', 'round(x/3, 2)', 'fixed(x, 2)', 'x \\in \\mathbb{R}']) {
            for (const options of [{}, { numpy: true }, { sympy: true }]) toPythonFunction(formula, options);   // what the renderer writes still passes
        }
    });
    test('GLSL has no text: a quoted string is refused, not written into the shader', () => {
        throws(() => toGLSL('"abc" + x'), /No GLSL for text/);
        throws(() => toGLSL("'\n#pragma x\n'"), /No GLSL for text/);
    });
    test('x (mod n) with no congruence is x mod n in code too: the divisor\'s sign', () => {
        eq(evaluate('-7 (mod 8)'), 1);
        eq(createRowEvaluator(toJavaScript('-7 (mod 8)'))([]), 1);
        eq(toSQL('x (mod 3)'), toSQL('x mod 3'));
        eq(toSQL('a ≡ b (mod 3)'), 'MOD((a) - (b), 3) = 0');
    });
    test('PostgreSQL: a mean of whole numbers is not a whole-number division', () => {
        eq(toSQL('mean(1,2)'), '((1 + 2) / 2.0)');
    });
    test('2^-3^2: the minus takes the power, as 2^-x^2 does', () => {
        eq(parse('2^-3^2').join(' '), '2 3 2 ^ neg ^');
        eq(evaluate('2^-3^2'), 2 ** -9);
        eq(parse('e^-2^x').join(' '), 'e 2 x ^ neg ^');
        eq(parse('2^-3').join(' '), '2 -3 ^');
        eq(parse('x^-1/2').join(' '), 'x -1 ^ 2 /');
    });
    test('strToFunction answers { success: false } for what JavaScript cannot write', () => {
        const out = strToFunction(['Value'], 'lim(Value, Value, 0)');
        eq(out.success, false);
        eq(typeof out.error, 'string');
    });
});
