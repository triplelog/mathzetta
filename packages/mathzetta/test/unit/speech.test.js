/**
 * Speech: toSpeech (what the calculus videos read, the drawing in view) and toAudioSpeech (what a screen reader
 * hears: groups opened with "the quantity", closed with an end word); higher derivatives read aloud.
 */
import { suite, test, eq, throws } from '../harness.js';
import { parse, toAudioSpeech, toAudioSpeechSegments, toSpeech, toSpeechSegments } from '../../src/all.js';

suite('speech: words, names and segments', () => {
    test('reads like a teacher', () => {
        eq(toSpeech('x^2 + 1'), 'x squared plus 1');
        eq(toSpeech('(x+1)^2'), 'the quantity x plus 1, squared');
        eq(toSpeech('\\frac{\\sin x}{x}'), 'sine of x, over x');
        eq(toSpeech('\\int_0^1 x^2 dx'), 'the integral from 0 to 1 of x squared, d x');
        eq(toSpeech("f'(x) = 2x"), 'f prime of x equals 2 x');
        eq(toSpeech('\\frac{3}{4}'), 'three quarters');
        eq(toSpeech('-3'), 'negative 3');
    });
    test('words, names and whole phrases can be changed', () => {
        eq(toSpeech('-3', { words: { negative: 'minus' } }), 'minus 3');
        eq(toSpeech('\\ln x', { names: { ln: 'log' } }), 'log of x');
        eq(toSpeech('\\sqrt{x}+1', { say: { sqrt: ([a]) => `root ${a}` } }), 'root x plus 1');
        eq(toSpeech('x^2', { say: { '^': ([b, e], node, speak) => `${b} raised to ${speak(node.args[1])}` } }), 'x raised to 2');
    });
    test('segments carry node ids', () => {
        const segments = toSpeechSegments(parse('x^2+1'));   // x 2 ^ 1 +
        eq(segments.map((s) => s.text).join(' '), 'x squared plus 1');
        eq(segments.map((s) => s.id), [0, 2, 4, 3]);
    });
});

suite('speech: segments', () => {
    test('pauses are attached to words, never pieces of their own', () => {
        const segments = toSpeechSegments(parse('\\frac{x+1}{x-1} + 2'));
        eq(segments.every((s) => s.text.trim() && !s.text.startsWith(',')), true, JSON.stringify(segments));
        eq(segments.map((s) => s.text).join(' '), toSpeech('\\frac{x+1}{x-1} + 2'));
    });
});

suite('audio speech: the grouping in the words, for a listener who cannot see the math', () => {
    // pairs toSpeech() reads alike (the drawing tells them apart) that a listener alone could not
    const PAIRS = [
        ['\\sqrt{x+1}', '\\sqrt{x}+1'], ['\\sqrt{x+1}+2', '\\sqrt{x+1+2}'], ['\\sqrt[3]{x+1}', '\\sqrt[3]{x}+1'],
        ['\\sqrt{x^2+y^2}', '\\sqrt{x^2}+y^2'], ['x_{n+1}', 'x_n+1'], ['x^{n+1}', 'x^n+1'], ['x^{n+1}+2', 'x^{n+1+2}'],
        ['e^{-x^2}', '(e^{-x})^2'], ['\\frac{1}{x+1}+2', '\\frac{1}{x+1+2}'], ['|x-1|+2', '|x-1+2|'],
        ['\\sin(x+1)+2', '\\sin(x+1+2)'], ['\\lim_{x\\to0}(x+1)', '\\lim_{x\\to0}x+1'],
    ];
    test('every pair the eye tells apart, the ear can too', () => {
        for (const [a, b] of PAIRS) {
            const A = toAudioSpeech(a), B = toAudioSpeech(b);
            eq(A === B, false, `${a} and ${b} both read "${A}"`);
        }
    });
    test('a group opens with "the quantity" and closes with an end word only when something follows', () => {
        eq(toAudioSpeech('\\sqrt{x+1}'), 'the square root of the quantity x plus 1');
        eq(toAudioSpeech('\\sqrt{x+1}+2'), 'the square root of the quantity x plus 1, end root, plus 2');
        eq(toAudioSpeech('x^{n+1}+2'), 'x to the power of the quantity n plus 1, end exponent, plus 2');
        eq(toAudioSpeech('x_{n+1}'), 'x sub the quantity n plus 1');
        for (const input of ['\\sqrt{x+1}', '\\frac{1}{x+1}', '|x-1|', 'x^{n+1}', '\\sin(x+1)']) {
            eq(/end \w+$/.test(toAudioSpeech(input)), false, `${input} ends on an end word`);
        }
    });
    test('the video reading is untouched, and simple math reads the same both ways', () => {
        eq(toSpeech('\\sqrt{x+1}+2'), 'the square root of x plus 1, plus 2');
        for (const input of ['x^2 + 1', '2x', '\\sin x', '\\frac{1}{2}', '\\int_0^1 x^2\\,dx']) eq(toAudioSpeech(input), toSpeech(input), input);
    });
    test('end words are words: changed with the words option, pauses attached like any other', () => {
        eq(toAudioSpeech('\\sqrt{x+1}+2', { words: { endRoot: 'close root' } }), 'the square root of the quantity x plus 1, close root, plus 2');
        const segments = toAudioSpeechSegments(parse('\\sqrt{x+1}+2'));
        eq(segments.every((s) => s.text.trim() && !s.text.startsWith(',')), true, JSON.stringify(segments));
        eq(segments.map((s) => s.text).join(' '), toAudioSpeech('\\sqrt{x+1}+2'));
    });
});

