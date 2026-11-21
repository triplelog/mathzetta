import { suite, test, eq } from '../harness.js';
import { calculate, calculateBlock, MathError, UnknownError, parse, clean } from '../../src/all.js';

const T = (s, scope, options) => calculate(s, scope, options).text;
/** Throws an error of this class. */
const throws = (body, Kind) => {
    try {
        body();
    } catch (error) {
        if (!(error instanceof Kind)) throw new Error(`threw ${error.constructor.name} "${error.message}", expected ${Kind.name}`);
        return;
    }
    throw new Error('expected an error');
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

suite('{{blocks}}', () => {
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

// ---- added 2026-11-03 ----
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
});
