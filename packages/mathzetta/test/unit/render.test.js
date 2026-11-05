/**
 * Writing: every renderer's fixes and hooks — LaTeX, MathML, HTML, speech, code, GLSL and the filter shaders, Excel.
 */
import { suite, test, eq, throws } from '../harness.js';
import {
    toLaTeX,
    toMathML,
    toJavaScript,
    toPython,
    toSQL,
    toText,
    toUnified,
    getMathMLIdMap,
    parse,
    toSpeech,
    toSpeechSegments,
    toAudioSpeech,
    toAudioSpeechSegments,
    toGLSL,
    GLSL_HELPERS,
    filterShader,
    filterVertexShader,
    toExcel,
    forXlsxFile,
} from '../../src/all.js';

// ---- from render.test.js ----
suite('fixed: round, then exactly that many decimals', () => {
    test('every format', () => {
        eq(toLaTeX('fixed(x, 2)'), '\\text{fixed}\\left(x, 2\\right)');
        eq(toText('fixed(x, 2)'), 'fixed(x, 2)');
        eq(toSpeech('fixed(x, 2)'), 'x, written to 2 decimal places');
        eq(toSpeech('fixed(x, 0)'), 'x, written as a whole number');
        eq(toJavaScript('fixed(x, 2)'), 'Number(x).toFixed(2)');
        eq(toJavaScript('fixed(x + 1, n)'), 'Number(x + 1).toFixed(n)');
        eq(toPython('fixed(x, 2)'), "format(x, '.2f')");
        eq(toPython('fixed(x, n)'), "format(x, '.' + str(n) + 'f')");
        eq(toPython('fixed(x, 2)', { numpy: true }), "np.char.mod('%.2f', x)");
        eq(toSQL('fixed(x, 2)'), 'ROUND(CAST(x AS NUMERIC), 2)');
        eq(toSQL('fixed(x, 2)', { dialect: 'sqlite' }), "printf('%.2f', x)");
        eq(toExcel('fixed(x, 2)'), '=FIXED(x, 2)');
        eq(toGLSL('fixed(x, 2)'), toGLSL('round(x, 2)'));
        eq(toMathML('fixed(x, 2)').replace(/ id="mz-\d+"/g, ''), '<math><mrow><mi>fixed</mi><mo>(</mo><mi>x</mi><mo>,</mo><mn>2</mn><mo>)</mo></mrow></math>');
    });
    test('the JavaScript and Excel spellings read back', () => {
        eq(parse(toJavaScript('fixed(x + 1, 2)')), ['x', '1', '+', '2', 'fixed']);
        eq(parse('=FIXED(A1, 3)'), ['A1', '3', 'fixed']);
        eq(parse('=FIXED(A1)'), ['A1', '2', 'fixed']);
    });
});

suite('piecewise: a ?: is a cases block in every maths display', () => {
    test('a case nobody wrote (unchanged) is not drawn or read out; code keeps it', () => {
        const input = 'f(x)=\\begin{cases}x & x>0\\\\-x & x\\le 0\\end{cases}';
        eq(toLaTeX(parse(input)), 'f\\left(x\\right) = \\begin{cases}x & \\text{if } x > 0 \\\\ -x & \\text{if } x \\leq 0 \\end{cases}');
        eq(toMathML(parse(input)).includes('otherwise'), false);
        eq(toMathML(parse(input)).includes('unchanged'), false);
        eq(toSpeech(parse('if x > 0 then 1')), 'if x is greater than 0, then 1');
        eq(toJavaScript(parse('if x > 0 then 1')), '(x > 0 ? 1 : unchanged)');
        // a written otherwise row stays
        eq(toLaTeX(parse('x > 0 ? 1 : 0')).includes('\\text{otherwise}'), true);
    });
    test('beside = or another relation it needs no brackets (the brace groups it); in a sum or product it keeps them', () => {
        const mml = (x) => toMathML(parse(x)).replace(/ id="mz-\d+"/g, '');
        eq(toLaTeX(parse('y = (x > 0 ? 1 : 0)')), 'y = \\begin{cases}1 & \\text{if } x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}');
        eq(mml('y = (x > 0 ? 1 : 0)').startsWith('<math><mrow><mi>y</mi><mo>=</mo><mrow><mo>{</mo>'), true);
        eq(toLaTeX(parse('y < (x > 0 ? 1 : 0)')).includes('\\left('), false);
        eq(toLaTeX(parse('2 \\cdot (x > 0 ? 1 : 0)')), '2\\left(\\begin{cases}1 & \\text{if } x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}\\right)');
        eq(toLaTeX(parse('(x > 0 ? 1 : 0) + 1')).startsWith('\\left(\\begin{cases}'), true);
        // code still needs them: y == x > 0 ? 1 : 0 would mean (y == x > 0) ? 1 : 0
        eq(toJavaScript(parse('y = (x > 0 ? 1 : 0)')), 'y == (x > 0 ? 1 : 0)');
        eq(toPython(parse('y = (x > 0 ? 1 : 0)')), 'y == (1 if x > 0 else 0)');
    });
    const cases = 'x > 0 ? 1 : x < 0 ? -1 : 0';
    test('LaTeX flattens an else-chain into one cases', () => {
        eq(toLaTeX(cases), '\\begin{cases}1 & \\text{if } x > 0 \\\\ -1 & \\text{if } x < 0 \\\\ 0 & \\text{otherwise} \\end{cases}');
    });
    test('MathML draws a brace and a table', () => {
        const out = toMathML(cases).replace(/ id="mz-\d+"/g, '');
        eq(out.includes('<mo>{</mo><mtable'), true);
        eq((out.match(/<mtr>/g) || []).length, 3);
        eq(out.includes('<mtext>otherwise</mtext>'), true);
    });
    test('text and code keep the ternary', () => {
        eq(toText(cases), 'x > 0 ? 1 : x < 0 ? -1 : 0');
        eq(toJavaScript('x > 0 ? x : -x'), '(x > 0 ? x : -x)');
    });
});

