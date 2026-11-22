/**
 * calculate(): exact answers (BigInt fractions, surds, π, complex numbers, polynomials, matrices) and numeric
 * calculus; its options, {{blocks}} and {{≈…}}, and where it gives no answer.
 */
import { suite, test, eq, throws } from '../harness.js';
import { MathError, UnknownError, calculate, calculateBlock, clean, evaluate, parse, toLaTeX } from '../../src/all.js';

const T = (s, scope, options) => calculate(s, scope, options).text;

const V = (s, scope, options) => calculate(s, scope, options).value;

const near = (actual, expected, label = '') => {
    if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-12 * Math.max(1, Math.abs(expected))) {
        throw new Error(`${label ? label + ': ' : ''}expected ≈ ${expected}, got ${actual}`);
    }
};

suite('calculate: fixed', () => {
    test('exactly that many decimals, as text', () => {
        // a text answer: .value is the text, .text shows it quoted like any string
        eq(calculate('fixed(2, 3)').value, '2.000');
        eq(calculate('fixed(2, 3)').text, '"2.000"');
        eq(calculate('fixed(1/3, 2)').value, '0.33');
        eq(calculate('fixed(2/3, 2)').value, '0.67');
        eq(calculate('fixed(-2.5, 0)').value, '-3');
        eq(calculate('fixed(1234.5678, 1)').value, '1234.6');
        eq(calculate('fixed(sqrt(2), 4)').value, '1.4142');
        eq(calculate('fixed(2.5)').value, '2.50');   // one argument: two decimals
    });
});

suite('calculate: exact arithmetic', () => {
    test('fractions stay fractions', () => {
        eq(T('1/3 + 1/6'), '1/2');
        eq(T('10/4'), '5/2');
        eq(T('-7 mod 3'), '2');
        eq(T('mean(1, 2, 3, 4)'), '5/2');
    });
    test('whole numbers of any size', () => {
        eq(T('2^100'), '1267650600228229401496703205376');
        eq(T('25!'), '15511210043330985984000000');
        eq(T('2^200'), '1.60693804426*10^(60)');
        eq(T('\\binom{50}{25}'), '126410606437752');
    });
    test('decimals are read exactly, including repeating ones', () => {
        eq(T('0.1 + 0.2'), '3/10');
        eq(T('0.1 + 0.2', {}, { decimal: true }), '0.3');
        eq(T('1.333..'), '4/3');
        eq(T('0.1212..'), '4/33');
        eq(T('0.1666..'), '1/6');
    });
    test('surds are simplified', () => {
        eq(T('sqrt(8)'), '2*sqrt(2)');
        eq(T('sqrt(12)/sqrt(3)'), '2');
        eq(T('1/sqrt(2)'), 'sqrt(2)/2');
        eq(T('root(3, 54)'), '3*root(3, 2)');
        eq(T('(-8)^(1/3)'), '-2');
        eq(T('8^(2/3)'), '4');
        eq(T('4^(-1/2)'), '1/2');
        eq(T('\\sqrt[4]{9}'), 'sqrt(3)');
    });
    test('π and e are kept', () => {
        eq(T('pi/2 + pi/3'), '(5*pi)/6');
        eq(T('ln(e^3)'), '3');
        eq(T('e^2'), 'e^2');
        eq(T('1/pi'), '1/pi');
    });
    test('trig at the standard angles', () => {
        eq(T('sin(pi/6)'), '1/2');
        eq(T('cos(pi/4)'), 'sqrt(2)/2');
        eq(T('tan(pi/3)'), 'sqrt(3)');
        eq(T('sin(5pi/4)'), '-sqrt(2)/2');
        eq(T('sec(pi/3)'), '2');
        eq(T('arcsin(1/2)'), 'pi/6');
        eq(T('arccos(-sqrt(3)/2)'), '(5*pi)/6');
        eq(T('arctan(1)'), 'pi/4');
        eq(T('sin(1)'), '0.841470984808');
    });
    test('logs that come out exact', () => {
        eq(T('log_2(8)'), '3');
        eq(T('log_4(2)'), '1/2');
        eq(T('log_{10}(1000)'), '3');
        eq(T('log_2(3)'), '1.58496250072');
    });
    test('comparisons, plus-or-minus and lists', () => {
        eq(T('1/3 = 2/6'), 'true');
        eq(T('sqrt(2)^2 = 2'), 'true');
        eq(T('±sqrt(4)'), '±2');
        eq(T('(-b ± sqrt(b^2 - 4a c))/(2a)', { a: 1, b: -3, c: 2 }), '{2, 1}');
    });
});

