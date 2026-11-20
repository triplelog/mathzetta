/**
 * npm test — no browser needed: checks the HTML strings and the tree tools.
 * Looks are checked by eye on the gallery (inlinemath.com; the website's dev server, ?shot for the gallery alone).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { toHTML, treeOf, select, signature, nodeAt, pathOf, numberTree, shouldAnimate } from '../src/index.js';
import { parseTree, fromPostfix, walk } from '../src/mathzetta.js';
import { toMathML } from 'mathzetta/mathml';
import { toText } from 'mathzetta/text';   // what a page passes to view.editable   // what a page passes as { mathml } (Inline Math does not import it)

let passed = 0;
const failures = [];
const pending = [];   // async tests: the report waits for them
function test(name, fn) {
    const fail = (e) => failures.push(`${name}\n    ${String(e?.message ?? e).split('\n').join('\n    ')}`);
    try {
        const result = fn();
        if (result && typeof result.then === 'function') pending.push(Promise.resolve(result).then(() => { passed++; }, fail));
        else passed++;
    } catch (e) {
        fail(e);
    }
}

/** Text a reader would see, without tags. */
const text = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const has = (html, cls) => html.includes(`mv-${cls}`);
const ids = (html) => new Set([...html.matchAll(/data-node="(\d+)"/g)].map((m) => Number(m[1])));

// ---- every Calculus I input renders, and its parts are addressable ---------------

const cases = readFileSync(new URL('test/cases/calculus.tsv', import.meta.resolve('mathzetta/package.json')), 'utf8')   // the mathzetta source beside this package
    .split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(1).map((l) => l.split('\t')[0]).filter(Boolean);   // # lines are notes, then the header

for (const input of cases) {
    test(`renders ${input}`, () => {
        const tree = treeOf(input);
        const html = toHTML(tree);
        assert.equal(html, toHTML(tree), 'same input, same output');
        assert.equal((html.match(/<span/g) || []).length, (html.match(/<\/span>/g) || []).length, 'balanced spans');
        // Every variable and number the reader sees is its own element.
        const drawn = ids(html);
        walk(tree, (n, parent) => {
            if (n.type === 'op' || n.value === '-1' && parent?.op === '*') return;
            if (parent?.op === 'der') return;     // dx, d²/dx²: drawn by the derivative
            assert.ok(drawn.has(n.id), `node ${n.id} (${n.value}) has no element`);
        });
    });
}

// ---- notation ----------------------------------------------------------------------

test('sin x without brackets, sin(x + 1) with', () => {
    assert.equal(text(toHTML('sin(x)')), 'sinx');
    assert.ok(has(toHTML('sin(x)'), 'fnspace'));
    assert.match(text(toHTML('sin(x+1)')), /sin.*x\+1/);
    assert.ok(has(toHTML('sin(x+1)'), 'fence'));
    assert.ok(!has(toHTML('sin(2x)'), 'fence'), 'sin 2x');
    assert.ok(!has(toHTML('ln|x|'), 'fnspace') || !toHTML('ln|x|').includes('M0.92'), 'ln|x| has no round brackets');
    assert.ok(has(toHTML('sin(x)', { fnParens: 'always' }), 'fence'));
});

test('sin(x)·y keeps brackets, sin x cos x needs none', () => {
    assert.ok(has(toHTML('sin(x) y'), 'fence'));
    assert.ok(!has(toHTML('sin(x)cos(x)'), 'fence'));
});

test('sin²x, and sin⁻¹x on request', () => {
    const html = toHTML('sin(x)^2');
    assert.ok(html.indexOf('sin') < html.indexOf('>2<'), 'exponent after the name');
    assert.ok(!has(html, 'fence'));
    assert.ok(has(toHTML('sin(x)^2', { trigPowers: false }), 'fence'));
    assert.match(text(toHTML('arcsin(x)')), /^arcsinx$/);
    assert.match(text(toHTML('arcsin(x)', { inverseTrig: 'power' })), /^sin−1x$/);
});

