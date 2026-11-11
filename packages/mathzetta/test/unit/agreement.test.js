/**
 * Every output means the same thing: evaluate(), calculate(), the generated JavaScript (run) and SQLite's SQL
 * (run, where node:sqlite is there) agree on a value — with negative numbers and halves, which the tables
 * never had (mod takes the divisor's sign, round takes a half away from zero, trunc goes toward zero, an odd
 * root of a negative number is real). python.test.js runs the Python. Then the brackets and readings the
 * 2026-11 review found wrong in single formats.
 */
import { suite, test, eq, throws } from '../harness.js';
import {
    parse, evaluate, calculate, toLaTeX, toMathML, toText, toSpeech, toAudioSpeech, toJavaScript, toPython, toSQL, toExcel,
    toGLSL, strToFunction, createRowEvaluator,
} from '../../src/all.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node before 22.5: the SQLite column is not checked */ }
const db = DatabaseSync ? new DatabaseSync(':memory:') : null;

const close = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) : a === b);
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
    for (const [input, want] of VALUES) {
        test(input, () => {
            eq(close(evaluate(input), want), true, `evaluate ${evaluate(input)}`);
            eq(close(Number(calculate(input).value), want), true, `calculate ${calculate(input).text}`);
            eq(close(runJs(input), want), true, `JavaScript ${toJavaScript(input)} → ${runJs(input)}`);
            if (db && !/^max\(3\)$/.test(input)) eq(close(Number(runSqlite(input)), want), true, `SQLite ${toSQL(input, { dialect: 'sqlite' })} → ${runSqlite(input)}`);
        });
    }
    test('xor is a true or false in JavaScript, not one of its operands', () => {
        eq(runJs('floor(ln(-1) xor -2)'), evaluate('floor(ln(-1) xor -2)'));
        eq(runJs('0 xor -2'), true);
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
    test('the same in the code that is only written (Excel, GLSL, PostgreSQL)', () => {
        eq(toExcel('-1*x^2'), '=-(x^2)');                    // Excel's minus binds tighter than ^
        eq(toExcel('sum(a, b) * c'), '=(a+b)*c');
        eq(toExcel('2*(a ≈ b)'), '=2*(ABS((a)-(b))<1E-9)');
        eq(toExcel('c = (a < b)'), '=c=(a<b)');               // spreadsheet comparisons share one precedence
        eq(toExcel('cbrt(x)'), '=IF(x<0, -POWER(-x, 1/3), POWER(x, 1/3))');
        eq(toExcel('50% * x'), '=50%*x');
        eq(toGLSL('round(a + b, 2)'), 'mz_round((a + b) * 100.0) / 100.0');
        eq(toGLSL('(a+b)^1*c'), '(a + b) * c');
        eq(toGLSL('a ≈ b - c'), '(abs(a - (b - c)) < 1e-5)');
        eq(toGLSL('round(x, 25)'), 'mz_round(x * 1.0e25) / 1.0e25');
        eq(toSQL('x mod 3'), 'MOD(MOD(x, 3) + 3, 3)');
        eq(toSQL('round(x, 2)'), 'ROUND(CAST(x AS NUMERIC), 2)');   // PostgreSQL's ROUND(x, d) takes NUMERIC only
        eq(toSQL('cbrt(x)'), 'CBRT(x)');
        eq(toSQL('1/2'), '1.0 / 2');                                  // not integer division
        eq(toSQL('name = "Bob"'), "name = 'Bob'");                    // "Bob" would be a column
        eq(toSQL('tau * x > -∞'), "(2 * PI()) * x > '-Infinity'");
        eq(toSQL(['user', 'current_user', '+']), '"user" + "current_user"');
        eq(toSQL('c = (a < b)'), 'c = (a < b)');
    });
});

suite('agreement: brackets every format keeps', () => {
    test('-1·(a + b) is -(a + b) everywhere', () => {
        const pf = ['-1', 'a', 'b', '+', '*'];
        eq(toLaTeX(pf), '-\\left(a + b\\right)');
        eq(toText(pf), '-(a + b)');
        eq(toJavaScript(pf), '-(a + b)');
        eq(toPython(pf), '-(a + b)');
        eq(toSQL(pf), '-(a + b)');
        eq(toExcel(pf), '=-(a+b)');
        eq(toGLSL(pf), '-(a + b)');
        eq(toMathML(pf).includes('<mo>(</mo>'), true);
        eq(toLaTeX(['c', '-1', 'a', 'b', '+', '*', '+']), 'c - \\left(a + b\\right)');
        eq(toLaTeX(['-1', 'x', '*', '!']), '\\left(-x\\right)!');
    });
    test("LaTeX's wrap hook keeps its own backslashes (a - (-1·x) was sliced)", () => {
        eq(toLaTeX('a - (-1*x)', { wrap: (n, s) => `\\htmlId{mz-${n.id}}{${s}}` }), '\\htmlId{mz-4}{\\htmlId{mz-0}{a} + \\htmlId{mz-2}{x}}');
    });
    test('prod(a + b, c) and sum terms are bracketed in the drawn formats', () => {
        const pf = ['a', 'b', '+', 'c', '2', 'prod'];
        eq(toLaTeX(pf), '\\left(a + b\\right) \\cdot c');
        eq(toText(pf), '(a + b) * c');
    });
    test('Python: max of one number, not with its looser binding, ≈ with an absolute tolerance', () => {
        eq(toPython('max(x)'), 'x');
        eq(toPython('!a + 1'), '(not a) + 1');
        eq(toPython('!a = b'), '(not a) == b');
        eq(toSQL('!a + 1'), '(NOT a) + 1');
        eq(toPython('x ≈ 0'), 'abs((x) - (0)) < 1e-9');
        eq(toJavaScript('mean(c, c = -1, x)'), '((c + (c == -1) + x) / 3)');
    });
    test('a derivative by a compound variable is drawn once, not for ever', () => {
        for (const write of [toLaTeX, toText, toSpeech, toMathML]) eq(typeof write('der(x^2, x+1)'), 'string', write.name);
    });
    test('text writes limits, definite integrals and sums as calls that read back', () => {
        for (const input of ['\\lim_{x\\to 3}(2x+1)', '\\lim_{x\\to 0^+} f', '\\int_0^1 x^2 dx', 'int(t^5,t,0)<=0']) {
            eq(parse(toText(input)), parse(input), `${input} → ${toText(input)}`);
        }
        eq(evaluate(parse(toText('\\sum_0^3 i^2'))), 14);   // written with its index: sum(i^2, i = 0, 3)
        eq(toText('\\lim_{x\\to 3}(2x+1)'), 'lim(2 * x + 1, x → 3)');
    });
});