suite('calculate: no answer, or none yet', () => {
    test('math with no answer throws MathError', () => {
        for (const s of ['1/0', 'sqrt(-1)', '0^0', 'ln(0)', '(-1)!', 'tan(pi/2)', 'arcsin(2)']) throws(() => calculate(s), MathError);
    });
    test('what cannot be worked out throws UnknownError', () => {
        throws(() => calculate('\\sin x'), UnknownError);   // an unset variable where its value is needed
        eq(calculate('x + 1').text, 'x + 1');                  // (only polynomial arithmetic: the polynomial)
        throws(() => calculate('\\int x^2 dx'), UnknownError);
        throws(() => calculate('der(x^2, x)'), UnknownError);
    });
    test('numbers too big for a double are left alone, not called ∞', () => {
        throws(() => calculate('10^9!'), UnknownError);
        throws(() => calculate('3^(10^6)'), UnknownError);
        eq(T('e^1000'), 'e^1000');
        eq(parse('{{2^(10^9)}}'), parse('2^(10^9)'));
    });
});

suite('calculate: scope', () => {
    test('numbers, fractions as text, functions, subscripted names', () => {
        eq(T('x^2 + 1', { x: 3 }), '10');
        eq(T('a/b', { a: 1, b: 3 }), '1/3');
        eq(T('2a', { a: '1/3' }), '2/3');
        eq(T('f(2) + 1', { f: (t) => t * t }), '5');
        eq(T('x_1 + x_2', { x_1: 1, x_2: 2 }), '3');
        eq(calculate('x / 4', { x: 2 }).value, 0.5);
    });
});

