/**
 * Math for the eye: LaTeX, MathML and text — brackets, piecewise, calculus, ids and hooks — and the entries that
 * give every format at once (convert(), the default export, toUnified() and its id map).
 */
import { suite, test, eq, throws } from '../harness.js';
import mathZetta, {
    MathZetta, convert, evaluate, fromPostfix, getMathMLIdMap, parse, parseSteps, resetIdTracking, toAudioSpeech,
    toExcel, toGLSL, toJavaScript, toLaTeX, toMathML, toPython, toSQL, toSpeech, toText, toUnified,
} from '../../src/all.js';

suite('all: convert(), every format by name', () => {
    const input = 'x^2+1';
    test('every format and its alias', () => {
        eq(convert(input, 'javascript'), 'Math.pow(x, 2) + 1');
        eq(convert(input, 'js'), 'Math.pow(x, 2) + 1');
        eq(convert(input, 'python'), 'x ** 2 + 1');
        eq(convert(input, 'py'), 'x ** 2 + 1');
        eq(convert(input, 'latex'), 'x^2 + 1');
        eq(convert(input, 'tex'), 'x^2 + 1');
        eq(convert(input, 'mathml'), convert(input, 'mml'));
        eq(convert(input, 'mathml').startsWith('<math>'), true);
        eq(convert(input, 'speech'), 'x squared plus 1');
        eq(convert(input, 'glsl'), 'mz_sq(x) + 1.0');
        eq(convert(input, 'sql'), 'POWER(x, 2) + 1');
        eq(convert(input, 'excel'), '=x^2+1');
        eq(convert(input, 'sheets'), '=x^2+1');
        eq(convert(input, 'text'), 'x^2 + 1');
    });
    test('the same as each renderer', () => {
        eq(convert(input, 'latex'), toLaTeX(input));
        eq(convert(input, 'mathml'), toMathML(input));
        eq(convert(input, 'python'), toPython(input));
        eq(convert(input, 'sql'), toSQL(input));
        eq(convert(input, 'excel'), toExcel(input));
        eq(convert(input, 'glsl'), toGLSL(input));
        eq(convert(input, 'text'), toText(input));
        eq(convert(input, 'speech'), toSpeech(input));
    });
    test('format names are case-insensitive', () => {
        eq(convert(input, 'JS'), convert(input, 'js'));
        eq(convert(input, 'LaTeX'), convert(input, 'latex'));
    });
    test('takes postfix and trees too', () => {
        eq(convert(['x', '1', '+'], 'latex'), 'x + 1');
        eq(convert(fromPostfix(['x', '1', '+']), 'python'), 'x + 1');
    });
    test('an unknown format is refused by name', () => {
        throws(() => convert(input, 'bogus'), /^Unsupported format: bogus$/);
        throws(() => convert(input), /^Unsupported format: undefined$/);
        throws(() => convert(input, 'constructor'), /Unsupported format/);
    });
});

suite('all: the default export', () => {
    test('parses, then JavaScript by default', () => {
        eq(mathZetta('x^2+1'), 'Math.pow(x, 2) + 1');
        eq(mathZetta('x^2+1'), toJavaScript('x^2+1'));
    });
    test('any format convert() takes', () => {
        eq(mathZetta('x^2+1', 'latex'), 'x^2 + 1');
        eq(mathZetta('\\frac{1}{2}', 'py'), '1 / 2');
        throws(() => mathZetta('x', 'bogus'), /Unsupported format/);
    });
    test('MathZetta holds everything, convert included', () => {
        eq(MathZetta.convert, convert);
        eq(MathZetta.toUnified, toUnified);
        eq(MathZetta.resetIdTracking, resetIdTracking);
        eq(typeof MathZetta.parse, 'function');
        eq(typeof MathZetta.calculate, 'function');
        eq(typeof MathZetta.strToFunction, 'function');
    });
});