suite('strict equality shows as = in every maths display', () => {
    test('LaTeX, MathML and speech write =; text and JavaScript keep ===', () => {
        eq(toLaTeX('a === b'), 'a = b');
        eq(toMathML('a === b').replace(/ id="mz-\d+"/g, ''), '<math><mrow><mi>a</mi><mo>=</mo><mi>b</mi></mrow></math>');
        eq(toSpeech('a === b'), 'a equals b');
        eq(toText('a === b'), 'a === b');
        eq(toJavaScript('a === b'), 'a === b');
    });
});

suite('a derivative of a sum is bracketed in every display', () => {
    test('LaTeX, MathML and text bracket x² + 1; sin x needs none', () => {
        eq(toLaTeX('d/dx(x^2+1)'), '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left[x^2 + 1\\right]');
        eq(toMathML('d/dx(x^2+1)').replace(/ id="mz-\d+"/g, ''), '<math><mrow><mfrac><mi>d</mi><mrow><mi>d</mi><mi>x</mi></mrow></mfrac><mrow><mo>[</mo><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></mrow><mo>]</mo></mrow></mrow></math>');
        eq(toMathML('d/dx(sin(x))').replace(/ id="mz-\d+"/g, '').includes('<mo>['), false);   // a function call needs none; a product does, like LaTeX
        eq(toText('d/dx(x^2+1)'), 'd/dx(x^2 + 1)');
    });
});

suite('renderer fixes', () => {
    test('division keeps its brackets in code', () => {
        eq(toJavaScript('(a+b)/(c+d)'), '(a + b) / (c + d)');
        eq(toPython('a/(b/c)'), 'a / (b / c)');
        eq(toSQL('(a+b)/(c+d)'), '(a + b) / (c + d)');
        eq(toText('a/(b*c)'), 'a / (b * c)');
    });
    test('Python exponents keep their brackets', () => {
        eq(toPython('2^(x+1)'), '2 ** (x + 1)');
        eq(toPython('e^(2x)'), 'math.e ** (2 * x)');
    });
    test('implicit products never glue a sign or a digit', () => {
        eq(toLaTeX('2*(-3)'), '2 \\cdot -3');
        eq(toLaTeX('3*2^x'), '3 \\cdot 2^x');
        eq(toLaTeX('2x'), '2x');
        eq(toLaTeX('5 sin(x)'), '5\\sin\\left(x\\right)');
    });
    test('a Greek command is separated from a following letter', () => eq(toLaTeX('2*pi*r'), '2\\pi r'));
    test('Greek letters become commands', () => eq(toLaTeX('α+β'), '\\alpha + \\beta'));
    test('membership keeps both sides', () => {
        eq(toLaTeX('x ∈ S'), 'x \\in S');
        eq(toJavaScript('x ∈ S'), 'S.includes(x)');
        eq(toJavaScript('x ∈ [0, 1)'), '(x >= 0 && x < 1)');
        eq(toPython('2 ∉ {1, 3}'), '2 not in {1, 3}');
    });
    test('comparisons bracket weaker operators', () => eq(toLaTeX('(a|b)>c'), '\\left(a \\lor b\\right) > c'));
    test('factorials', () => {
        eq(toJavaScript('5!'), '5 * 4 * 3 * 2 * 1');
        eq(toPython('(5!)^2'), '(5 * 4 * 3 * 2 * 1) ** 2');
        eq(toLaTeX('(5!)!'), '\\left(5!\\right)!');
        eq(new Function(`return ${toJavaScript('!7!')}`)(), false);
    });
    test('reciprocal trig functions evaluate', () => eq(toJavaScript('sec(x)'), '1 / Math.cos(x)'));
    test('constants', () => {
        eq(toJavaScript('∞'), 'Infinity');
        eq(toSQL('pi'), 'PI()');
        eq(toPython('true'), 'True');
    });
    test('compound derivatives are bracketed', () => {
        eq(toLaTeX('der(x^2+1,x)'), '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left[x^2 + 1\\right]');
        eq(toLaTeX('der(sin(x),x)'), '\\frac{\\mathrm{d}}{\\mathrm{d}x}{\\sin\\left(x\\right)}');
    });
});