suite('calculate: calculus, numerically', () => {
    test('definite integrals', () => {
        eq(T('\\int_0^1 x^2 dx'), '1/3');
        eq(T('\\int_0^\\pi \\sin x dx'), '2');
        eq(T('\\int_0^1 \\frac{4}{1+x^2} dx'), 'pi');
        eq(T('\\int_0^1 \\frac{1}{\\sqrt{x}} dx'), '2');
        eq(T('\\int_1^\\infty \\frac{1}{x^2} dx'), '1');
        eq(T('\\int_2^0 x dx'), '-2');
        throws(() => calculate('\\int_0^1 \\frac{1}{x} dx'), MathError);
    });
    test('derivatives at a point: der(f, x = a), or \\left. … \\right|_{x = a}', () => {
        eq(T('der(x^3, x = 2)'), '12');
        eq(T('der(sin(x), x = pi/3)'), '1/2');
        eq(T('der(x^3, x = 1, 2)'), '6', 'the second derivative at 1');
        eq(T('der(der(x^3, x), x = 1)'), '6');
        eq(T('\\left.\\frac{d}{dx} x^3\\right|_{x=2}'), '12');
        eq(T('der(x^3, x = a)', { a: 3 }), '27', 'the point can be a value from the scope');
        eq(T('der(x^3, x = 2)', { x: 5 }), '12', "an outside x doesn't matter: the point is x's value");
        throws(() => calculate('der(abs(x), x = 0)'), MathError);
    });
    test('a plain d/dx is worked out only where x varies, not where the caller fixed it', () => {
        // { x: 2 } (or a Markdown $x = 2$) makes x a constant: d/dx x³ there is no number; der(x^3, x = 2) is
        throws(() => calculate('der(x^3, x)', { x: 2 }), UnknownError);
        try { calculate('der(x^3, x)', { x: 2 }); } catch (e) { eq(e.message, 'a derivative needs a point: der(f, x = a)'); }
        eq(T('int(der(x^3, x), x, 0, 1)'), '1', 'inside ∫ … dx, x varies');
        eq(T('\\sum_{k=1}^{3} der(x^k, x = 1)'), '6');
        eq(T('der(der(x^3, x), x = 1)'), '6', 'the outer d/dx varies x for the inner one');
    });
    test('limits', () => {
        eq(T('\\lim_{x\\to 0}\\frac{\\sin x}{x}'), '1');
        eq(T('\\lim_{x\\to\\infty}(1+1/x)^x'), 'e');
        eq(T('\\lim_{x\\to 2}\\frac{x^2-4}{x-2}'), '4');
        eq(T('\\lim_{x\\to\\infty}\\frac{3x^2+2}{5x^2-x}'), '3/5');
        eq(T('\\lim_{x\\to 0^-}\\frac{|x|}{x}'), '-1');
        eq(T('\\lim_{x\\to 0^+}\\ln x'), '-∞');
        eq(T('\\lim_{x\\to 0}\\frac{1}{x^2}'), '∞');
        throws(() => calculate('\\lim_{x\\to 0}\\frac{|x|}{x}'), MathError);
    });
    test('sums and products', () => {
        eq(T('\\sum_{i=1}^{10} i^2'), '385');
        eq(T('\\sum_{k=1}^{100}\\frac{1}{k(k+1)}'), '100/101');
        eq(T('\\prod_{k=1}^{5} k'), '120');
        eq(T('\\sum_{n=1}^{\\infty}\\frac{1}{n^2}'), 'pi^2/6');
        eq(T('\\sum_{n=0}^{\\infty}\\frac{1}{n!}'), 'e');
        throws(() => calculate('\\sum_{n=1}^{\\infty}\\frac{1}{n}'), MathError);
    });
});

suite('calculate: {{blocks}}', () => {
    const P = (s, options) => parse(s, options);
    test('values replace the block', () => {
        eq(P('3+4={{3+4}}'), ['3', '4', '+', '7', '=']);
        eq(P('{{2^100}}'), ['1267650600228229401496703205376']);
        eq(P('{{0.1+0.2}}'), ['0.3']);
    });
    test('answers are bracketed where they would run together', () => {
        eq(P('2{{1+1}}'), ['2', '2', '*']);
        eq(P('x^{{1/2}}'), ['x', '1', '2', '/', '^']);
        eq(P('2{{-1}}'), ['2', '-1', '*']);
        eq(clean('total={{(2 + 3) * 4}}').cleaned, 'total=20');
    });
    test('~ asks for a decimal, ~n for n places', () => {
        eq(P('{{~ pi}}'), ['3.14159265359']);
        eq(P('{{~3 sqrt(2)}}'), ['1.414']);
        eq(P('{{~2 1/3}}'), ['0.33']);
    });
    test('no answer reads "undefined"; unknowns stay as written', () => {
        eq(P('{{1/0}}'), ['"undefined"']);
        eq(P('{{x+1}}'), ['x', '1', '+']);
        eq(P('\\frac{1}{0} = {{1/0}}'), ['1', '0', '/', '"undefined"', '=']);
    });
    test('scope reaches blocks', () => eq(P('y = {{a/b}}', { scope: { a: 1, b: 3 } }), ['y', '1', '3', '/', '=']));
    test('calculateBlock on its own', () => {
        eq(calculateBlock('1/3'), '(1/3)');
        eq(calculateBlock('7'), '7');
    });
});