suite('audio speech: alone, it keeps apart what the drawing keeps apart', () => {
    const PAIRS = [
        ['-x^2', '(-x)^2'], ['e^{-x^2}', 'e^{(-x)^2}'], ['\\frac{a}{bc}', '\\frac{a}{b}c'], ['a/(b/c)', 'a/b/c'],
        ['2^{x}y', '2^{xy}'], ['-3!', '(-3)!'], ['2x!', '(2x)!'], ['x_1^2', 'x_{1^2}'], ['\\max(1,2)+3', '\\max(1,2+3)'],
        ['\\lim_{x\\to 0} \\frac{\\sin x}{x}', '\\frac{\\lim_{x\\to 0} \\sin x}{x}'], ['x>0 ? 1 : -1+2', '(x>0 ? 1 : -1)+2'],
        [['-1', 'a', 'b', '+', '*'], ['-1', 'a', '*', 'b', '+']],
    ];
    for (const [a, b] of PAIRS) test(`${a} and ${b}`, () => eq(toAudioSpeech(a) === toAudioSpeech(b), false, `both read "${toAudioSpeech(a)}"`));
    test('"to the the quantity": an exponent that opens a quantity takes "to the power of"', () => {
        eq(toSpeech('2^{(-2)^2}'), '2 to the power of the quantity negative 2, squared');
    });
});

/** Both entry points; the audio one differs only where a group opens and closes. */
const says = (input, speech, audio = speech) => {
    eq(toSpeech(input), speech, `toSpeech ${input}`);
    eq(toAudioSpeech(input), audio, `toAudioSpeech ${input}`);
};

suite('speech: Leibniz notation, d^n y / dx^n', () => {
    test('second and third: squared and cubed', () => {
        says('d^2/dx^2 f', 'd squared f d x squared');
        says('\\frac{d^3y}{dx^3}', 'd cubed y d x cubed');
    });
    test('fourth and on: "to the" an ordinal word, then digits from 11', () => {
        says('\\frac{d^{4}y}{dx^{4}}', 'd to the fourth y d x to the fourth');
        says('\\frac{d^{12}y}{dx^{12}}', 'd to the 12th y d x to the 12th');
    });
});

suite('speech: the operator form, the n-th derivative with respect to x of …', () => {
    test('second, third, fifth', () => {
        says('\\frac{d^2}{dx^2} f(x)', 'the second derivative with respect to x of f of x');
        says('\\frac{d^{3}}{dx^{3}} (x^3+x)', 'the third derivative with respect to x of x cubed plus x',
            'the third derivative with respect to x of the quantity x cubed plus x');
        says('\\frac{d^5}{dx^5} x^5', 'the fifth derivative with respect to x of x to the fifth');
    });
    test('from 11: digits with st / nd / rd / th', () => {
        says('\\frac{d^{11}}{dx^{11}} f(x)', 'the 11th derivative with respect to x of f of x');
        says('\\frac{d^{12}}{dx^{12}} f(x)', 'the 12th derivative with respect to x of f of x');
        says('\\frac{d^{13}}{dx^{13}} f(x)', 'the 13th derivative with respect to x of f of x');
        says('\\frac{d^{20}}{dx^{20}} f(x)', 'the 20th derivative with respect to x of f of x');
    });
});

suite('speech: primes and f^{(n)}', () => {
    test("f', f'', f''': prime, double prime, triple prime", () => {
        says("f'(x)", 'f prime of x');
        says("f''(x)", 'f double prime of x');
        says("f'''(x)", 'f triple prime of x');
    });
    test('f^{(4)} to f^{(9)}: the count of primes, then "prime"', () => {
        eq(parse('f^{(4)}(x)'), ['x', '1', '\\:f′′′′']);
        says('f^{(4)}(x)', 'f 4 prime of x');
        says('f^{(5)}(x)', 'f 5 prime of x');
        says('f^{(9)}(x)', 'f 9 prime of x');
    });
    test('f^{(10)}(x) and up: the tenth derivative too, f with ten primes; past 100 refused', () => {
        eq(parse('f^{(10)}(x)'), ['x', '1', `\\:f${'′'.repeat(10)}`]);
        eq(parse('f⁽¹⁰⁾(x)'), ['x', '1', `\\:f${'′'.repeat(10)}`]);
        eq(parse('f^{(12)}(2)'), ['2', '1', `\\:f${'′'.repeat(12)}`]);
        says('f^{(10)}(x)', 'f 10 prime of x');
        says('f^{(12)}(x)', 'f 12 prime of x');
        eq(parse('f^{(100)}(x)'), ['x', '1', `\\:f${'′'.repeat(100)}`]);
        throws(() => parse('f^{(101)}(x)'), /up to n = 100/);
        throws(() => parse('f^{(99999999999)}(x)'), /up to n = 100/);
        eq(parse('f^{(10)}'), ['f', '10', '^']);   // no argument: a power
    });
});
