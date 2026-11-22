/**
 * Input is untrusted (typed into pages, stored in embeds, carried in links): the code checkers (checkGeneratedJs,
 * checkGeneratedPython), escaping in every output, lookup tables with no prototype, and the limits — nothing runs
 * for long or grows without bound. Each test fails if its fix is undone.
 */
import { suite, test, eq, throws, show } from '../harness.js';
import {
    UnsafeCodeError, calculate, calculateBlock, checkGeneratedJs, checkGeneratedPython, createRowEvaluator, evaluate,
    filterShader, fromPostfix, isSafeGeneratedJs, parse, parseTree, preparePythonTemplate, strToExcel,
    strToFunction, strToSQL, toExcel, toGLSL, toJavaScript, toLaTeX, toMathML, toPython, toPythonFunction, toSQL,
    toText,
} from '../../src/all.js';
import { quick } from '../helpers.js';

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
});

const H = ['HR', 'team'];

const run = (formula, row = [5, 'NYA']) => createRowEvaluator(strToFunction(H, formula).jsFunction)(row);

const refused = (v) => typeof v === 'string' && v.startsWith('Error: not allowed');

suite('untrusted: generated formula code and its gate', () => {
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
        const ok = (c, options = {}) => isSafeGeneratedJs(c, { variables: /^c\d+$/, ...options });
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

suite('untrusted: formulas', () => {
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

suite('untrusted: escaping and lookups', () => {
    test("a string's text is escaped in LaTeX: it can't close \\text{} or start a command", () => {
        eq(toLaTeX('x = "}\\href{https://e.example}{c"'), 'x = \\text{"\\}\\textbackslash{}href\\{https://e.example\\}\\{c"}');
        eq(toLaTeX('"50%"'), '\\text{"50\\%"}');
        eq(toLaTeX(['x', '1', '\\:a%b']), '\\operatorname{a\\%b}\\left(x\\right)');
    });
    test('a name from a postfix array that is no name in the language is refused in JavaScript and Python, never pasted', () => {
        for (const input of [['x', '1', '\\:a);b('], ['a);b('], ['x', '1', '\\:f(1)+g'], ['.'], ['x y'], ['1.2.3']]) {
            for (const write of [toJavaScript, toPython, (t) => toPython(t, { numpy: true }), (t) => toPython(t, { sympy: true })]) {
                throws(() => write(input), /not a name in/);
            }
        }
        eq(toJavaScript(['x', '1', '\\:f′']), 'f_prime(x)');   // names that are names still work
        eq(toPython(['θ', 'x_1', '+']), 'θ + x_1');
        eq(toPython(['lambda']), 'lambda_');
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
    test('§ inside a quoted string is text; outside, it is still refused', () => {
        eq(parse('name = "§3"'), ['name', '"§3"', '=']);
        eq(strToFunction(['name'], 'name = "§ 2"').jsFunction, 'c0 == "§ 2"');
        throws(() => parse('a § b'));
        throws(() => parse('a  b'));
    });
});

suite('untrusted: names like constructor and toString find nothing (lookup tables have no prototype)', () => {
    const P = (s) => parse(s, { blocks: null }).join(' ');
    test('names like constructor reach no lookup table: the postfix is all strings', () => {
        for (const s of ['lim(f, x, a^constructor)', 'lim_{x→a^{valueOf}} f', 'np.constructor', "(typeof(x) IN ('a', 'b') AND constructor)"]) {
            let postfix;
            // refusing is fine too, by name; a TypeError (a lookup that found Object.prototype) is the bug
            try { postfix = parse(s); } catch (e) {
                if (e instanceof TypeError || !/^Failed to parse expression/.test(e.message)) throw e;
                continue;
            }
            eq(Array.isArray(postfix) && postfix.every((t) => typeof t === 'string' && !t.includes('native code') && t !== '[object Object]'), true, `${s} → ${JSON.stringify(postfix)}`);
        }
        eq(P('lim(f, x, a^constructor)'), 'f x a constructor ^ 3 lim');
    });
    test('names like toString find nothing in the outputs\' tables', () => {
        for (const name of ['toString', 'valueOf', 'constructor']) {
            const sql = toSQL(`x ∈ \\text{${name}}`, { dialect: 'sqlite' });
            eq(sql, `(x IN (${name})) IS TRUE`, 'the name as written, not what Object.prototype has under it');
            eq(/function|native code/.test(sql), false, sql);
        }
        throws(() => toExcel('x ∈ \\text{valueOf}'), /No spreadsheet formula/);
        eq(toPython('lim(1/x, x, 0, toString)', { sympy: true }), 'sympy.limit(1 / x, x, 0)');
        for (const f of ['valueOf(1)', 'toString(1)', '\\text{isPrototypeOf}(1)']) throws(() => calculate(f), /no function/);
        const slots = preparePythonTemplate('# mathzetta: toString(x) = x + 1\nprint(toString(2))\n').slots;
        eq(slots.map((s) => [s.name, s.error]), [['toString', null]]);
    });
    test("Object's own names (constructor, toString, __proto__) are ordinary names everywhere", () => {
        for (const n of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
            const tree = { type: 'symbol', value: n };   // text, a postfix array and a tree alike
            for (const out of [toLaTeX([n]), toMathML([n]), toText([n]), toJavaScript([n]), toSQL([n]), toLaTeX(tree), toJavaScript(tree), toSQL(tree),
                ...(n.startsWith('__') ? [] : [toLaTeX(`\\text{${n}} + 1`), toJavaScript(`\\text{${n}} + 1`), toSQL(`\\text{${n}} + 1`)])]) {
                eq(/native code|function /.test(out), false, `${n}: ${out}`);
            }
        }
        eq(toJavaScript('\\text{toString} + 1'), 'toString + 1');
    });
});

suite('limits: work and size in evaluate, calculate and generated code', () => {
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
    });
});

suite('limits: work, size and depth', () => {
    test('perm and comb stop once the answer is ∞', () => {
        quick(() => eq(evaluate('perm(100000000000, 100000000000)'), Infinity), 200);
        quick(() => eq(evaluate('comb(100000000000, 50000000000)'), Infinity), 200);
        eq(evaluate('comb(52, 5)'), 2598960);
        eq(evaluate('comb(1000, 999)'), 1000);
    });
    test('sums of sums run out of steps instead of running for ever', () => {
        throws(() => evaluate('\\sum_{i=1}^{100000} \\sum_{j=1}^{100000} 1'), /Too much to work out/);
        throws(() => calculate('\\sum_{i=1}^{\\infty} \\sum_{j=1}^{\\infty} 1/(i^2 j^2)'), /too much to work out/);
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
        quick(() => throws(() => toJavaScript('x between 1 and '.repeat(40) + '2'), /too long/), 2000);
        quick(() => throws(() => parse('trunc('.repeat(30) + 'x' + ')'.repeat(30)), /expands too much/), 2000);
    });
    test('a filter pass has at most 24 neighborhood calls (the GPU watchdog)', () => {
        const parse = (t) => parseTree(t);
        eq(typeof filterShader('gaussian(8) * '.repeat(24) + '1', { parse }), 'string');
        throws(() => filterShader('gaussian(8) * '.repeat(25) + '1', { parse }), /At most 24 neighborhood/);
    });
    test("English operands don't backtrack across a long word", () => {
        quick(() => parse('x is within ' + 'a'.repeat(4900) + ' of 2'), 500);
    });
});

suite('limits: reading, writing and calculating stop in time', () => {
    /**
     * Runs once and checks the time. With `refusal` (a RegExp for the message), it must be refused with it;
     * without, it must answer (any other error, a TypeError above all, is a failure). Returns the answer.
     */
    const within = (ms, run, refusal) => {
        const t = Date.now();
        let answer, error;
        try { answer = run(); } catch (e) { error = e; }
        const took = Date.now() - t;
        eq(took < ms, true, `took ${took} ms`);
        if (refusal) {
            if (!error) throw new Error(`expected a refusal matching ${refusal}, got ${show(answer)}`);
            if (!refusal.test(error.message)) throw new Error(`refused with "${error.message}", expected ${refusal}`);
        } else if (error) {
            throw error;
        }
        return answer;
    };
    test('log(a, b with no closing bracket is refused, not doubled until memory runs out', () => {
        within(300, () => parse('3+log(8,2'), /^Failed to parse expression/);
        within(300, () => parse('log(x,log(x,'), /^Failed to parse expression .*operand/);
        eq(parse('log(8,2)+1'), ['2', '8', 'log', '1', '+']);
    });
    test('a definition of a conditional inside another is read once (was twice per level: 24 deep, 9 s)', () => {
        let nested = 'x';
        for (let i = 0; i < 40; i++) nested = `a=(${nested})<2?3:4`;
        eq(Array.isArray(within(300, () => parse(nested))), true);
        eq(parse('f(x) = x < 0 ? x^2 : 2x').join(' '), 'x 1 \\:f x 0 < x 2 ^ 2 x * ?: =');
        eq(parse('x = 1 ? a : b').join(' '), 'x 1 = a b ?:');
    });
    test('(lambda x: x+x+…)(…) nested stops at 100k characters', () => {
        let nested = 'y';
        for (let i = 0; i < 6; i++) nested = `(lambda x: ${Array(40).fill('x').join('+')})(${nested})`;
        within(500, () => parse(nested), /expands too much/);
        eq(parse('(lambda v: v*v)(x+1)').join(' '), 'x 1 + x 1 + *');
    });
    test('a block handler that answers with a block is not asked again for ever', () => {
        eq(Array.isArray(within(300, () => parse('{{1}}', { blocks: () => '{{1}}' }))), true);
        eq(parse('2{{1+1}} + {{3}}{{4}}').join(' '), '2 2 * 3 4 * +');
    });
    test('every output writes a node once: chains that fell back to a second rule doubled at each level', () => {
        const runs = [
            () => toPython('x' + '/y'.repeat(40), { sympy: true }),
            () => toJavaScript('x' + ' mod y'.repeat(40)),
            () => toExcel('ceil('.repeat(40) + 'x' + ')'.repeat(40)),
            () => toSQL('x' + ' mod y'.repeat(40)),
            () => toPython('if x>0 then '.repeat(30) + '1' + ' else 0'.repeat(30), { numpy: true }),
        ];
        for (const run of runs) {
            const code = within(500, run);
            eq(typeof code === 'string' && code.length > 40 && code.length < 5000, true, `${run}: ${show(code).slice(0, 80)}`);
        }
    });
    test('calculate charges factorials, perm, comb and matrix products to its budget', () => {
        within(3000, () => calculate('\\sum_{i=1}^{1000} 0*20000!'), /too much to work out/);
        throws(() => calculate('\\sum_{i=1}^{3000} 0*comb(100000, 11000)'), /too much to work out/);
        throws(() => calculate('identity(100)^(2^300)'), /too much to work out/);
        // the block's calculator gives up, so the block is read as the sum it holds
        eq(within(3000, () => parse('{{\\sum_{i=1}^{300} 0*20000!}}')), parse('\\sum_{i=1}^{300} 0*20000!'));
        within(3000, () => evaluate('identity(100)^(2^1000)'), /Too much to work out/);
        eq(calculate('[[1,2],[3,4]]^10').value, [[4783807, 6972050], [10458075, 15241882]]);
        eq(evaluate('[[1,2],[3,4]]^10'), [[4783807, 6972050], [10458075, 15241882]]);
        eq(calculate('\\sum_{i=1}^{100} i!').exact, true);
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
});

suite('limits: reading inputs that were slow', () => {
    /** Answered or refused by name (too deep, a missing operand…) within the time; a crash (TypeError, RangeError) fails. */
    const reads = (s, ms = 300, options) => {
        const t = Date.now();
        try {
            eq(Array.isArray(parse(s, options)), true, 'a postfix array');
        } catch (e) {
            if (!/^Failed to parse expression/.test(e.message)) throw e;
        }
        eq(Date.now() - t < ms, true, `${JSON.stringify(s.slice(0, 20))}… took ${Date.now() - t} ms`);
    };
    test('(mod followed by spaces (was cubic: 39 s)', () => reads('(mod ' + ' '.repeat(4990)));
    test('a chain of % (was cubic: 22 s)', () => { reads('1%'.repeat(2400) + '1'); reads('x%'.repeat(2400) + 'x'); });
    test('∫∫∫… is refused past 100 integrals (each one re-read the rest)', () => {
        throws(() => parse('∫'.repeat(101) + 'x'), /More than 100 integrals/);
        reads('∫'.repeat(2000));
    });
    test('many strings, cells or names (restoring them was quadratic)', () => {
        reads('=' + 'A1+'.repeat(1600) + '1');
        reads('"a"+'.repeat(1200) + '1');
        reads('ab+'.repeat(1200) + '1', 300, { names: ['ab'] });   // too deep is fine
    });
});