suite('calculate: options and lists', () => {
    test('digits: significant digits of an inexact answer', () => {
        eq(calculate('sin(1)', {}, { digits: 4 }).text, '0.8415');
        eq(calculate('sin(1)').text, '0.841470984808');
    });
    test('maxDigits: the longest whole number written out', () => {
        eq(calculate('2^100').text, '1267650600228229401496703205376');
        eq(calculate('2^200').text, '1.60693804426*10^(60)');
        eq(calculate('2^200', {}, { maxDigits: 100 }).text.length, 61);
    });
    test('lists work element by element, and must be the same length', () => {
        eq(calculate('[1, 2] + [3, 4]').text, '[4, 6]');
        throws(() => calculate('[1, 2] + [3, 4, 5]'), MathError);
    });
    test('BigInt values in the scope stay exact', () => {
        eq(calculate('n + 1', { n: 2n ** 70n }).text, String(2n ** 70n + 1n));
    });
    test('a chain of comparisons, as math', () => {
        eq(calculate('3 < x < 7', { x: 10 }).value, false);
        eq(calculate('3 < x < 7', { x: 5 }).value, true);
    });
});

suite('calculate: matrices', () => {
    const A = 'bmatrix([1, 2], [3, 4])';
    test('the matrix product, powers, the inverse and the transpose, exactly', () => {
        eq(T(`${A} * [[0, 1], [1, 0]]`), 'bmatrix([2, 1], [4, 3])');
        eq(T('[[1, 2], [3, 4]] * [[5, 6], [7, 8]]'), '[[19, 22], [43, 50]]', 'a list of lists is a matrix');
        eq(T(`${A}^2`), 'bmatrix([7, 10], [15, 22])');
        eq(T(`${A}^(-1)`), 'bmatrix([-2, 1], [3/2, -1/2])');
        eq(T(`${A}^T`), 'bmatrix([1, 3], [2, 4])');
        eq(T(`${A}^T`, { T: 2 }), 'bmatrix([7, 10], [15, 22])', 'unless T has a value');
        eq(T(`${A} / ${A}`), 'bmatrix([1, 0], [0, 1])');
        eq(T('2 * pmatrix([1, 2], [3, 4]) + pmatrix([1, 1], [1, 1])'), 'pmatrix([3, 5], [7, 9])', 'entry by entry with a number, and +');
    });
    test('with vectors', () => {
        eq(T(`${A} * [5, 6]`), '[17, 39]');
        eq(T(`[1, 2] * ${A}`), '[7, 10]');
        eq(T('[1, 2] * [3, 4]'), '[3, 8]', 'two lists: still entry by entry');
        eq(T('dot([1, 2, 3], [4, 5, 6])'), '32');
        eq(T('cross([1, 0, 0], [0, 1, 0])'), '[0, 0, 1]');
        eq(T(`linsolve(${A}, [5, 6])`), '[-4, 9/2]');
    });
    test('determinants and the rest', () => {
        eq(T('vmatrix([1, 2], [3, 4])'), '-2');
        eq(T('\\begin{vmatrix} 1 & 2 \\\\ 3 & 4 \\end{vmatrix}'), '-2');
        eq(T('det([[1/2, 1/3], [1/4, 1/5]])'), '1/60');
        eq(T(`det(${A})`), '-2');
        eq(T(`trace(${A})`), '5');
        eq(T('rank([[1, 2], [2, 4]])'), '1');
        eq(T('rref([[1, 2, 3], [4, 5, 6]])'), '[[1, 0, -1], [0, 1, 2]]');
        eq(T('identity(2)'), 'bmatrix([1, 0], [0, 1])');
        eq(T('\\det A', { A: [[2, 0], [0, 3]] }), '6', 'det is a function like sin');
        eq(T('inv(x)', { inv: (v) => v + 1, x: 1 }), '2', "a scope's own inv comes first");
    });
    test('no answer', () => {
        throws(() => T('inv([[1, 2], [2, 4]])'), MathError);
        throws(() => T(`${A} * [[1, 2, 3]]`), MathError);
        throws(() => T('pmatrix([1, 2], [3])'), MathError);
        throws(() => T(`${A}^(1/2)`), UnknownError);
    });
    test('{{…}} draws its answer as a matrix again', () => {
        eq(calculateBlock(`${A}^2`), '(bmatrix([7, 10], [15, 22]))');
        eq(parse(calculateBlock(`${A}^2`)).at(-1), 'bmatrix');
    });
});