const { casBlocks: casBlocksAtPoint } = await import('../src/cas.js');
test('a derivative at a point: the bar, the point below it, no id twice; the CAS works it out exactly', () => {
    const html = toHTML('der(x^3, x = 2)');
    assert.equal(text(html), 'ddxx3x=2');
    assert.ok(has(html, 'vert'), 'the bar');
    const ids = [...html.matchAll(/data-node="(\d+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, new Set(ids).size, 'the copied variable has no id');
    assert.match(html, /aria-label="the derivative with respect to x of x cubed, at x equals 2"/);
    assert.equal(text(toHTML('{{der(x^3 sin(x), x = 2)}}', { blocks: casBlocksAtPoint() })), '8cos2+12sin2');
    assert.equal(text(toHTML('{{diff(x^3, x = 2, 2)}}', { blocks: casBlocksAtPoint() })), '12');
});

test('a choice of equations reads in words; other logic keeps its signs', () => {
    assert.equal(text(toHTML('x = 2 | x = 3')), 'x=2orx=3');
    assert.ok(has(toHTML('x = 2 | x = 3'), 'conj'));
    assert.equal(text(toHTML(['x', '1', '=', 'x', '2', '=', '|', 'x', '3', '=', '|'])), 'x=1orx=2orx=3');
    assert.equal(text(toHTML('x > 0 & x < 1')), 'x>0andx<1');
    assert.equal(text(toHTML('a | b')), 'a∨b');
    assert.equal(text(toHTML('x < 0 & y | z')), 'x<0∧y∨z', 'one side not a statement: signs');
    assert.equal(text(toHTML('x ≠ 1 | x ∈ A')), 'x≠1orx∈A');
    // mixed words keep the grouping
    assert.ok(has(toHTML('(x = 1 | x = 2) & y = 3'), 'fence'));
    assert.ok(has(toHTML('x = 1 | (x = 2 & y = 3)'), 'fence'));
    assert.ok(!has(toHTML(['x', '1', '=', 'x', '2', '=', '|', 'x', '3', '=', '|']), 'fence'));
});

test('a product typed with · or × shows its sign; one typed without shows none', () => {
    assert.equal(text(toHTML('a \\times b')), 'a×b');
    assert.equal(text(toHTML('a \\cdot b')), 'a·b');
    assert.equal(text(toHTML('\\vec{u} \\times \\vec{v}')).replace('→', '').replace('→', ''), 'u×v');
    assert.equal(text(toHTML('3 × 10^8')), '3×108');
    assert.equal(text(toHTML('a b')), 'ab');
    assert.equal(text(toHTML(['a', 'b', '*'])), 'ab', 'postfix carries no marks');
    assert.match(toHTML('\\vec{u} \\times \\vec{v}'), /aria-label="vector u cross vector v"/);
    // edit in place writes the part as text and reads it back: the sign survives
    const tree = treeOf('u \\times v + w');
    assert.equal(tree.args[0].written, 'cross');
    assert.equal(text(toHTML(treeOf(toText(tree)))), 'u×v+w');
});

test('fractions in exponents use a slash', () => {
    assert.equal(text(toHTML('x^{3/2}')), 'x3/2');
    assert.ok(has(toHTML('x^{(n+1)/(n-1)}'), 'frac'), 'compound parts stack');
    assert.ok(has(toHTML('x^{1/2}', { scriptFractions: 'stack' }), 'frac'));
    assert.equal(text(toHTML('e^{-x^2/2}')), 'e−x2/2', 'a leading minus on top takes no brackets');
});

test('a + (−1·b) reads a − b; a + (−3) reads a − 3; a − (−b) keeps brackets', () => {
    assert.equal(text(toHTML(['a', '-1', 'b', '*', '+'])), 'a−b');
    assert.equal(text(toHTML(['a', '-3', '+'])), 'a−3');
    assert.ok(has(toHTML(['a', 'b', 'neg', '-']), 'fence'));
});

test('integral limits, sum limits, limit below', () => {
    const integral = toHTML('\\int_0^1 x^2 dx');
    assert.ok(has(integral, 'intsign') && has(integral, 'limits') && has(integral, 'dx'));
    assert.ok(has(toHTML('\\sum_{n=1}^{\\infty} 1/n^2'), 'bigop'));
    assert.ok(has(toHTML('\\sum_{n=1}^{\\infty} 1/n^2', { display: false }), 'subsup'), 'inline: limits as scripts');
    assert.ok(has(toHTML('\\lim_{x\\to 0} \\sin x / x'), 'under'));
});

test('piecewise from ?: and decorations from \\boxed etc.', () => {
    const html = toHTML('x < 0 ? -x : x');
    assert.ok(has(html, 'cases'));
    assert.match(text(html), /if.*otherwise/);
    assert.ok(has(toHTML('x < 0 ? -x : x', { cases: false }), 'bin'));
    for (const [input, cls] of [['\\boxed{x}', 'boxed'], ['\\cancel{x}', 'cancel'], ['\\overline{z}', 'over'], ['\\vec{v}', 'accent']]) {
        assert.ok(has(toHTML(input), cls), input);
    }
    // a mark over a letter with no ascender comes down to it; each accent can be styled on its own
    assert.ok(has(toHTML('\\hat{u}'), 'accent-low') && has(toHTML('\\hat{u}'), 'accent-hat'));
    assert.ok(has(toHTML('\\vec{\\alpha}'), 'accent-low'), 'short Greek letters too');
    assert.ok(!has(toHTML('\\hat{A}'), 'accent-low') && !has(toHTML('\\vec{h}'), 'accent-low') && !has(toHTML('\\hat{2}'), 'accent-low'));
    assert.ok(has(toHTML('\\overline{z}'), 'over-low') && !has(toHTML('\\overline{A}'), 'over-low'));
});

test('fonts.css: every file it names is in fonts/, and the Greek faces cover only Greek', () => {
    const css = readFileSync(new URL('../fonts/fonts.css', import.meta.url), 'utf8');
    for (const [, file] of css.matchAll(/url\("([^"]+)"\)/g)) assert.ok(nodeFs.existsSync(new URL(`../fonts/${file}`, import.meta.url)), file);
    const greek = [...css.matchAll(/@font-face \{[^}]*inlinemath-greek[^}]*\}/g)].map((m) => m[0]);
    assert.equal(greek.length, 2, 'regular and italic');
    for (const face of greek) assert.match(face, /unicode-range: U\+0391-03A9, U\+03B1-03C9/);
    assert.ok(css.lastIndexOf('inlinemath-greek') > css.lastIndexOf('lmroman'), 'declared after Latin Modern, so tried first for Greek');
});

test('every delimiter kind draws', () => {
    for (const input of ['(x+1)^2', '[0, 1)', '\\{1, 2\\}', '|x|', '\\lfloor x \\rfloor', '\\lceil x \\rceil', '\\binom{n}{k}']) {
        assert.ok(has(toHTML(input), 'fence'), input);
    }
});

test('tall content gets tall brackets and a deeper fraction', () => {
    const short = toHTML('(x+1)^2');
    const tall = toHTML('(\\frac{1}{x})^2');
    assert.ok(!/padding:0\.1em/.test(short) && /padding:0\.1em/.test(tall));
});

test('{{blocks}} are calculated before drawing', () => {
    assert.equal(text(toHTML('3+4={{3+4}}')), '3+4=7');
    assert.ok(has(toHTML('x = {{1/3 + 1/6}}'), 'frac'), 'an exact fraction is drawn as one');
    const exact = toHTML('\\sin(\\pi/4) = {{\\sin(\\pi/4)}}');
    assert.equal(text(exact), 'sinπ4=22', 'the block is √2/2: a root over 2');
    assert.ok(has(exact.slice(exact.lastIndexOf('mv-rel')), 'sqrt') && has(exact.slice(exact.lastIndexOf('mv-rel')), 'frac'));
    assert.equal(text(toHTML('y = {{a b}}', { scope: { a: 2, b: 3 } })), 'y=6');
    assert.match(text(toHTML('1/0 = {{1/0}}')), /undefined/);
});

test('the whole expression has its spoken form as its accessible name', () => {
    const html = toHTML('x^2 + 1');
    assert.match(html, /^<span class="mv mv-display" role="math" aria-label="x squared plus 1"><span aria-hidden="true" class="mv-n/);
    assert.match(toHTML('x', { label: 'the unknown' }), /aria-label="the unknown"/);
    assert.match(toHTML('x', { label: (tree) => `tree with ${tree.id + 1} nodes` }), /aria-label="tree with 1 nodes"/);
    assert.ok(!toHTML('x', { label: false }).includes('aria-'));
    assert.match(toHTML('\\int_0^1 x^2 dx'), /aria-label="the integral from 0 to 1 of x squared, d x"/);
    // the label is for a listener who can't see the drawing: the grouping is in the words
    const label = (input) => toHTML(input).match(/aria-label="([^"]*)"/)[1];
    assert.equal(label('\\sqrt{x+1}+2'), 'the square root of the quantity x plus 1, end root, plus 2');
    assert.notEqual(label('\\sqrt{x+1}'), label('\\sqrt{x}+1'));
    assert.notEqual(label('x_{n+1}'), label('x_n+1'));
    // mathml: the expression as hidden MathML a screen reader can walk, in place of the label
    const withMathML = toHTML('\\sqrt{x+1} + \\cancel{y}', { mathml: toMathML });
    assert.match(withMathML, /<math class="mv-sr-math" display="block"><mrow><msqrt>/);
    assert.match(withMathML, /<menclose notation="updiagonalstrike"><mi>y<\/mi><\/menclose>/);
    assert.ok(!/ id="mz-/.test(withMathML), 'no ids in the hidden MathML');
    assert.ok(!/aria-label=/.test(withMathML) && !/role="math"/.test(withMathML), 'MathML replaces the label');
    assert.match(withMathML, /^<span class="mv mv-display"><span aria-hidden="true" /);
    assert.ok(!/<math/.test(toHTML('x^2')), 'off by default');
});

// ---- addressing ---------------------------------------------------------------------

test('select by id, expression, path and test', () => {
    const tree = parseTree('x^2 + 2x + x^2');
    assert.equal(select(tree, 'x^2').length, 2);
    assert.equal(select(tree, 1)[0].value, '2');
    assert.equal(select(tree, { path: [0, 1] })[0].op, '*');
    assert.equal(select(tree, (n) => n.type === 'number').length, 3);
    assert.equal(select(tree, ['2x', 'x^2']).length, 3);
    assert.equal(signature(nodeAt(tree, [0, 1])), '2 x *');
    assert.deepEqual(pathOf(tree, select(tree, '2x')[0].id), [0, 1]);
});

test('colors and highlight options', () => {
    const html = toHTML('x^2 + 2x', { colors: { '2x': 'red' }, highlight: 'x^2' });
    assert.match(html, /style="color:red" data-node="\d+" data-op="\*"/);
    assert.match(html, /class="mv-n mv-op mv-op-pow mv-hl"/);
});

test('numberTree gives the ids MathZetta gives', () => {
    for (const input of ['\\int_0^1 x^2 dx', 'max(a, b, c) + f(x, y)', '\\sum_{i=1}^n i']) {
        const tree = parseTree(input);
        const copy = structuredClone(tree);
        walk(copy, (n) => { delete n.id; });
        assert.deepEqual(numberTree(copy), tree, input);
    }
    assert.deepEqual(numberTree({ type: 'op', op: '+', args: [{ type: 'symbol', value: 'a' }, { type: 'number', value: '1' }] }),
        fromPostfix(['a', '1', '+']));
});

test('a rewrite site from @mathzetta/cas highlights by path', () => {
    // @mathzetta/cas speaks the same postfix, so its child-index paths are Inline Math's paths.
    const postfix = 'x 2 ^ e x ^ * x der'.split(' ');
    const tree = treeOf(postfix);
    assert.equal(tree.op, 'der');
    assert.equal(nodeAt(tree, [0, 1]).op, '^');
    const html = toHTML(postfix, { highlight: { path: [0, 0] } });
    assert.match(html, /mv-hl" data-node="\d+" data-op="\^"/);
    assert.match(text(html), /ddx/);
});

// ---- the CAS (inlinemath/cas) ------------------------------------------------------------

const { casBlocks, stepsHTML, mathCAS, tokensOf } = await import('../src/cas.js');
const engineModule = await import('@mathzetta/cas/engine');

test('{{…}} blocks simplify, solve, differentiate and integrate with the CAS', () => {
    const blocks = casBlocks();
    const drawn = (s) => text(toHTML(s, { blocks }));
    assert.equal(drawn('{{simplify(sin(x)^2 + cos(x)^2)}}'), '1');
    assert.equal(drawn('{{diff(x^3, x)}}'), '3x2');
    assert.equal(drawn('{{d/dx x^2}}'), '2x');
    assert.equal(drawn('{{\\int x^2 dx}}'), 'x33');
    assert.equal(drawn('{{integrate(x^2, x, 0, 3)}}'), '9');
    assert.equal(drawn('{{solve(x^2 - 5x + 6 = 0, x)}}'), 'x=2orx=3');
    assert.equal(drawn('{{factor(x^2 - 1)}}'), 'x−1x+1');
    assert.equal(drawn('{{approx(pi, 20)}}'), '3.1415926535897932385');
    assert.equal(drawn('{{solve(x^2 = -1, x)}}'), 'no solution');
});

test('other blocks are still the calculator', () => {
    const blocks = casBlocks();
    assert.equal(text(toHTML('{{3+4}}', { blocks })), '7');
    assert.equal(text(toHTML('{{sqrt(8)}}', { blocks })), text(toHTML('{{sqrt(8)}}')));
});

test('stepsHTML: each step drawn, the rewritten part highlighted, explained', () => {
    const r = mathCAS().diff('x^2 sin(x)', 'x');
    const html = stepsHTML(r.steps);
    assert.equal((html.match(/class="mv-step"/g) || []).length, r.steps.length);
    assert.ok(html.includes('mv-hl'), 'a highlighted part');
    assert.ok(html.includes('mv-step-why'), 'explanations');
    assert.ok(!stepsHTML(mathCAS().diff('x^2 sin(x)', 'x', { steps: { explain: false } }).steps).includes('mv-step-why'));
});

test('complex numbers: arithmetic, Re/Im/conj, solving, drawn', () => {
    const blocks = casBlocks({ cas: mathCAS({ complex: true }) });
    const drawn = (s) => text(toHTML(s, { blocks }));
    assert.equal(drawn('{{simplify((2+3i)(1-i))}}'), '5+i');
    assert.equal(drawn('{{simplify(Re(3+4i) + |3+4i|)}}'), '8');
    assert.equal(drawn('{{solve(x^2 + 2x + 5 = 0, x)}}'), 'x=−1−2iorx=−1+2i');
    const { parse: postfix } = engineModule;
    assert.ok(toHTML(tokensOf(postfix('z conj'))).includes('mv-over'), 'the conjugate is drawn with an overline');
    assert.equal(text(toHTML(tokensOf(postfix('z re')))), 'Rez');
});

test('a CAS with rules of your own, and names for your functions', () => {
    const cas = mathCAS({ names: ['sinc'], rules: ['operators:\n  - { symbol: sinc, arity: 1 }\nrules:\n  - { id: sinc-0, pattern: 0 sinc, output: "1" }\n'] });
    assert.equal(text(toHTML('{{simplify(sinc(0) + 1)}}', { blocks: casBlocks({ cas }) })), '2');
});

test('the core imports only what every page maps (mathzetta, mathzetta/speech, mathzetta/calculate)', () => {
    const { readdirSync } = nodeFs;
    for (const file of readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'cas.js')) {
        const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // comments mention imports too
        // every form: multi-line `import { … } from`, `export … from`, `import 'x'`, `import('x')`, either quote
        const bare = [
            ...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*(['"])([^'"]+)\1/gm),
            ...source.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm),
            ...source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1/g),
        ].map((m) => m[2]).filter((name) => !name.startsWith('.'));
        for (const name of bare) assert.ok(['mathzetta', 'mathzetta/speech', 'mathzetta/calculate'].includes(name), `${file} imports '${name}': pages using Inline Math would need it in their import map`);
    }
});

// ---- Markdown with math (inlinemath/markdown) -------------------------------------------

const { markdownToHTML, extractMath } = await import('../src/markdown.js');
const spoken = (html) => [...html.matchAll(/class="mv-md-(?:math|display)"(?: data-mv-md="\d+")?><span[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);

test('markdown: which dollars are math', () => {
    const pieces = (t) => extractMath(t).math.map((m) => `${m.display ? 'D' : 'I'}:${m.source}`);
    assert.deepEqual(pieces('a $x^2$ b $$y$$ c'), ['I:x^2', 'D:y']);
    assert.deepEqual(pieces('it costs $5 and $10'), []);
    assert.deepEqual(pieces('$ x$ and $x $'), []);
    assert.deepEqual(pieces('a \\$ sign, $a$'), ['I:a']);
    assert.deepEqual(pieces('code `$x$` and\n```\n$y$\n```\n'), []);
    assert.deepEqual(pieces('\\(a\\) and \\[b\\]'), ['I:a', 'D:b']);
    assert.deepEqual(pieces('```math\nx^2\n```'), ['D:x^2']);
    assert.deepEqual(pieces('$a\n\nb$'), [], 'not across paragraphs');
    assert.deepEqual(pieces('$\\$5$'), ['I:\\$5']);
    assert.deepEqual(extractMath('$a$ $$b$$', { delimiters: ['$$'] }).math.map((m) => m.source), ['b']);
});

test('markdown: math drawn inline and on its own, worked out, remembered', () => {
    const html = markdownToHTML('The area is $\\pi r^2$; for $r = 3$ it is ${{pi r^2}}$.\n\n$$\\int_0^1 x^2 dx = {{\\int_0^1 x^2 dx}}$$');
    assert.deepEqual(spoken(html), ['pi r squared', 'r equals 3', '9 pi', 'the integral from 0 to 1 of x squared, d x equals one third']);
    assert.ok(html.includes('<div class="mv-md-block"><span class="mv-md-display" data-mv-md="3">'), 'display math is a block');
    assert.deepEqual(spoken(markdownToHTML('$r = 1/3$, ${{3r}}$')), ['r equals one third', '1'], 'definitions are exact');
    assert.deepEqual(spoken(markdownToHTML('$r = 3$ ${{r}}$', { define: false })), ['r equals 3', 'r'], 'define: false');
    const det = spoken(markdownToHTML('$A = \\begin{pmatrix} 2 & 1 \\\\ 1 & 3 \\end{pmatrix}$ ${{det(A)}}$'));
    assert.equal(det.at(-1), '5', 'a matrix definition is remembered');
    assert.deepEqual(spoken(markdownToHTML('${{a + 1}}$', { scope: { a: 2 } })), ['3']);
    assert.deepEqual(spoken(markdownToHTML('${{solve(x^2 = 4, x)}}$', { blocks: casBlocks() })), ['x equals negative 2 or x equals 2']);
});

test('markdown: a saved variable is not put in for the variable d/dx, ∫ … dx, lim or ∑ binds', () => {
    const t = (md) => text(markdownToHTML(md)).replace(/\s+/g, '');
    // a fixed x is a constant: d/dx x³ is drawn with x and left unworked; the point form is worked out
    assert.doesNotMatch(t('$x := [[1..5 = 2]]$ $\\frac{d}{dx} x^3 = {{\\frac{d}{dx} x^3}}$'), /12$/, 'd/dx x³ with x fixed: no number');
    assert.match(t('$x := [[1..5 = 2]]$ $\\frac{d}{dx} x^3$'), /ddxx3$/, 'drawn with x, not 2');
    assert.match(t('$a := [[1..5 = 2]]$ $der(x^3, x = a) = {{der(x^3, x = a)}}$'), /ddxx3x=2=12$/, 'der(f, x = a): the bar, the point at the slider\'s value, the slope');
    assert.match(t('$x := [[1..5 = 2]]$ $x^2$'), /22$/, 'outside, x is still its value');
    assert.match(t('$a := [[1..6 = 2]]$ $\\int_0^{a} x^2 dx$'), /20x2dx$/, 'a limit takes the value');
    assert.match(t('$x := [[1..6 = 2]]$ $\\int_0^{x} x^2 dx$'), /20x2dx$/, 'the variable of integration does not');
    assert.match(t('$k := [[1..6 = 3]]$ $\\sum_{k=1}^{4} k$'), /4k=1k$/, 'nor a sum\'s index');
    assert.match(t('$x := [[1..5 = 2]]$ $\\lim_{x \\to 0} x$'), /limx→0x$/, 'nor a limit\'s variable');
});

test('markdown: math that does not read is shown as written, with the reason', () => {
    const html = markdownToHTML('bad $\\frac{1$ here');
    assert.match(html, /<span class="mv-md-error" data-mv-md="0" title="[^"]+"><code>\$\\frac\{1\$<\/code><\/span>/);
});

test('markdown: the Markdown itself', () => {
    const html = markdownToHTML([
        '# Title', '', 'Setext', '===', '', 'A *b* **c** _d_ ~~e~~ `f` [g](https://g.org "G") ![h](h.png)', 'next line', '',
        '- one', '- two', '  1. three', '', '> quoted', '', '---', '', '    indented code', '', '| a | b |', '|:--|--:|', '| 1 | 2 |',
    ].join('\n'));
    for (const piece of ['<h1>Title</h1>', '<h1>Setext</h1>', '<em>b</em>', '<strong>c</strong>', '<em>d</em>', '<del>e</del>', '<code>f</code>',
        '<a href="https://g.org" title="G">g</a>', '<img src="h.png" alt="h">', '<ul>', '<ol>', '<li>three</li>', '<blockquote>', '<hr>',
        '<pre><code>indented code</code></pre>', '<th style="text-align:left">a</th>', '<td style="text-align:right">2</td>']) {
        assert.ok(html.includes(piece), `missing ${piece} in ${html}`);
    }
});

test('markdown: safe by default', () => {
    const html = markdownToHTML('<script>alert(1)</script> [x](javascript:alert(1)) <b>bold</b>');
    assert.ok(!html.includes('<script>') && !html.includes('javascript:') && html.includes('&lt;b&gt;'));
    assert.ok(markdownToHTML('<b>bold</b>', { html: true }).includes('<b>bold</b>'), 'html: true lets it through');
});

test('markdown: another renderer, with the math put back into its output', () => {
    const render = (md) => `<article>${md.replace(/\*(.+?)\*/g, '<i>$1</i>')}</article>`;
    const html = markdownToHTML('*so* $x^2$', { render });
    assert.ok(html.startsWith('<article><i>so</i> <span class="mv-md-math" data-mv-md="0">'));
});

test('markdown: saved variables — $A := 2+2$, then A is drawn as 2 + 2 and {{A}} is 4', () => {
    const all = (html) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(spoken(markdownToHTML('$A := 2+2$ then $A = {{A}}$')), ['A is defined as 2 plus 2', '2 plus 2 equals 4']);
    assert.ok(markdownToHTML('$A := 2+2$').includes('<span class="mv-rel mv-rel-def">≔</span>'), 'drawn with ≔');
    // $_…$ saves without drawing; a paragraph of nothing else leaves nothing behind
    const hidden = markdownToHTML('$_A := 2+2$\n\nthen $A={{A}}$, $3A$, $x^2 + A_1$');
    assert.ok(hidden.startsWith('<p>then '), hidden);
    assert.deepEqual(spoken(hidden), ['2 plus 2 equals 4', '3 times the quantity 2 plus 2', 'x squared plus A sub 1']);
    assert.deepEqual(spoken(markdownToHTML('$_A = x^2$ $A + 1$ ${{A}}$')), ['x squared plus 1', 'x squared'], 'no value: {{A}} is its expression');
    // in reading order, a variable may use another, and saving again replaces it
    assert.deepEqual(spoken(markdownToHTML('$_B := 2A$ $_A := 3$ $B$; $_A := 5$ $B = {{B}}$')), ['2 times 3', '2 times 5 equals 10']);
    assert.deepEqual(spoken(markdownToHTML('$A$ $_A := 1$')), ['A'], 'not before it is saved');
    assert.deepEqual(spoken(markdownToHTML('$_A := A + 1$ $A$')), ['A plus 1'], 'a name in its own definition stays');
    assert.deepEqual(spoken(markdownToHTML('$A_1 := 5$ $A_1 + A$')), ['A sub 1 is defined as 5', '5 plus A']);
    // = still only remembers a number for {{…}}: r is drawn as r
    assert.deepEqual(spoken(markdownToHTML('$r = 3$ $\\pi r^2 = {{pi r^2}}$')), ['r equals 3', 'pi r squared equals 9 pi']);
    assert.deepEqual(spoken(markdownToHTML('$g := 10$ ${{2g}}$')), ['g is defined as 10', '20']);
    assert.match(markdownToHTML('$_x$'), /mv-md-error[^>]*title="a hidden/, 'a $_…$ that saves nothing is an error');
    assert.deepEqual(all(markdownToHTML('$$_A := 2$$\n\n$A$')), ['2'], 'display math too');
});

test('markdown: inputs set variables — [[…]] is a textbox, [[a | b]] a dropdown, [[1..10]] a slider', () => {
    const text = markdownToHTML('$A := [[2+2]]$ $A = {{A}}$');
    assert.match(text, /≔<\/span><input type="text" class="mv-md-input mv-md-textbox" data-mv-var="A" aria-label="A" value="2\+2"/);
    assert.deepEqual(spoken(text), ['2 plus 2 equals 4']);
    const select = markdownToHTML('$f := [[x^2 | sin(x)]]$ $f$');
    assert.match(select, /<select class="mv-md-input mv-md-dropdown" data-mv-var="f" aria-label="f"><option value="x\^2" selected>x\^2<\/option><option value="sin\(x\)">sin\(x\)<\/option><\/select>/);
    assert.deepEqual(spoken(select), ['x squared']);
    const slider = markdownToHTML('$_n := [[1..10 = 4]]$ $n^2 = {{n^2}}$');
    assert.ok(slider.startsWith('<p><span class="mv-md-math mv-md-input-def" data-mv-md="0"><input type="range"'), 'hidden: the input alone');
    assert.match(slider, /min="1" max="10" step="1" value="4"><output class="mv-md-output" data-mv-out="n">4<\/output>/);
    assert.deepEqual(spoken(slider), ['4 squared equals 16']);
    assert.match(markdownToHTML('$_t := [[0..1 step 0.25]]$'), /min="0" max="1" step="0.25" value="0"/);
    assert.match(markdownToHTML('$_t := [[0..2]]$'), /step="1"/);
    assert.match(markdownToHTML('$_t := [[0..0.5]]$'), /step="0.005"/);
    assert.ok(markdownToHTML('$_A := [["><script>]]$').includes('value="&quot;&gt;&lt;script&gt;"'), 'escaped');
});

test('markdown: a store of variables shared between parts, and set from code', async () => {
    const { createVariables } = await import('../src/markdown.js');
    const v = createVariables();
    v.set('k', '7');
    assert.deepEqual(spoken(markdownToHTML('${{2k}}$ $k$', { variables: v })), ['14', '7']);
    assert.equal(v.get('k'), '7');
    const page = createVariables();
    page.own('first', new Map([['A', { name: 'A', text: '2+2', input: { kind: 'textbox', default: '2+2' }, key: 'input:A' }]]));
    let told = 0;
    page.subscribe(() => told++);
    page.set('A', 'x^2');
    assert.equal(page.get('A'), 'x^2', 'an input set');
    assert.deepEqual(spoken(markdownToHTML('$A + 1$', { variables: page })), ['x squared plus 1']);
    page.set('A', 'x^2');
    assert.equal(told, 1, 'no news when nothing changed');
    page.own('first', new Map([['A', { name: 'A', text: '3', input: { kind: 'textbox', default: '3' }, key: 'input:B' }]]));
    assert.equal(page.get('A'), '3', 'a different input forgets what the old one held');
    page.own('first', null);
    assert.equal(page.get('A'), undefined);
    assert.deepEqual(page.names(), []);
});

test('editing a part: replaced in the tree, a variable written back in its own terms', async () => {
    const { replaceAt } = await import('../src/edit.js');
    const { substitute, unexpand } = await import('../src/variables.js');
    const { parseTree, toPostfix } = await import('mathzetta');
    const pf = (t) => toPostfix(t).join(' ');
    const tree = parseTree('x^2 + 3x');
    assert.equal(pf(replaceAt(tree, [1], parseTree('7y'))), pf(parseTree('x^2 + 7y')));
    assert.equal(pf(replaceAt(tree, [], parseTree('1'))), '1', 'the whole expression');
    // B := 2A, A := x+1: the part drawn for B, written back, keeps A as A
    const defs = { A: parseTree('x+1'), B: parseTree('2A') };
    const { tree: drawn } = substitute(parseTree('B^2'), (n) => defs[n] ?? null);
    const b = drawn.args[0];
    assert.equal(b.from, 'B');
    assert.equal(pf(unexpand(b, (n) => parseTree(n))), pf(parseTree('2A')));
    assert.equal(extractMath('ab $x$ c $$y$$').math.map((m) => `${m.start}-${m.end}`).join(' '), '3-6 9-14', 'where each piece is');
    const { View } = await import('../src/view.js');
    assert.throws(() => Object.create(View.prototype).editable({}), /toText/);
});

test('markdown: CAS blocks see saved variables as their expressions, under any of their names', async () => {
    const { casBlocks: cas } = await import('../src/cas.js');
    const md = (t) => spoken(markdownToHTML(t, { blocks: cas() }));
    assert.deepEqual(md('${{der(x^2, x)}}$ ${{derivative(x^2, x)}}$ ${{integral(x^2, x)}}$'), ['2 x', '2 x', 'x cubed over 3']);
    assert.deepEqual(md("$_f := x^3 + 2x$ $f' = {{der(f, x)}}$"), ['f prime equals 3 x squared plus 2']);
    assert.deepEqual(md('$_a := 2$ $_g := a x^2$ ${{diff(g, x)}}$ ${{integrate(g, x, 0, 1)}}$'), ['4 x', 'two thirds'], 'a variable inside a variable');
    assert.deepEqual(md('$_p := x^2 - 4$ ${{solve(p = 0, x)}}$'), ['x equals negative 2 or x equals 2']);
});

test('matrices: a grid in brackets, rows addressable, worked out', () => {
    const html = toHTML('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}');
    assert.match(html, /class="mv-matrix" style="grid-template-columns:repeat\(2,auto\)/);
    assert.equal((html.match(/mv-matrix-cell/g) || []).length, 4);
    assert.match(html, /mv-n mv-op mv-op-list mv-matrix-row" data-node="\d+"/, 'a row is a node');
    assert.match(toHTML('\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}'), /mv-vert/, 'bars');
    assert.match(toHTML('[[1, 2], [3, 4]]'), /mv-matrix/, 'a list of lists is drawn as one');
    assert.doesNotMatch(toHTML('[[1, 2], [3]]'), /mv-matrix"/, 'rows of different lengths stay a list');
    assert.match(toHTML('{{bmatrix([1, 2], [3, 4])^2}}'), /aria-label="the 2 by 2 matrix, row 1: 7, 10, row 2: 15, 22"/);
    assert.deepEqual(spoken(markdownToHTML('$_M := [[2, 1], [1, 3]]$ $M^2 = {{M^2}}$ ${{det(M)}}$')),
        ['the 2 by 2 matrix, row 1: 2, 1, row 2: 1, 3, end matrix, squared equals the 2 by 2 matrix, row 1: 5, 5, row 2: 5, 10', '5']);
});

// ---- untrusted text, links, the CAS blocks (from a review before publishing) ---------------

{
    const { casBlocks, stepsHTML } = await import('../src/cas.js');
    const { PATHS } = await import('../src/glyphs.js');
    test('a definite integral in a block goes to the CAS: ∫ from 0 to a of x dx = a²/2', () => {
        const html = toHTML('{{\\int_0^a x dx}}', { blocks: casBlocks() });
        assert.ok(has(html, 'frac') || html.includes('mv-frac'), 'drawn as a fraction');
        assert.equal(text(html).replace(/\s/g, ''), 'a22');
    });
    test('a step whose rule id holds a quote keeps its attribute whole', () => {
        assert.ok(stepsHTML([{ id: 'a"b', name: 'n', from: 'x', to: 'x', path: [] }]).includes('data-rule="a&quot;b"'));
    });
    test('a color is one CSS value: anything else is left out', () => {
        assert.ok(toHTML('x', { colors: { x: 'crimson' } }).includes('color:crimson'));
        assert.ok(toHTML('x', { colors: { x: 'rgb(0 102 204 / 50%)' } }).includes('color:rgb(0 102 204 / 50%)'));
        for (const bad of ['red;background:url(https://example.com/x)', 'red" onmouseover="x', 'expression(alert(1))']) {
            assert.ok(!toHTML('x', { colors: { x: bad } }).includes('style='), bad);
        }
    });
    test('Markdown links and images may hold brackets in their address; script links still go nowhere', () => {
        assert.equal(markdownToHTML('[f](https://en.wikipedia.org/wiki/Function_(mathematics)) is'), '<p><a href="https://en.wikipedia.org/wiki/Function_(mathematics)">f</a> is</p>');
        assert.equal(markdownToHTML('![p](img_(1).png)'), '<p><img src="img_(1).png" alt="p"></p>');
        assert.equal(markdownToHTML('[a](javascript:alert(1))'), '<p><a href="#">a</a></p>');
    });
    test('PATHS are shapes, each filled or stroked', () => {
        for (const [name, shape] of Object.entries(PATHS)) assert.ok(typeof (shape.fill ?? shape.stroke) === 'string', name);
    });
}

// ---- the lite build: the same drawing, nothing live, the calculator only if asked for ----

{
    const lite = await import('../src/lite.js');
    const inputs = cases.filter((t) => !t.includes('{{'));   // blocks are what the two builds draw differently
    test('lite draws every Calculus I input exactly as the full build does', () => {
        for (const input of inputs) assert.equal(lite.toHTML(input), toHTML(input), input);
    });
    test('lite has toHTML and no live view, Markdown or CAS', () => {
        assert.equal(typeof lite.toHTML, 'function');
        for (const name of ['render', 'View', 'markdownToHTML', 'mathCAS']) assert.equal(name in lite, false, name);
    });
}
{
    // in a process of its own, so nothing else has loaded MathZetta's calculator
    const { execFileSync } = await import('node:child_process');
    const run = (entry) => execFileSync(process.execPath, ['--input-type=module', '-e',
        `import { toHTML } from ${JSON.stringify(new URL(`../src/${entry}.js`, import.meta.url).href)}; process.stdout.write(toHTML('3+4={{3+4}}'))`], { encoding: 'utf8' });
    test('lite leaves {{…}} blocks as written; lite-calc works them out', () => {
        const plain = text(run('lite'));
        assert.ok(plain.includes('3+4') || plain.includes('3 + 4'), plain);
        assert.ok(!/=\s*7/.test(plain), `lite calculated: ${plain}`);
        assert.ok(/=\s*7/.test(text(run('lite-calc'))), 'lite-calc draws 3 + 4 = 7');
    });
}

test('a case nobody wrote (unchanged) is not drawn; a written otherwise row is', () => {
    const unwritten = toHTML('f(x)=\\begin{cases}x & x>0\\\\-x & x\\le 0\\end{cases}');
    assert.equal((unwritten.match(/mv-case-value/g) || []).length, 2);
    assert.ok(!/otherwise|unchanged/.test(unwritten.replace(/aria-label="[^"]*"/, '')), 'no otherwise row');
    assert.match(toHTML('x > 0 ? 1 : 0'), /otherwise/);
});

test('a step animates unless the reader asked for reduced motion (or the page insists)', () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
    const prefer = (reduce) => { globalThis.matchMedia = (q) => ({ matches: reduce && q === '(prefers-reduced-motion: reduce)' }); };
    try {
        prefer(false);
        assert.equal(shouldAnimate(true), true);
        assert.equal(shouldAnimate(false), false);
        prefer(true);
        assert.equal(shouldAnimate(true), false);
        assert.equal(shouldAnimate('always'), true);
        delete globalThis.matchMedia;   // no matchMedia (Node, old browsers): animate as asked
        assert.equal(shouldAnimate(true), true);
    } finally {
        if (had) Object.defineProperty(globalThis, 'matchMedia', had); else delete globalThis.matchMedia;
    }
});

// ---- added 2026-11-11: what the review found ------------------------------------------------

/** The text with each fence as ⟨ — where brackets are drawn, which text() alone can't show. */
const fenced = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<span[^>]*mv-fence[^>]*>/g, '⟨').replace(/<[^>]+>/g, '');

test('drawings that meant something else: each pair is drawn apart', () => {
    const PAIRS = [
        ['-1(a+b)', '-1a+b'], ['c + -1(a+b)', 'c - a + b'], ['(-1*x)^2', '-1*x^2'],
        ['\\lim_{x\\to 0} (x+1)', '\\lim_{x\\to 0} x + 1'], ['\\sum_{i=1}^n (i+1)', '\\sum_{i=1}^n i + 1'],
        ['(\\sum_{i=1}^n i)^2', '\\sum_{i=1}^n i^2'], ['(\\int x dx)^2', '\\int x^2 dx'], ['(\\lim_{x\\to0} x)^2', '\\lim_{x\\to0} x^2'],
        ['(\\sum_{i=1}^n i) x', '\\sum_{i=1}^n i \\cdot x'], ['(a+b)_1', 'a+b_1'], ['x^{(1/2)n}', 'x^{1/(2n)}'],
    ];
    for (const [a, b] of PAIRS) {
        const A = fenced(toHTML(a, { label: false }));
        const B = fenced(toHTML(b, { label: false }));
        assert.notEqual(A, B, `${a} and ${b} are both drawn ${A}`);
    }
    assert.equal(fenced(toHTML(['a', 'b', '+', 'c', '2', 'prod'], { label: false })), '⟨a+b·c');
    assert.equal(fenced(toHTML('x^{1/2}', { label: false })), 'x1/2', 'a plain slash fraction takes no brackets');
});

test('names like toString are drawn as the names they are', () => {
    for (const name of ['toString', 'constructor', 'valueOf']) assert.equal(text(toHTML(name, { label: false })), name);
    assert.equal(text(toHTML(['__proto__'], { label: false })), '__proto__');
});

test('a tree made by hand may hold numbers as numbers', () => {
    assert.equal(text(toHTML({ type: 'op', op: '+', args: [{ type: 'number', value: 3 }, { type: 'symbol', value: 'x' }] }, { label: false })), '3+x');
});

test('markdown: links, images, emphasis and entities', () => {
    const md = (s) => markdownToHTML(s);
    assert.equal(md('[`toHTML()`](#api)'), '<p><a href="#api"><code>toHTML()</code></a></p>');
    assert.equal(md('[![build](https://img.example/b.svg)](https://ci.example)'), '<p><a href="https://ci.example"><img src="https://img.example/b.svg" alt="build"></a></p>');
    assert.equal(md('[a\\_b](#c)'), '<p><a href="#c">a_b</a></p>');
    assert.equal(md('[x](https://a.com/a\\_b)'), '<p><a href="https://a.com/a_b">x</a></p>');
    assert.equal(md('![graph of $x^2$](p.png)'), '<p><img src="p.png" alt="graph of $x^2$"></p>');
    assert.equal(md('[x](https://a.com "where $x>0$")'), '<p><a href="https://a.com" title="where $x&gt;0$">x</a></p>');
    assert.equal(md('***both***'), '<p><strong><em>both</em></strong></p>');
    assert.equal(md('***a** b*'), '<p><em><strong>a</strong> b</em></p>');
    assert.equal(md('***a* b**'), '<p><strong><em>a</em> b</strong></p>');
    assert.equal(md('&copy; &mdash; a&nbsp;b & c'), '<p>&copy; &mdash; a&nbsp;b &amp; c</p>');
    assert.equal(md('The year was\n1986. What a year.'), '<p>The year was\n1986. What a year.</p>');
    assert.ok(md('text\n1. one').includes('<ol>'), 'a list from 1 still interrupts');
});

test('markdown: typed placeholder characters are only characters', () => {
    for (const s of ['' + '0' + '', '' + '5' + ' and $x$', '$x$ and ' + '0' + ' again', '`code` ' + '0' + '']) {
        const html = markdownToHTML(s);
        assert.ok(!html.includes('undefined'), `${JSON.stringify(s)} → ${html}`);
        assert.equal((html.match(/mv-md-math/g) || []).length, s.includes('$x$') ? 1 : 0, `${JSON.stringify(s)}: the math drawn once`);
        assert.equal((html.match(/<code>/g) || []).length, s.includes('`') ? 1 : 0);
    }
});

test('markdown: math in an indented code block is code, and defines nothing', () => {
    const drawn = (s) => text(markdownToHTML(s).replace(/aria-label="[^"]*"/g, ''));
    assert.equal(drawn('    $_A := 5$\n\n$A + 1$'), '$_A := 5$\nA+1');
    assert.equal(drawn('$_A := 5$\n\n$A + 1$'), '5+1');
    assert.ok(drawn('- item\n\n    $x$ in the item').includes('x in the item'), 'inside a list item it is math');
});

test('markdown: long runs of $ and many saved variables stay fast', () => {
    let t = Date.now();
    extractMath('| item | $12.50 | $13.00 |\n'.repeat(8000));
    assert.ok(Date.now() - t < 300, `$ rows took ${Date.now() - t} ms`);
    const md = Array.from({ length: 200 }, (_, i) => `$A_{${i}} := ${i}+1$`).join('\n\n');
    t = Date.now();
    markdownToHTML(md);
    assert.ok(Date.now() - t < 300, `200 definitions took ${Date.now() - t} ms`);
    const page = '$A := 2$, $B := 3A$, so ${{B}}$ and $A := 5$ makes ${{B}}$';
    assert.match(text(markdownToHTML(page).replace(/aria-label="[^"]*"/g, '')), /so 6 and A≔5 makes 15/);
});

test('markdown: a definition is drawn as ≔ whatever the class prefix', () => {
    assert.ok(markdownToHTML('$A := 2+2$', { math: { prefix: 'zz' } }).includes('≔'));
});

/** Just enough DOM for a View: listeners, attributes, classes, a live region after the element. */
class FakeElement {
    constructor() { this.listeners = new Map(); this.attrs = {}; this.classes = new Set(); this.dataset = {}; }
    get classList() {
        const c = this.classes;
        return { add: (...x) => x.forEach((v) => c.add(v)), remove: (...x) => x.forEach((v) => c.delete(v)), contains: (v) => c.has(v) };
    }
    set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    count(type) { return this.listeners.get(type)?.size ?? 0; }
    set innerHTML(html) {
        this.html = html;
        const root = new FakeElement();
        root.querySelector = () => null;
        root.contains = () => true;
        const label = /aria-label="([^"]*)"/.exec(html);
        if (label) root.attrs['aria-label'] = label[1];
        this.firstElementChild = root;
    }
    insertAdjacentElement(where, element) { this.nextElementSibling = element; element.parent = this; }
    remove() { this.removed = true; if (this.parent && this.parent.nextElementSibling === this) this.parent.nextElementSibling = null; }
}

test('view: on() stops, destroy() stops everything, one live region per element, set() closes an open editor', async () => {
    const { View, render } = await import('../src/view.js');
    const hadDocument = 'document' in globalThis;
    globalThis.document = { createElement: () => new FakeElement() };
    try {
        const element = new FakeElement();
        const view = render(element, 'x + 1', { announce: true });
        const off = view.on('click', () => {});
        assert.equal(element.count('click'), 1);
        off();
        assert.equal(element.count('click'), 0);
        view.set('x + 2');
        assert.ok(!view.root.classes.has('mv-clickable'), 'a stopped handler leaves nothing clickable after set()');

        view.on('click', () => {});
        view.editable({ toText: String });
        const live = element.nextElementSibling;
        const again = render(element, 'y', { announce: true });
        assert.equal(again.live, live, 'the live region is reused, not added again');
        view.destroy();
        assert.equal(element.count('click') + element.count('keydown') + element.count('dblclick'), 0);
        assert.ok(live.removed, 'the live region this view added is gone');

        let canceled = 0;
        const third = new View(new FakeElement(), 'x', {});
        third.editor = { cancelEdit: () => { canceled++; } };
        third.set('x + 1');
        assert.equal(canceled, 1, 'an editor over the old expression is closed, not committed to the new one');
    } finally {
        if (hadDocument) { /* a real page's document stays */ } else delete globalThis.document;
    }
});

test('view: a step moves each part from where it was, not from inside a part that moved as a whole', async () => {
    const { View } = await import('../src/view.js');
    const hadElement = 'Element' in globalThis;
    const moves = [];
    globalThis.Element = class { };
    globalThis.Element.prototype.animate = () => {};
    try {
        // x² + x → x² − x: ids 0 (the x in x²), 1, 2 (x²), 3 (the lone x), 4; the lone x stays at 300
        const place = { 0: 0, 1: 10, 2: 0, 3: 300, 4: 0 };
        const view = Object.create(View.prototype);
        const fake = (id) => ({
            getBoundingClientRect: () => ({ left: place[id], top: 0, width: 10, height: 10 }),
            animate: (frames) => moves.push({ id, transform: frames[0].transform ?? '' }),
        });
        view.elementOf = (n) => fake(n.id);
        view.tree = treeOf('x^2 + x');
        const before = view.snapshot();
        view.tree = treeOf('x^2 - x');
        view.morph(before, { duration: 1, easing: 'linear' });
        const lone = moves.filter((m) => m.id === 3 && /translate\((?!0px, 0px)/.test(m.transform));
        assert.deepEqual(lone, [], `the lone x moved: ${JSON.stringify(lone)}`);
    } finally {
        if (!hadElement) delete globalThis.Element;
    }
});

// ---- from the review before 0.3 ---------------------------------------------------------

test('Markdown: nothing a document can write runs for long or overflows the stack', () => {
    const within = (ms, md) => {
        const start = Date.now();
        markdownToHTML(md);
        assert.ok(Date.now() - start < ms, `${JSON.stringify(md.slice(0, 12))}… took ${Date.now() - start} ms`);
    };
    within(1500, '# a' + ' '.repeat(20000) + 'x');      // the heading pattern was cubic: 4,000 spaces took 20 s
    within(1500, '# ' + '#'.repeat(100000) + ' a');
    within(1500, '>'.repeat(5000));                      // quotes in quotes: a RangeError from 2,344
    within(1500, '- '.repeat(3000) + 'x');
    within(1500, '1. '.repeat(3000) + 'x');
    within(1500, '\\( '.repeat(33000));                  // every unclosed \( looked for its \) to the end
    within(1500, '['.repeat(100000));
    within(1500, '!['.repeat(50000));
});

test('Markdown: headings, with and without closing #s', () => {
    const h = (md) => markdownToHTML(md);
    assert.equal(h('# Title ##'), '<h1>Title</h1>');
    assert.equal(h('## x   '), '<h2>x</h2>');
    assert.equal(h('# a#'), '<h1>a#</h1>', 'a # that touches the text is text');
    assert.equal(h('# a \\#'), '<h1>a #</h1>', 'and so is an escaped one');
    assert.equal(h('# # #'), '<h1>#</h1>');
    assert.equal(h('#'), '<p>#</p>');
    assert.equal(h('#\tTab'), '<h1>Tab</h1>');
});

test('Markdown: links and images still read, with brackets in the address and an image as a label', () => {
    const html = markdownToHTML('[a *b*](http://x.y/Function_(math) "t") ![alt](i.png) [![i](i.png)](u)');
    assert.ok(html.includes('<a href="http://x.y/Function_(math)" title="t">a <em>b</em></a>'), html);
    assert.ok(html.includes('<img src="i.png" alt="alt">'), html);
    assert.ok(html.includes('<a href="u"><img src="i.png" alt="i"></a>'), html);
    assert.ok(markdownToHTML('> > - a\n> >   - b $x^2$').includes('<blockquote>\n<blockquote>\n<ul>'), 'ordinary nesting is unchanged');
});

test('the attributes hook: a class and a name cannot close the tag', () => {
    const html = toHTML('x', { attributes: () => ({ class: 'a" onmouseover="alert(1)', 'onx="1" y': 'z', 'data-k': 'v"' }) });
    assert.ok(!/ onmouseover="/.test(html) && !/ onx=/.test(html), html);
    assert.ok(html.includes('data-k="v&quot;"'), html);
    assert.ok(toHTML('x', { attributes: () => ({ class: 'mine', 'data-k': '1' }) }).includes('mv-var mine" data-node="0" data-k="1"'));
});

test('View.set: an expression that cannot be drawn leaves the view as it was', async () => {
    const { View } = await import('../src/view.js');
    const element = { innerHTML: '', firstElementChild: { classList: { add() {} }, setAttribute() {} }, addEventListener() {}, removeEventListener() {} };
    let view;
    try { view = new View(element, 'x^2+1'); } catch { return; }   // no DOM to stand on here: the browser checks cover it
    const tree = view.tree;
    const html = element.innerHTML;
    assert.throws(() => view.set({ type: 'op', op: 'nosuchop', args: [{ type: 'symbol', value: 'q' }] }));
    assert.equal(view.tree, tree);
    assert.equal(element.innerHTML, html);
});

// ---- report -------------------------------------------------------------------------

await Promise.all(pending);
if (failures.length) {
    console.log(failures.map((f) => `✗ ${f}`).join('\n'));
    console.log(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
}
console.log(`${passed} passed`);