suite('agreement: speech alone keeps apart what the drawing keeps apart', () => {
    const PAIRS = [
        ['-x^2', '(-x)^2'], ['e^{-x^2}', 'e^{(-x)^2}'], ['\\frac{a}{bc}', '\\frac{a}{b}c'], ['a/(b/c)', 'a/b/c'],
        ['2^{x}y', '2^{xy}'], ['-3!', '(-3)!'], ['2x!', '(2x)!'], ['x_1^2', 'x_{1^2}'], ['\\max(1,2)+3', '\\max(1,2+3)'],
        ['\\lim_{x\\to 0} \\frac{\\sin x}{x}', '\\frac{\\lim_{x\\to 0} \\sin x}{x}'], ['x>0 ? 1 : -1+2', '(x>0 ? 1 : -1)+2'],
        [['-1', 'a', 'b', '+', '*'], ['-1', 'a', '*', 'b', '+']],
    ];
    for (const [a, b] of PAIRS) test(`${a} and ${b}`, () => eq(toAudioSpeech(a) === toAudioSpeech(b), false, `both read "${toAudioSpeech(a)}"`));
    test('"to the the quantity": an exponent that opens a quantity takes "to the power of"', () => {
        eq(toSpeech('2^-2^2'), '2 to the power of the quantity negative 2, squared');
    });
});

suite('agreement: calculate — exact answers that were wrong', () => {
    const text = (s) => calculate(s).text;
    test('exact values are compared to every digit: e^-30 is not 0', () => {
        eq(text('e^(-30) > 0'), 'true');
        eq(text('10^(-13)*pi = 0'), 'false');
        eq(text('sqrt(2)/10^13 > 0'), 'true');
        eq(text('0.1+0.2 = 0.3'), 'true');
        eq(text('sin(1)^2+cos(1)^2 = 1'), 'true');
    });
    test('congruence and membership are exact', () => {
        eq(text('2^100 ≡ 1 (mod 3)'), 'true');
        eq(text('10^20 ≡ 1 (mod 3)'), 'true');
        eq(text('10^20+1 ∈ {10^20}'), 'false');
        eq(text('0.1+0.2 ∈ {0.3}'), 'true');
        eq(text('pi ∈ ℚ'), 'false');
        eq(text('-2 ∈ ℤ'), 'true');
    });
    test('series: terms that do not shrink diverge; a slow one gets no verdict', () => {
        throws(() => calculate('\\sum_{n=1}^{\\infty} (-1)^n'), /diverges/);
        throws(() => calculate('\\sum_{n=1}^{\\infty} sin(n)'), /diverges/);
        throws(() => calculate('\\sum_{n=1}^{\\infty} 1/n^1.01'), /too slowly to tell/);
        eq(text('\\sum_{n=1}^{\\infty} 1/n^2'), 'pi^2/6');
    });
    test('a limit that oscillates has none (two sequences of points must agree)', () => {
        for (const f of ['sin(x)', 'cos(x)', 'x sin(x)', '(-1)^{floor(x)}']) throws(() => calculate(`\\lim_{x\\to\\infty} ${f}`), /limit/);
        eq(text('\\lim_{x\\to\\infty} sin(x)/x'), '0');
        eq(text('\\lim_{x\\to 0^+} sqrt(x)'), '0');
        eq(text('\\lim_{x\\to 0^+} x^(1/3)'), '0');
    });
    test('integrals over a kink or many waves, and tiny ones', () => {
        eq(text('\\int_{-1}^{1} abs(x) dx'), '1');
        eq(Math.abs(calculate('\\int_0^{1000} cos(x) dx').value - Math.sin(1000)) < 1e-6, true);
        eq(Math.abs(calculate('\\int_0^{0.00001} x dx').value - 5e-11) < 1e-15, true);
    });
    test('tiny and huge exact answers are written as what they are', () => {
        eq(text('10^(-400)'), '1*10^(-400)');
        eq(text('10^400/7'), '1.42857142857*10^(399)');
        throws(() => calculate('10^(-50000)'), /too small/);
        eq(text('round(pi, 400)'), '3.14159265359');
        eq(text('fixed(pi, 120)').length, 124);
        eq(text('1 = "a"'), 'false');
    });
});

suite('agreement: KaTeX reads the LaTeX', () => {
    test('a root index holding ] is braced, so it does not end the index', () => {
        eq(toLaTeX(['x', '0', '5', '2', '(]', '∈', '3', '2', '?:', 'y', 'root']).startsWith('\\sqrt[{'), true);
        eq(toLaTeX('root(3, x)'), '\\sqrt[3]{x}');
    });
});