suite('calculate: complex numbers', () => {
    test('i is the imaginary unit: arithmetic, powers, division, exactly', () => {
        eq(T('(3 + 2i)(1 - i)'), '5 - i');
        eq(T('i^2'), '-1');
        eq(T('i^{10}'), '-1');
        eq(T('(2+i)^3'), '2 + 11*i');
        eq(T('(1+i)/(1-i)'), 'i');
        eq(T('1/i'), '-i');
        eq(calculate('(3 + 2i)(1 - i)').value, { re: 5, im: -1 });
        eq(calculate('(3 + 2i)(1 - i)').exact, true);
    });
    test('a power whose exact value would be huge is taken in polar form, at once', () => {
        const start = Date.now();
        eq(T('(3/5 + 4/5 i)^100000'), '-0.645929681065 + 0.763396913224*i');
        if (Date.now() - start > 500) throw new Error(`took ${Date.now() - start} ms (it took 3 s)`);
        eq(T('(3/5 + 4/5 i)^10'), '-9653287/9765625 + (1476984/9765625)*i', 'small: still exact');
        eq(T('i^100001'), 'i');
    });
    test('modulus, Euler, roots and logs', () => {
        eq(T('|3 + 4i|'), '5');
        eq(T('e^{i\\pi} + 1 = 0'), 'true');
        eq(T('e^{i\\pi/3}'), '1/2 + (sqrt(3)/2)*i');
        eq(T('\\sqrt{i}'), 'sqrt(2)/2 + (sqrt(2)/2)*i');
        eq(T('\\sqrt{-4}', {}, { complex: true }), '2*i');
        eq(T('\\sqrt{-4} = 2i'), 'true', 'an i in the input: complex results');
        eq(T('\\ln(-1) = i\\pi'), 'true');
    });
    test('without i, real as before: √−4 has no real value, and an odd root of a negative is real', () => {
        throws(() => calculate('\\sqrt{-4}'), MathError);
        eq(T('\\sqrt[3]{-8}'), '-2');
        eq(T('\\sqrt[3]{-8} + 0i'), '-2');
    });
    test('i with a value, or an index, is that value', () => {
        eq(T('i + 1', { i: 2 }), '3');
        eq(T('\\sum_{i=1}^{3} i'), '6');
    });
    test('complex numbers have no order, and no real value where one is needed', () => {
        throws(() => calculate('i < 1'), UnknownError);
        throws(() => calculate('\\sin(i)'), UnknownError);
    });
});