suite('all: toUnified() and the id map', () => {
    test('every format at once', () => {
        const u = toUnified('x+1');
        eq(Object.keys(u).sort(), ['exp', 'glsl', 'javascript', 'latex', 'mathml', 'op', 'postfix', 'python', 'speech', 'sql']);
        eq(u.latex, 'x + 1');
        eq(u.javascript, 'x + 1');
        eq(u.python, 'x + 1');
        eq(u.sql, 'x + 1');
        eq(u.exp, 'x + 1');
        eq(u.speech, 'x plus 1');
        eq(u.glsl, 'x + 1.0');
        eq(u.op, '+');
        eq(u.postfix, ['x', '1', '+']);
        eq(u.mathml, '<math><mrow id="mz-2"><mi id="mz-0">x</mi><mo>+</mo><mn id="mz-1">1</mn></mrow></math>');
    });
    test('a format that cannot be written is empty, not an error', () => {
        const u = toUnified('d/dx x^2');   // no JavaScript or SQL for a derivative
        eq(u.javascript, '');
        eq(u.sql, '');
        eq(u.latex !== '', true);
    });
    test('the empty postfix array', () => {
        eq(toUnified([]), {
            latex: '', mathml: '<math><mi>empty</mi></math>', javascript: '0', python: '0', sql: '0',
            exp: '', speech: '', glsl: '0.0', op: '', postfix: [],
        });
        eq(getMathMLIdMap().size, 0);
    });
    test('the id map: one entry per node, with every format of that subexpression', () => {
        toUnified('x+1');
        const map = getMathMLIdMap();
        eq([...map.keys()].sort(), ['mz-0', 'mz-1', 'mz-2']);
        eq(map.get('mz-0').latex, 'x');
        eq(map.get('mz-1').postfix, ['1']);
        eq(map.get('mz-2').speech, 'x plus 1');
    });
    test('resetIdTracking() empties it; the next toUnified() replaces it', () => {
        toUnified('x+1');
        eq(getMathMLIdMap().size, 3);
        resetIdTracking();
        eq(getMathMLIdMap().size, 0);
        toUnified('a');
        eq([...getMathMLIdMap().keys()], ['mz-0']);
        resetIdTracking();
    });
});