suite('MathML ids', () => {
    test('every token has one element, id = postfix index', () => {
        const postfix = parse('x^2+3x');   // x 2 ^ 3 x * +
        const mathml = toMathML(postfix);
        for (let i = 0; i < postfix.length; i++) {
            eq(mathml.split(`id="mz-${i}"`).length, 2, `mz-${i}`);
        }
    });
    test('variadic counts get no element', () => {
        const mathml = toMathML('max(1,2)');   // 1 2 2 max
        eq(mathml.includes('id="mz-2"'), false);
        eq(mathml.includes('id="mz-3"'), true);
    });
    test('text is escaped', () => eq(toMathML('a<b').includes('&lt;'), true));
    test('toUnified fills the id map', () => {
        toUnified(parse('x+1'));
        eq(getMathMLIdMap().get('mz-0').latex, 'x');
        eq(getMathMLIdMap().get('mz-2').latex, 'x + 1');
    });
});

suite('LaTeX hooks', () => {
    test('wrap tags every node', () => {
        const tagged = toLaTeX(parse('x+1'), { wrap: (n, s) => `\\htmlId{mz-${n.id}}{${s}}` });
        eq(tagged, '\\htmlId{mz-2}{\\htmlId{mz-0}{x} + \\htmlId{mz-1}{1}}');
    });
});

suite('LaTeX round trip', () => {
    // Rendering to LaTeX and parsing it back should give the same postfix.
    const inputs = [
        '3x^2+2x-1', 'sin(x)^2', 'sqrt(x^2+1)', '\\sqrt[3]{x}', 'e^(3x)', 'ln(x^2+1)', 'x/(x+1)',
        '(x^2+1)^5', 'abs(x-1)', 'floor(x)+ceil(y)', 'max(1,2,3)', 'log_2(x)', 'a-(b-c)', '(a^b)^c',
        'x ≤ 3', '2 ∈ {1, 2, 3}', 'x_1+x_2', 'n!', '\\binom{5}{2}', 'cos(2x)', 'tan(x)', '-x^2',
    ];
    for (const input of inputs) {
        test(input, () => eq(parse(toLaTeX(input)), parse(input)));
    }
});

suite('calculus display', () => {
    test('Leibniz derivatives', () => {
        eq(toLaTeX('dy/dx'), '\\frac{\\mathrm{d}y}{\\mathrm{d}x}');
        eq(toLaTeX('\\frac{d^2y}{dx^2}'), '\\frac{\\mathrm{d}^{2}y}{\\mathrm{d}x^{2}}');
        eq(toText('dy/dx'), 'dy/dx');
    });
    test('primes and inverses', () => {
        eq(toLaTeX("f'(x)"), "f'\\left(x\\right)");
        eq(toLaTeX("y''"), "y''");
        eq(toLaTeX('f^{-1}(x)'), 'f^{-1}\\left(x\\right)');
        eq(toJavaScript("f'(x)"), 'f_prime(x)');
    });
    test('no needless signs or brackets', () => {
        eq(toLaTeX('-x^2'), '-x^2');
        eq(toLaTeX('-(a+b)'), '-\\left(a + b\\right)');
        eq(toLaTeX('-\\frac{1}{x}'), '-\\frac{1}{x}');
        eq(toLaTeX('x^2 + 2xy + y^2'), 'x^2 + 2xy + y^2');
        eq(toLaTeX('2\\sec^2(2x)'), '2\\sec\\left(2x\\right)^2');
        eq(toLaTeX('\\frac{a}{b}\\cdot\\frac{c}{d}'), '\\frac{a}{b} \\cdot \\frac{c}{d}');
        eq(toLaTeX('2\\frac{1}{3}'), '2 \\cdot \\frac{1}{3}');   // not the mixed number 2⅓
    });
    test('Δx and ∞', () => {
        eq(toLaTeX('\\frac{\\Delta y}{\\Delta x}'), '\\frac{\\Delta y}{\\Delta x}');
        eq(toLaTeX('\\lim_{x\\to\\infty} 1/x'), '\\lim_{x\\to \\infty}{\\frac{1}{x}}');
    });
});