suite('calculate: polynomials', () => {
    test('unknowns are kept where they are only added, multiplied and raised to whole powers', () => {
        eq(T('(x+1)^2'), 'x^2 + 2*x + 1');
        eq(T('(x+1)(x-1)'), 'x^2 - 1');
        eq(T('(x+y)^3'), 'x^3 + 3*x^2*y + 3*x*y^2 + y^3');
        eq(T('x + x'), '2*x');
        eq(T('2x - 3 + x/2'), '5*x/2 - 3');
        eq(T('3/4 x^2'), '3*x^2/4');
        eq(T('(\\pi x)^2'), 'pi^2*x^2');
        eq(T('(x+i)^2'), 'x^2 + (2*i)*x - 1');
        eq(calculate('(x+1)^2').value, 'x^2 + 2*x + 1');
    });
    test('division that is exact; an identity is true', () => {
        eq(T('(x^2-1)/(x-1)'), 'x + 1');
        eq(T('(x^3 - 8)/(x - 2)'), 'x^2 + 2*x + 4');
        throws(() => calculate('(x^2+1)/(x-1)'), UnknownError);   // a remainder: not worked out here
        eq(T('(x+1)^2 = x^2 + 2x + 1'), 'true');
        throws(() => calculate('x^2 = 4'), UnknownError);         // an equation has no one answer
    });
    test('a determinant of letters', () => eq(T('\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}'), 'a*d - b*c'));
    test('what needs a value still says so; values still win', () => {
        const message = (f) => { try { f(); } catch (e) { return `${e.constructor.name}: ${e.message}`; } return 'no error'; };
        eq(message(() => calculate('\\sin x')), "UnknownError: no value for 'x'");
        eq(message(() => calculate('x^{-1}')), "UnknownError: no value for 'x'");
        eq(message(() => calculate('\\sum_{k=1}^{n} k')), "UnknownError: no value for 'n'");
        eq(T('x^2', { x: 3 }), '9');
        eq(T('(x+1)^2', { x: 2 }), '9');
    });
    test('{{…}} blocks', () => {
        eq(parse('{{(x+1)^2}}').join(' '), 'x 2 ^ 2 x * + 1 +');
        eq(parse('{{a/b}}').join(' '), 'a b /', 'a fraction of unknowns is left as written');
    });
    test('a polynomial too big to write is refused', () => throws(() => calculate('(a+b+c+d+e+f)^40'), UnknownError));
    test('a power with too many terms is refused before the work (it took 3 s); powers that fit stay exact', () => {
        const start = Date.now();
        throws(() => calculate('(a+b+c+d+e+f)^40'), /too many terms/);
        throws(() => calculate('(a+b+c+d)^40'), /too many terms/);
        eq(Date.now() - start < 200, true, `took ${Date.now() - start} ms`);
        eq(T('(a+b)^10').split(' + ').length, 11);
        eq(T('(x+1)^20').startsWith('x^20 + 20*x^19 + 190*x^18'), true);
        eq(T('(x+1)^20').endsWith('20*x + 1'), true);
        eq(T('(1+x+x^2+x^3+x^4+x^5+x^6+x^7+x^8+x^9)^10').split(' + ').length, 91);   // 10 terms, but one unknown: x^0 … x^90
    });
});

suite('calculate: arcsec, arccsc, arccot exactly', () => {
    test('the special angles in π', () => {
        eq(T('arcsec(2)'), 'pi/3');
        eq(T('arcsec(-2)'), '(2*pi)/3');
        eq(T('arccsc(2)'), 'pi/6');
        eq(T('arccsc(-2)'), '-pi/6');
        eq(T('arccot(1)'), 'pi/4');
        eq(T('arccot(-1)'), '(3*pi)/4');
        eq(T('arccot(0)'), 'pi/2');
        eq(calculate('arcsec(2)').exact, true);
    });
    test('outside the domain: refused', () => {
        throws(() => calculate('arcsec(0.5)'), /not a real number/);
    });
});

suite('calculate: complex logarithms', () => {
    test('ln of a negative number is no real number, unless complex numbers are in play', () => {
        throws(() => calculate('ln(-1)'), /not a real number/);
        eq(T('ln(-1)', {}, { complex: true }), '(pi)*i');
        eq(T('ln(-1) + 0i'), '(pi)*i');   // an i in the input turns complex results on
    });
    test('ln(i) = πi/2, exactly', () => {
        const r = calculate('ln(i)');
        eq(r.text, '(pi/2)*i');
        eq(r.exact, true);
        eq(r.value.re, 0);
        near(r.value.im, Math.PI / 2);
    });
    test('ln(1+i) = ln(2)/2 + πi/4, as a decimal', () => {
        const r = calculate('ln(1+i)');
        eq(r.exact, false);
        near(r.value.re, Math.log(2) / 2);
        near(r.value.im, Math.PI / 4);
    });
    test("e^(iπ) = -1", () => eq(T('e^(iπ)'), '-1'));
    test('evaluate() is real: i is just a name it has no value for', () => {
        eq(Number.isNaN(evaluate('ln(-1)')), true);
        throws(() => evaluate('ln(i)'), /No value for 'i'/);
    });
});