suite('display: piecewise, a ?: is a cases block in every math display', () => {
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

suite('display: strict equality shows as = in every math display', () => {
    test('LaTeX, MathML and speech write =; text and JavaScript keep ===', () => {
        eq(toLaTeX('a === b'), 'a = b');
        eq(toMathML('a === b').replace(/ id="mz-\d+"/g, ''), '<math><mrow><mi>a</mi><mo>=</mo><mi>b</mi></mrow></math>');
        eq(toSpeech('a === b'), 'a equals b');
        eq(toText('a === b'), 'a === b');
        eq(toJavaScript('a === b'), 'a === b');
    });
});

suite('display: a derivative of a sum is bracketed in every display', () => {
    test('LaTeX, MathML and text bracket x² + 1; sin x needs none', () => {
        eq(toLaTeX('d/dx(x^2+1)'), '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left[x^2 + 1\\right]');
        eq(toMathML('d/dx(x^2+1)').replace(/ id="mz-\d+"/g, ''), '<math><mrow><mfrac><mi>d</mi><mrow><mi>d</mi><mi>x</mi></mrow></mfrac><mrow><mo>[</mo><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></mrow><mo>]</mo></mrow></mrow></math>');
        eq(toMathML('d/dx(sin(x))').replace(/ id="mz-\d+"/g, '').includes('<mo>['), false);   // a function call needs none; a product does, like LaTeX
        eq(toText('d/dx(x^2+1)'), 'd/dx(x^2 + 1)');
    });
});

suite('LaTeX: products, Greek letters, brackets, %, ln from postfix', () => {
    test('implicit products never glue a sign or a digit', () => {
        eq(toLaTeX('2*(-3)'), '2 \\cdot -3');
        eq(toLaTeX('3*2^x'), '3 \\cdot 2^x');
        eq(toLaTeX('2x'), '2x');
        eq(toLaTeX('5 sin(x)'), '5\\sin\\left(x\\right)');
    });
    test('a Greek command is separated from a following letter', () => eq(toLaTeX('2*pi*r'), '2\\pi r'));
    test('Greek letters become commands', () => eq(toLaTeX('α+β'), '\\alpha + \\beta'));
    test('comparisons bracket weaker operators', () => eq(toLaTeX('(a|b)>c'), '\\left(a \\lor b\\right) > c'));
    test('compound derivatives are bracketed', () => {
        eq(toLaTeX('der(x^2+1,x)'), '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left[x^2 + 1\\right]');
        eq(toLaTeX('der(sin(x),x)'), '\\frac{\\mathrm{d}}{\\mathrm{d}x}{\\sin\\left(x\\right)}');
    });
    test('% is escaped in LaTeX (it starts a comment there)', () => {
        eq(toLaTeX('12%+23%=35%'), '12\\% + 23\\% = 35\\%');
    });
    test('log base e renders as ln from postfix too', () => eq(toLaTeX(['e', 'x', 'log']), '\\ln\\left(x\\right)'));
    test('prod(a + b, c) and sum terms are bracketed in the drawn formats', () => {
        const pf = ['a', 'b', '+', 'c', '2', 'prod'];
        eq(toLaTeX(pf), '\\left(a + b\\right) \\cdot c');
        eq(toText(pf), '(a + b) * c');
    });
});

// KaTeX is not a dependency here (it is not in node_modules), so this checks the LaTeX's shape, not a KaTeX run
suite('LaTeX: a root index KaTeX can read', () => {
    test('a root index holding ] is braced, so it does not end the index', () => {
        eq(toLaTeX(['x', '0', '5', '2', '(]', '∈', '3', '2', '?:', 'y', 'root']).startsWith('\\sqrt[{'), true);
        eq(toLaTeX('root(3, x)'), '\\sqrt[3]{x}');
    });
});

suite('LaTeX: the wrap hook', () => {
    test('wrap tags every node', () => {
        const tagged = toLaTeX(parse('x+1'), { wrap: (n, s) => `\\htmlId{mz-${n.id}}{${s}}` });
        eq(tagged, '\\htmlId{mz-2}{\\htmlId{mz-0}{x} + \\htmlId{mz-1}{1}}');
    });
});

suite('LaTeX: what it writes reads back to the same postfix', () => {
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

suite('display: calculus', () => {
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
    });
    test('Δx and ∞', () => {
        eq(toLaTeX('\\frac{\\Delta y}{\\Delta x}'), '\\frac{\\Delta y}{\\Delta x}');
        eq(toLaTeX('\\lim_{x\\to\\infty} 1/x'), '\\lim_{x\\to \\infty}{\\frac{1}{x}}');
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

suite('MathML: without ids', () => {
    test('ids: false leaves out the id attributes', () => {
        eq(toMathML('x^2', { ids: false }), toMathML('x^2').replace(/ id="mz-\d+"/g, ''));
        eq(toMathML('x^2', { ids: false }).includes('id='), false);
    });
});

suite('MathML: expm1, and ids on calculus, piecewise, binomials and roots', () => {
    test('expm1 is drawn as (eˣ − 1) in MathML, as in LaTeX', () => {
        eq(toMathML('expm1(x)').replace(/ id="mz-\d+"/g, ''), '<math><mrow><mo>(</mo><msup><mi>e</mi><mrow><mi>x</mi></mrow></msup><mo>−</mo><mn>1</mn><mo>)</mo></mrow></math>');
    });
    test('MathML ids are postfix indexes, on calculus, piecewise, binomials and roots too', () => {
        for (const input of ['d/dx(x^2+1)', 'x > 0 ? x : -x', 'comb(5, 2)', 'root(3, x)', '\\int_0^1 x dx']) {
            const ids = [...toMathML(input).matchAll(/id="mz-(\d+)"/g)].map((m) => Number(m[1]));
            const n = parse(input).length;
            eq(ids.includes(n - 1), true, `${input}: the root node is tagged`);
            eq(ids.every((i) => i >= 0 && i < n), true, `${input}: ids are postfix indexes`);
        }
    });
});

suite('display: hooks, text that reads back, compound variables', () => {
    test('toLaTeX wrap is called on every node, innermost first', () => {
        const seen = [];
        const out = toLaTeX('x^2+1', { wrap: (node, latex) => { seen.push(latex); return `{\\color{red}${latex}}`; } });
        eq(seen[0], 'x');
        eq(out.startsWith('{\\color{red}'), true);
        eq(seen.length, 5);   // x, 2, x^2, 1, the sum
    });
    test("LaTeX's wrap hook keeps its own backslashes (a - (-1·x) was sliced)", () => {
        eq(toLaTeX('a - (-1*x)', { wrap: (n, s) => `\\htmlId{mz-${n.id}}{${s}}` }), '\\htmlId{mz-4}{\\htmlId{mz-0}{a} + \\htmlId{mz-2}{x}}');
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
    test('indexed sums in text read back as indexed', () => {
        eq(toText('\\sum_{i=1}^{n} i^2'), 'sum(i^2, i = 1, n)');
        eq(parse(toText('\\sum_{i=1}^{n} i^2')).join(' '), 'i 2 ^ i 1 = n 3 \\sumidx');
    });
    test('the id map is lazy but complete', () => {
        toUnified(parse('x^2+1'));
        const part = getMathMLIdMap().get('mz-2');
        eq(Object.keys(part), ['latex', 'mathml', 'javascript', 'python', 'sql', 'exp', 'speech', 'glsl', 'op', 'postfix']);
        eq(JSON.parse(JSON.stringify(part)).javascript, 'Math.pow(x, 2)');
    });
});

suite('display: a product typed with · or × keeps its sign where the output can show it', () => {
    test('LaTeX writes \\cdot and \\times as typed, even where the product would read without a sign', () => {
        eq(toLaTeX('a \\times b'), 'a \\times b');
        eq(toLaTeX('u \\times v \\cdot w'), 'u \\times v \\cdot w');
        eq(toLaTeX('2 \\cdot x'), '2 \\cdot x');
        eq(toLaTeX('3 × 10^8'), '3 \\times 10^8');
        eq(toLaTeX('2x'), '2x', 'a product typed without a sign is unchanged');
        eq(toLaTeX(parse('a \\times b')), 'ab', 'plain postfix has no marks: an ordinary product');
    });
    test('MathML: × and ⋅ as typed; invisible times otherwise', () => {
        eq(toMathML('a \\times b').includes('<mo>×</mo>'), true);
        eq(toMathML('a \\cdot b').includes('<mo>⋅</mo>'), true);
        eq(toMathML('a b').includes('<mo>\u2062</mo>'), true);
    });
    test('text writes · and ×, and reads back with the same marks', () => {
        eq(toText('u \\times v \\cdot w'), 'u × v · w');
        eq(parseSteps(toText('u \\times v \\cdot w')).written, parseSteps('u \\times v \\cdot w').written);
        eq(toText('a*b'), 'a * b');
    });
    test('speech: dot and cross between vectors, times for any other typed sign', () => {
        eq(toSpeech('\\vec{u} \\times \\vec{v}'), 'vector u cross vector v');
        eq(toAudioSpeech('\\vec{u} \\cdot \\vec{v}'), 'vector u dot vector v');
        eq(toSpeech('\\hat{u} \\times \\vec{v}'), 'u hat cross vector v');
        eq(toSpeech('3 \\times 10^8'), '3 times 10 to the eighth', 'numbers: times, not cross');
        eq(toSpeech('u \\times v'), 'u times v');
        eq(toSpeech('u v'), 'u v', 'no sign typed: none read');
        eq(toSpeech('\\vec{u} \\times \\vec{v}', { words: { cross: 'cross product' } }), 'vector u cross product vector v');
    });
    test('code outputs ignore the marks: a product is a product', () => {
        eq(toJavaScript('a \\times b'), toJavaScript('a*b'));
        eq(toPython('a \\cdot b'), toPython('a*b'));
        eq(toSQL('a \\times b'), toSQL('a*b'));
    });
});

suite('display: a derivative at a point, der(f, x = a), the bar and the point', () => {
    test('LaTeX: \\left. … \\right|_{x=a}, and it reads back', () => {
        eq(toLaTeX('der(x^3, x = 2)'), '\\left.\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left[x^3\\right]\\right|_{x=2}');
        eq(toLaTeX('der(y, x = 0)'), '\\left.\\frac{\\mathrm{d}y}{\\mathrm{d}x}\\right|_{x=0}');
        for (const s of ['der(x^3, x = 2)', 'der(x^3 + 2x, x = a)', 'der(x^3, x = 2, 2)', 'der(y, x = 0)']) eq(parse(toLaTeX(s)), parse(s), s);
    });
    test('text writes der(f, x = a) (and der(f, x = a, n)), which reads back', () => {
        eq(toText('der(x^3, x = 2)'), 'der(x^3, x = 2)');
        eq(toText('der(x^3, x = a, 2)'), 'der(x^3, x = a, 2)');
        eq(parse(toText('der(x^3, x = a, 2)')), parse('der(x^3, x = a, 2)'));
    });
    test('MathML: a bar with the point below it; the copied variable carries no id', () => {
        const m = toMathML('der(x^3, x = 2)');
        eq(m.includes('<mo stretchy="true">|</mo>'), true);
        eq(new Set(m.match(/id="[^"]*"/g)).size, m.match(/id="[^"]*"/g).length, 'no id twice');
    });
    test('speech: ", at x equals a"', () => {
        eq(toSpeech('der(x^3, x = 2)'), 'the derivative with respect to x of x cubed, at x equals 2');
        eq(toSpeech('der(x^3, x = 2, 2)'), 'the second derivative with respect to x of x cubed, at x equals 2');
    });
    test('SymPy differentiates, then puts the point in; JavaScript still refuses a derivative', () => {
        eq(toPython('der(x^3, x = 2)', { sympy: true }), 'sympy.diff(x ** 3, x).subs(x, 2)');
        throws(() => toJavaScript('der(x^3, x = 2)'));
    });
});

suite('display: LaTeX letters that would run into a word', () => {
    test('with no command, a product of letters keeps a space where three would run together (TeX draws it as nothing)', () => {
        eq(toLaTeX('x d x'), 'xd x');
        eq(toLaTeX('r a t e'), 'ra te');
        eq(toLaTeX('x y'), 'xy', 'two letters read back as a product already');
        for (const t of ['x d x', 'r a t e', '2 a b c', 'a*b*c*d']) eq(parse(toLaTeX(t)), parse(t), `${t} reads back`);
    });
    test('with a command, letters multiply anyway: no spaces', () => {
        eq(toLaTeX('\\frac{rate}{time}'), '\\frac{rate}{time}');
        eq(parse(toLaTeX('\\frac{rate}{time}')), parse('\\frac{rate}{time}'));
    });
});