suite('not in', () => {
    test('every spelling means ∉', () => {
        for (const s of ['x ∉ S', 'x \\notin S', 'x \\not\\in S', 'x not in S', 'x Not In S']) eq(parse(s), ['x', 'S', '∉'], s);
    });
    test('in each format', () => {
        eq(toPython('x not in {1, 2}'), 'x not in {1, 2}');
        eq(toPython('x \\notin [0, 1)'), 'not (x >= 0 and x < 1)');
        eq(toText('x \\notin \\mathbb{R}'), 'x ∉ ℝ');
        eq(toMathML('x ∉ S').includes('<mo>∉</mo>'), true);
    });
});

suite('generated code', () => {
    test('a compound upper bound is still a bound, not a loop condition', () => {
        const js = toJavaScript('\\sum_{i=1}^{n+1} i');
        eq(js.includes('i<=n + 1'), true, js);
        eq(new Function('n', 'return ' + js)(3), 10);
    });
    test('log base e renders as ln from postfix too', () => eq(toLaTeX(['e', 'x', 'log']), '\\ln\\left(x\\right)'));
    test('the id map is lazy but complete', () => {
        toUnified(parse('x^2+1'));
        const part = getMathMLIdMap().get('mz-2');
        eq(Object.keys(part), ['latex', 'mathml', 'javascript', 'python', 'sql', 'exp', 'speech', 'glsl', 'op', 'postfix']);
        eq(JSON.parse(JSON.stringify(part)).javascript, 'Math.pow(x, 2)');
    });
});

suite('speech', () => {
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
    test('empty input', () => eq(toSpeech([]), ''));
});

suite('speech segments', () => {
    test('pauses are attached to words, never pieces of their own', () => {
        const segments = toSpeechSegments(parse('\\frac{x+1}{x-1} + 2'));
        eq(segments.every((s) => s.text.trim() && !s.text.startsWith(',')), true, JSON.stringify(segments));
        eq(segments.map((s) => s.text).join(' '), toSpeech('\\frac{x+1}{x-1} + 2'));
    });
});

suite('MathML decorations', () => {
    test('\\boxed, \\cancel, bars and accents are drawn as what they are, not as functions', () => {
        const m = (s) => toMathML(parse(s)).replace(/ id="mz-\d+"/g, '');
        eq(m('\\boxed{x}'), '<math><mrow><menclose notation="box"><mi>x</mi></menclose></mrow></math>');
        eq(m('\\cancel{x}'), '<math><mrow><menclose notation="updiagonalstrike"><mi>x</mi></menclose></mrow></math>');
        eq(m('\\overline{x}'), '<math><mrow><mover accent="true"><mi>x</mi><mo>¯</mo></mover></mrow></math>');
        eq(m('\\underline{x}'), '<math><mrow><munder accentunder="true"><mi>x</mi><mo>_</mo></munder></mrow></math>');
        eq(m('\\vec{v}'), '<math><mrow><mover accent="true"><mi>v</mi><mo>→</mo></mover></mrow></math>');
        eq(m('\\hat{x} + 1').includes('<mover accent="true"><mi>x</mi><mo>^</mo></mover>'), true);
    });
    test('a function that happens to have no decoration name is still a call', () => {
        eq(toMathML(parse('f(x)')).replace(/ id="mz-\d+"/g, ''), '<math><mrow><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo></mrow></math>');
    });
});