suite('calculate: the gamma function (factorials of non-integers)', () => {
    test('0.5! = √π/2', () => {
        const r = calculate('0.5!');
        eq(r.exact, false);
        near(r.value, Math.sqrt(Math.PI) / 2);
    });
    test('1.5! = 3√π/4, (-0.5)! = √π', () => {
        near(V('1.5!'), 3 * Math.sqrt(Math.PI) / 4);
        near(V('(-0.5)!'), Math.sqrt(Math.PI));
    });
    test('evaluate() has factorials of whole numbers only (NaN)', () => eq(Number.isNaN(evaluate('0.5!')), true));
});

suite('calculate: functions of several arguments', () => {
    test('atan2(y, x)', () => {
        near(V('atan2(1,1)'), Math.PI / 4);
        near(V('atan2(1,0)'), Math.PI / 2);
        near(evaluate('atan2(1,1)'), Math.PI / 4);
    });
    test('prod, min, gcd', () => {
        eq(T('prod(2,3,4)'), '24');
        eq(T('min(3,1,2)'), '1');
        eq(T('gcd(12,18)'), '6');
        eq(T('gcd(12,18,8)'), '2');
        eq(evaluate('prod(2,3,4)'), 24);
        eq(evaluate('min(3,1,2)'), 1);
        eq(evaluate('gcd(12,18,8)'), 2);
    });
});

suite('calculate: comparisons and logic', () => {
    const both = (s, expected) => {
        eq(V(s), expected, `calculate ${s}`);
        eq(evaluate(s), expected, `evaluate ${s}`);
    };
    test('≈ (close enough for doubles)', () => {
        both('0.1+0.2 ≈ 0.3', true);
        both('1 ≈ 2', false);
    });
    test('≤ ≥ ≠', () => {
        both('2 ≤ 2', true);
        both('3 ≤ 2', false);
        both('3 ≥ 4', false);
        both('4 ≥ 4', true);
        both('1 ≠ 2', true);
        both('2 ≠ 2', false);
    });
    test('=== compares values, not spellings', () => {
        both('2 === 2', true);
        both('2 === 2.0', true);
        both('1/2 === 0.5', true);
        both('1 === 2', false);
    });
    test('| \\xor \\nor \\nand \\implies: their truth tables', () => {
        for (const [a, b, or, xor, nor, nand, implies] of [
            [true, true, true, false, false, false, true],
            [true, false, true, true, false, true, false],
            [false, true, true, true, false, true, true],
            [false, false, false, false, true, true, true],
        ]) {
            both(`${a} | ${b}`, or);
            both(`${a} \\xor ${b}`, xor);
            both(`${a} \\nor ${b}`, nor);
            both(`${a} \\nand ${b}`, nand);
            both(`${a} \\implies ${b}`, implies);
        }
    });
});

suite('calculate: named constants', () => {
    test('tau and τ are 2π, exactly', () => {
        eq(T('tau'), '2*pi');
        eq(T('τ'), '2*pi');
        eq(T('2τ'), '4*pi');
        near(V('tau'), 2 * Math.PI);
        near(evaluate('τ'), 2 * Math.PI);
    });
    test('π', () => {
        eq(T('π'), 'pi');
        eq(calculate('π').exact, true);
        near(evaluate('π'), Math.PI);
    });
    test('true and false', () => {
        eq(calculate('true'), { value: true, text: 'true', exact: true });
        eq(calculate('false'), { value: false, text: 'false', exact: true });
        eq(evaluate('true'), true);
    });
});

suite('calculate: options', () => {
    test('places: that many decimals, rounded', () => {
        eq(T('1/3', {}, { places: 3 }), '0.333');
        eq(T('2/3', {}, { places: 0 }), '1');
        eq(calculate('1/3', {}, { places: 3 }).exact, true);   // the value is exact; only the text is rounded
        eq(T('1/3', {}, { places: undefined }), '1/3');       // undefined is no option
    });
    test('places must be a whole number from 0 to 10000', () => {
        for (const places of [-1, 1.5, 10001, '2', NaN]) {
            throws(() => calculate('1/3', {}, { places }), /places is a whole number from 0 to 10000/);
        }
    });
    test('decimal: a decimal instead of a fraction', () => eq(T('1/3', {}, { decimal: true }), '0.333333333333'));
    test('complex: false keeps to real numbers even with an i in the input', () => {
        throws(() => calculate('sqrt(-4)'), /not a real number/);
        eq(T('sqrt(-4)', {}, { complex: true }), '2*i');
        throws(() => calculate('sqrt(-4) + i', {}, { complex: false }), /not a real number/);
        throws(() => calculate('ln(-1)', {}, { complex: false }), /not a real number/);
    });
});

suite('calculate: {{≈…}} blocks', () => {
    // calculateBlock: a leading ~ or ≈ asks for a decimal, ~3 / ≈3 for three places
    test('≈ with places, like ~', () => {
        eq(calculateBlock('≈3 1/3'), '0.333');
        eq(calculateBlock('~3 1/3'), '0.333');
        eq(calculateBlock('≈2 pi'), '3.14');
        eq(calculateBlock('≈ pi'), '3.14159265359');
    });
    test('in parsed text', () => {
        eq(parse('{{≈3 1/3}}'), ['0.333']);
        eq(parse('{{~3 1/3}}'), ['0.333']);
        eq(parse('{{≈2 pi}}'), ['3.14']);
        eq(parse('{{~ pi}}'), ['3.14159265359']);
        eq(parse('x = {{≈3 1/3}}'), ['x', '0.333', '=']);
        eq(toLaTeX('x = {{≈3 1/3}}'), 'x = 0.333');
    });
    test('without ≈ the answer stays exact', () => eq(parse('{{1/3}}'), ['1', '3', '/']));
    test('{{≈ 1/3}}: a number after "≈ " is the question, not the places', () => {
        eq(calculateBlock('≈ 1/3'), '0.333333333333');
        eq(calculateBlock('~ 1/3'), '0.333333333333');
        eq(parse('{{≈ 1/3}}'), ['0.333333333333']);
    });
});

suite('calculate: what underflows inside a limit or an integral is 0 there', () => {
    test('limits and improper integrals of e^-x', () => {
        eq(T('\\lim_{x\\to -\\infty} e^x'), '0');
        eq(T('\\lim_{x\\to\\infty} x e^{-x}'), '0');
        eq(T('\\int_0^{\\infty} e^{-x} dx'), '1');
        eq(Math.abs(calculate('\\int_{-\\infty}^{\\infty} e^{-x^2} dx').value - Math.sqrt(Math.PI)) < 1e-9, true);
    });
    test('…and a number typed too small is still refused', () => throws(() => calculate('10^{-50000}'), /too small/));
});

suite('calculate: exact comparisons, series, limits, integrals, tiny and huge answers', () => {
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

suite('calculate: numeric integrals and tiny negative fractions', () => {
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

suite('calculate: roots of numbers past the largest double', () => {
    const near = (a, b) => Math.abs(a / b - 1) < 1e-9;
    test('a root of a number past the largest double has a value (it was ∞, and its reciprocal NaN)', () => {
        eq(near(calculate('root(12, 3^2000 + 2)').value, 3 ** (2000 / 12)), true);
        eq(near(calculate('1 / root(12, 3^2000 + 2)').value, 3 ** (-2000 / 12)), true);
        eq(near(calculate('1/root(12, 3^100+2)').value, 3 ** (-100 / 12)), true);     // exact: ¹²√(…)/(3¹⁰⁰+2), huge over huge
        eq(near(calculate('-1/root(12, 3^100+2)').value, -(3 ** (-100 / 12))), true);
        eq(near(calculate('pi*root(3,10^400)').value, Math.PI * 10 ** (400 / 3)), true);
    });
    test('…and small roots are as they were, exactly', () => {
        eq(calculate('1/root(3,2)').text, 'root(3, 4)/2');
        eq(calculate('1/root(12,5)').text, 'root(12, 48828125)/5');
        eq(calculate('sqrt(2)').value, Math.SQRT2);
        eq(calculate('1/sqrt(2)').text, calculate('sqrt(2)/2').text);
    });
});