suite('audio speech: the grouping in the words, for a listener who cannot see the maths', () => {
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
    test('the video reading is untouched, and simple maths reads the same both ways', () => {
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

suite('GLSL', () => {
    test('numbers are floats', () => {
        eq(toGLSL('1/2'), '1.0 / 2.0');
        eq(toGLSL('.5x + 3'), '0.5 * x + 3.0');
        eq(toGLSL('-3'), '-3.0');
    });
    test('powers avoid pow() where it is undefined or slow', () => {
        eq(toGLSL('(r-0.5)^2'), 'mz_sq(r - 0.5)');
        eq(toGLSL('x^3'), 'mz_cube(x)');
        eq(toGLSL('x^-1'), '1.0 / x');
        eq(toGLSL('x^-2'), '1.0 / mz_sq(x)');
        eq(toGLSL('e^x'), 'exp(x)');
        eq(toGLSL('2^x'), 'exp2(x)');
        eq(toGLSL('x^{1/2}'), 'sqrt(x)');
        eq(toGLSL('x^y'), 'pow(x, y)');
        eq(toGLSL('\\sqrt[3]{x}'), 'mz_cbrt(x)');
    });
    test('functions, constants and degrees', () => {
        eq(toGLSL('\\ln x + \\log_2 x'), 'log(x) + log2(x)');
        eq(toGLSL('sin(2\\pi x)'), 'sin(2.0 * 3.141592653589793 * x)');
        eq(toGLSL('30°'), 'radians(30.0)');
        eq(toGLSL('atan2(y, x)'), 'atan(y, x)');
        eq(toGLSL('a mod b'), 'mod(a, b)');
        eq(toGLSL('round(x)'), 'mz_round(x)');
        eq(toGLSL('round(x)', { version: 300 }), 'round(x)');
        eq(toGLSL('sinh(x)', { version: 300 }), 'sinh(x)');
    });
    test('logic and conditions', () => {
        eq(toGLSL('x < 0.5 ? 0 : 1'), '(x < 0.5 ? 0.0 : 1.0)');
        eq(toGLSL('a & b | c'), '((a && b) || c)');
        eq(toGLSL('x ∈ [0, 1]'), '(x >= 0.0 && x <= 1.0)');
        eq(toGLSL('x ∈ {1, 2}'), '(x == 1.0 || x == 2.0)');
    });
    test('tuples are vectors', () => {
        eq(toGLSL('(r, g, b)'), 'vec3(r, g, b)');
        eq(toGLSL('±x'), 'vec2(x, -x)');
    });
    test('the helpers define what the output calls', () => {
        for (const fn of ['mz_sq', 'mz_cube', 'mz_cbrt', 'mz_round', 'mz_sinh', 'mz_asinh', 'mz_factorial', 'mz_gcd', 'MZ_INFINITY']) {
            eq(GLSL_HELPERS.includes(fn), true, fn);
        }
        eq(GLSL_HELPERS.includes('vec3 mz_sq(vec3 x)'), true);
    });
    test('empty input', () => eq(toGLSL([]), '0.0'));
});

suite('GLSL names and sets', () => {
    test('subscripts and Greek letters are identifiers', () => {
        eq(toGLSL('x_1 + x_2'), 'x_1 + x_2');
        eq(toGLSL('x_i'), 'x_i');
        eq(toGLSL('\\theta + \\Delta x'), 'theta + delta_x');
    });
    test('number sets are tests on the float', () => {
        eq(toGLSL('x ∈ \\mathbb{Z}'), '(fract(x) == 0.0)');
        eq(toGLSL('x \\notin \\mathbb{N}'), '!(fract(x) == 0.0 && x > 0.0)');
    });
});

suite('filter shaders', () => {
    const has = (text, part) => { if (!text.includes(part)) throw new Error(`missing ${JSON.stringify(part)}`); };
    const lacks = (text, part) => { if (text.includes(part)) throw new Error(`unexpected ${JSON.stringify(part)}`); };
    test('one expression sets the whole colour', () => {
        const shader = filterShader('(1 - r, 1 - g, 1 - b)');
        has(shader, 'uniform sampler2D image;');
        has(shader, 'uniform float t;');
        has(shader, 'color = mz_rgba(vec3(1.0 - r, 1.0 - g, 1.0 - b));');
        has(shader, 'gl_FragColor = color;');
    });
    test('channels are set separately, the rest unchanged', () => {
        const shader = filterShader({ r: 'if x < 0.5 then 1 - r', b: 'g' });
        has(shader, 'mz_keep(color.r, color);\n    color.r = mz_ch_r((x < 0.5 ? 1.0 - r : mz_unchanged(1.0 - r)));');
        has(filterShader('if gray > 0.5 then (1, 0, 0)'), 'mz_rgba((gray > 0.5 ? vec3(1.0, 0.0, 0.0) : mz_unchanged(vec3(1.0, 0.0, 0.0))))');
        has(filterShader('unchanged * 0.5'), 'mz_rgba(unchanged * 0.5)');
        has(shader, 'color.b = mz_ch_b(g);');
        if (shader.includes('color.g =')) throw new Error('g should be untouched');
    });
    test('px, py and the other shader names are words, not products', () => {
        has(filterShader('pixel(px + 8 sin(py / 10 + t / 5), py)'), 'mz_rgba(pixel(px + 8.0 * sin(py / 10.0 + t / 5.0), py))');
        has(filterShader('gray > 0.5'), 'mz_rgba(gray > 0.5)');
        has(filterShader('luma(px, py)', { names: ['luma'] }), 'luma(px, py)');
    });
    test('GLSL ES 3.0 uses texture() and an out variable', () => {
        const shader = filterShader('gray', { version: 300 });
        has(shader, '#version 300 es');
        has(shader, 'texture(image');
        has(shader, 'fragColor = color;');
        has(filterVertexShader({ version: 300 }), 'in vec2 position;');
        has(filterVertexShader(), 'attribute vec2 position;');
    });
    test('neighbourhood functions are added only when used', () => {
        const shader = filterShader('rgb + 1.5 (rgb - gaussian(2))');
        has(shader, 'vec3 gaussian(float sigma)');
        has(shader, 'mz_rgba(rgb + 1.5 * (rgb - gaussian(2.0)))');
        has(filterShader('if sobel() > 0.3 then 1 else 0'), '(sobel() > 0.3 ? 1.0 : 0.0)');
        has(filterShader('convolve(0, -1, 0, -1, 5, -1, 0, -1, 0)'), 'convolve(0.0, -1.0, 0.0, -1.0, 5.0, -1.0, 0.0, -1.0, 0.0)');
        has(filterShader({ r: 'gaussian(4)' }), 'color.r = mz_ch_r(gaussian(4.0));');     // a colour gives that channel
        lacks(filterShader('gray'), 'mz_tap');
        lacks(filterShader('blurry'), 'mz_tap');
    });
    test('an empty spec is an error', () => {
        let threw = false;
        try { filterShader({}); } catch { threw = true; }
        if (!threw) throw new Error('expected an error');
    });
});

suite('mathml without ids', () => {
    test('ids: false leaves out the id attributes', () => {
        eq(toMathML('x^2', { ids: false }), toMathML('x^2').replace(/ id="mz-\d+"/g, ''));
        eq(toMathML('x^2', { ids: false }).includes('id='), false);
    });
});

suite('excel', () => {
    test("a spreadsheet's own rules: minus before ^, ^ left to right, ATAN2(x, y), LOG(number, base)", () => {
        eq(toExcel('-x^2'), '=-(x^2)');
        eq(toExcel('2^3^2'), '=2^(3^2)');
        eq(toExcel('(-2)^x + x^{-1}'), '=(-2)^x+x^(-1)');
        eq(toExcel('atan2(y, x)'), '=ATAN2(x, y)');
        eq(toExcel('log_2(x) + \\ln y'), '=LOG(x, 2)+LN(y)');
    });
    test('logic is functions, choices are IF, sets are spelled out', () => {
        eq(toExcel('a and not b or c'), '=OR(AND(a, NOT(b)), c)');
        eq(toExcel('x > 0 ? sqrt(x) : 0'), '=IF(x>0, SQRT(x), 0)');
        eq(toExcel('x ∈ {1, 2, 3}'), '=OR(x=1, x=2, x=3)');
        eq(toExcel('x ∉ [0, 1)'), '=NOT(AND(x>=0, x<1))');
        eq(toExcel('n ∈ ℕ'), '=AND(n=INT(n), n>0)');
    });
    test('functions by their spreadsheet names; strings with doubled quotes', () => {
        eq(toExcel('n! / (k! (n-k)!) + \\binom{n}{k} + (x mod 7)'), '=FACT(n)/(FACT(k)*FACT(n-k))+COMBIN(n, k)+MOD(x, 7)');
        eq(toExcel('floor(x) + ceil(y) + e^x + \\sqrt[3]{x}'), '=INT(x)+-INT(-y)+EXP(x)+POWER(x, 1/3)');
        eq(toExcel('sec(x) + (a xor b)'), '=1/COS(x)+(NOT(a)<>NOT(b))');   // functions every spreadsheet has (not SEC, XOR)
        eq(toExcel('ceil(x / 2) * 3'), '=-INT(-(x/2))*3');
        eq(toExcel('name = "Ann \\"Jr\\""'), '=name="Ann ""Jr"""');
        eq(toExcel(parse('=name="Ann ""Jr"""')), '=name="Ann ""Jr"""');   // read back and written again: the same
    });
    test('cells and ranges', () => {
        eq(toExcel('Revenue - Cost', { cells: { Revenue: 'B2', Cost: 'C2' } }), '=B2-C2');
        eq(toExcel('Profit / sum(Profit)', { cells: (n) => ({ Profit: 'D7' }[n]), ranges: { Profit: 'D2:D101' } }), '=D7/SUM(D2:D101)');
        eq(toExcel('x + 1', { equals: false }), 'x+1');
    });
    test('what a spreadsheet has no formula for', () => {
        throws(() => toExcel('1/∞'), /No spreadsheet formula for ∞/);
        throws(() => toExcel('\\frac{d}{dx} x^2'), /No spreadsheet formula for a derivative/);
    });
    test('newer functions get _xlfn. in an .xlsx file, not in strings', () => {
        eq(forXlsxFile('=CEILING.MATH(x)+SEC(y)+LEN("CSC(")+XOR(a, b)'), '_xlfn.CEILING.MATH(x)+_xlfn.SEC(y)+LEN("CSC(")+_xlfn.XOR(a, b)');
    });
});

// ---- from filter-pictures.test.js ----
const has = (text, part) => { if (!text.includes(part)) throw new Error(`missing ${JSON.stringify(part)}`); };
const colour = (shader) => shader.split('\n').find((l) => l.includes('color = mz_rgba(')).trim();

suite('filter pictures: alpha outside, built-in names', () => {
    test('a geometry read as the whole colour keeps its alpha', () => {
        const shader = filterShader('zoom(0.5)');
        eq(colour(shader), 'color = mz_rgba(mz_sample_image(mz_zoom(0.5)));');
        has(shader, 'vec4 mz_sample_image(vec2 p)');
        eq(colour(filterShader('zoom(inset, 0.5)', { images: ['inset'] })), 'color = mz_rgba(mz_sample_inset(mz_zoom(0.5)));');
    });
    test('…but inside an expression it is a colour, with alpha() saying where the picture is', () => {
        eq(colour(filterShader('mix(rgb, zoom(0.5), 0.5)')), 'color = mz_rgba(mix(rgb, mz_at_image(mz_zoom(0.5)), 0.5));');
        eq(colour(filterShader('mix(rgb, zoom(0.5), alpha(zoom(0.5)))')), 'color = mz_rgba(mix(rgb, mz_at_image(mz_zoom(0.5)), alpha(mz_sample_image(mz_zoom(0.5)))));');
        eq(colour(filterShader('alpha(rotate(inset, 1))', { images: ['inset'] })), 'color = mz_rgba(alpha(mz_sample_inset(mz_rotate(1.0))));');
    });
    test('a bare picture as the whole colour keeps its alpha; as a channel it does not', () => {
        eq(colour(filterShader('inset', { images: ['inset'] })), 'color = mz_rgba(mz_px_inset);');
        has(filterShader({ r: 'inset' }, { images: ['inset'] }), 'color.r = mz_ch_r(inset);');
    });
    test("GLSL's own functions are calls, not letters", () => {
        eq(colour(filterShader('fract(x * 4)')), 'color = mz_rgba(fract(x * 4.0));');
        eq(colour(filterShader('step(0.5, gray)')), 'color = mz_rgba(step(0.5, gray));');
    });
});

suite('filter colour spaces', () => {
    const has = (text, part) => { if (!text.includes(part)) throw new Error(`missing ${JSON.stringify(part)}`); };
    test('conversion functions are calls, included when used', () => {
        const shader = filterShader('fromhsv((fract(red(tohsv(rgb)) + 0.1), green(tohsv(rgb)), blue(tohsv(rgb))))');
        has(shader, 'vec3 tohsv(vec3 c)');
        has(shader, 'mz_rgba(fromhsv(fract(red(tohsv(rgb)) + 0.1), green(tohsv(rgb)), blue(tohsv(rgb))))');   // a bracketed group is the call's arguments
        has(shader, 'vec3 fromhsv(float x, float y, float z)');
        if (filterShader('gray').includes('vec3 tohsv')) throw new Error('colour block included when unused');
    });
    test('in a space, pictures are converted as sampled and gray is still what is seen', () => {
        const shader = filterShader('mix(rgb, overlay, luma(mask))', { images: ['overlay', 'mask'], space: 'hsv' });
        has(shader, 'vec4 mz_sample_overlay(vec2 p) { vec4 v = mz_raw_overlay(p); v.rgb = tohsv(v.rgb); return v; }');
        has(shader, 'float gray = dot(fromhsv(rgb), vec3(0.299, 0.587, 0.114));');
        has(filterShader('source', { space: 'lab' }), 'vec4 mz_sample_source(vec2 p) { vec4 v = mz_raw_source(p); v.rgb = tolab(v.rgb); return v; }');
        let threw = false;
        try { filterShader('gray', { space: 'cmyk' }); } catch { threw = true; }
        eq(threw, true);
    });
});

suite('filter selection', () => {
    const has = (text, part) => { if (!text.includes(part)) throw new Error(`missing ${JSON.stringify(part)}`); };
    test('selected is the selection mask, declared only when used', () => {
        const shader = filterShader('mix(source, rgb, selected)');
        has(shader, 'uniform sampler2D mz_img_selection;');
        has(shader, 'float selected = mz_px_selection.r;');
        has(shader, 'mz_rgba(mix(source, rgb, selected))');
        if (filterShader('gray').includes('mz_img_selection')) throw new Error('declared when unused');
        has(filterShader('luma(selection(px + 2, py))'), 'luma(mz_sample_selection(px + 2.0, py))');   // a channel of a read keeps its alpha, as with zoom()
    });
    test('a selection is not converted into a colour space', () => {
        const shader = filterShader('(r, g, selected)', { space: 'hsv' });
        has(shader, 'vec4 mz_sample_selection(vec2 p) { vec2 q = p + 0.5; return texture2D(mz_img_selection');
        if (shader.includes('mz_raw_selection')) throw new Error('selection converted');
    });
});

// ---- added 2026-11-03 ----
suite('chains, text joins, %, expm1 in the outputs', () => {
    test('3 < x < 7 is both links in code; displays keep the chain', () => {
        eq(toJavaScript('3 < x < 7'), '(3 < x && x < 7)');
        eq(toPython('3 < x < 7'), '3 < x < 7');   // Python chains comparisons itself
        eq(toPython('3 < x < 7', { sympy: true }), 'sympy.And(3 < x, x < 7)');
        eq(toSQL('3 < x < 7'), '(3 < x AND x < 7)');
        eq(toExcel('3 < x < 7'), '=AND(3<x, x<7)');
        eq(toGLSL('3 < x < 7'), '(3.0 < x && x < 7.0)');
        eq(toLaTeX('3 < x < 7'), '3 < x < 7');
    });
    test('+ on text joins: || in SQL, & in spreadsheets', () => {
        eq(toSQL('"a"+"b"+"c"'), '"a" || "b" || "c"');
        eq(toSQL('"x"+1', { dialect: 'sqlite' }), "'x' || 1");
        eq(toExcel('"a"+"b"'), '="a"&"b"');
        eq(toSQL('1+2'), '1 + 2');
    });
    test('% is escaped in LaTeX (it starts a comment there)', () => {
        eq(toLaTeX('12%+23%=35%'), '12\\% + 23\\% = 35\\%');
    });
    test('expm1 is drawn as (eˣ − 1) in MathML, as in LaTeX', () => {
        eq(toMathML('expm1(x)').replace(/ id="mz-\d+"/g, ''), '<math><mrow><mo>(</mo><msup><mi>e</mi><mrow><mi>x</mi></mrow></msup><mo>−</mo><mn>1</mn><mo>)</mo></mrow></math>');
    });
    test('indexed sums in text read back as indexed', () => {
        eq(toText('\\sum_{i=1}^{n} i^2'), 'sum(i^2, i = 1, n)');
        eq(parse(toText('\\sum_{i=1}^{n} i^2')).join(' '), 'i 2 ^ i 1 = n 3 \\sumidx');
    });
});

suite('output options', () => {
    test('toLaTeX wrap is called on every node, innermost first', () => {
        const seen = [];
        const out = toLaTeX('x^2+1', { wrap: (node, latex) => { seen.push(latex); return `{\\color{red}${latex}}`; } });
        eq(seen[0], 'x');
        eq(out.startsWith('{\\color{red}'), true);
        eq(seen.length, 5);   // x, 2, x^2, 1, the sum
    });
    test('MathML ids are postfix indexes, on calculus, piecewise, binomials and roots too', () => {
        for (const input of ['d/dx(x^2+1)', 'x > 0 ? x : -x', 'comb(5, 2)', 'root(3, x)', '\\int_0^1 x dx']) {
            const ids = [...toMathML(input).matchAll(/id="mz-(\d+)"/g)].map((m) => Number(m[1]));
            const n = parse(input).length;
            eq(ids.includes(n - 1), true, `${input}: the root node is tagged`);
            eq(ids.every((i) => i >= 0 && i < n), true, `${input}: ids are postfix indexes`);
        }
    });
    test('toSQL: string quotes and quoted identifiers', () => {
        eq(toSQL('cost + tax', { quoteIdentifiers: true }), '"cost" + "tax"');
        eq(toSQL('name = "Bob"', { stringQuote: "'" }), "name = 'Bob'");
    });
});
