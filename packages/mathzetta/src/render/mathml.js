/**
 * Tree → MathML.
 *
 * The element that represents a node carries `id="mz-<node id>"`, where the
 * node id is the index of its token in the postfix. So every token of the
 * postfix has exactly one element on the page, and highlighting the token
 * `^` at index 2 means styling `#mz-2`. Brackets and other decoration added
 * around a node are not tagged.
 */

import { GREEK, needsBrackets, unaryNeedsBrackets, startsWithSign, isMinusOneTimes, isImplicitProduct, isVariable, firstLeaf, customName, derivativeOrder, bracketedSides, piecewise, bracketOp, MATRICES, matrixRows } from '../common.js';
import { firstVariable } from '../tree.js';
import { isCustomFunction, precedenceOf } from '../operators.js';

/** @returns {string} `<math>…</math>` */
export function toMathml(node) {
    return `<math>${render(node)}</math>`;
}

// ids are postfix indexes; a hand-made tree's id goes in an attribute only if it is one
const idAttr = (node) => (Number.isInteger(node.id) ? ` id="mz-${node.id}"` : '');
const el = (tag, node, content, attrs = '') => `<${tag}${attrs}${idAttr(node)}>${content}</${tag}>`;
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');   // element content: quotes are fine
const mo = (s) => `<mo>${s}</mo>`;
const mi = (s) => `<mi>${escape(s)}</mi>`;   // names can come from a postfix array or tree, not only parse()
const row = (s) => `<mrow>${s}</mrow>`;
const fenced = (s, open = '(', close = ')') => row(mo(open) + s + mo(close));
const commas = (parts) => parts.join(mo(','));
const DISPLAY = ' displaystyle="true"';

// Decorations, written \boxed{x}, \cancel{x}, \vec{v} … and parsed as one-argument functions: drawn as what they are,
// so a screen reader says "x with a bar over it", not "overline of x".
const over = (mark) => (c) => `<mover accent="true">${c}<mo>${mark}</mo></mover>`;
const DECORATIONS = {
    boxed: (c) => `<menclose notation="box">${c}</menclose>`,
    cancel: (c) => `<menclose notation="updiagonalstrike">${c}</menclose>`,
    overline: over('¯'), bar: over('¯'),
    underline: (c) => `<munder accentunder="true">${c}<mo>_</mo></munder>`,
    vec: over('→'), hat: over('^'), widehat: over('^'), tilde: over('~'), dot: over('˙'), ddot: over('¨'),
};
Object.setPrototypeOf(DECORATIONS, null);
const MINUS = '−';   // U+2212, the minus sign MathML expects rather than a hyphen

/** Render a node to MathML (exported for the per-node map in index.js). */
export function render(node) {
    if (node.type === 'number') return el('mn', node, escape(node.value));
    if (node.type === 'string') return el('mtext', node, escape(node.value));
    if (node.type === 'symbol') {
        const v = node.value;
        return el('mi', node, escape(GREEK[v] ?? (v === '\\+' || v === '\\-' ? v[1] : v)));
    }
    return operation(node);
}

const SYMBOLS = {
    '=': '=', '===': '=', '≠': '≠', '≠=': '≠', '<': '&lt;', '>': '&gt;', '≤': '≤', '≥': '≥',   // strict equality is a code distinction: maths writes =
    '∈': '∈', '∉': '∉', '→': '→', '±': '±', 'mod': 'mod', '≈': '≈', '∪': '∪', '∩': '∩', '≡': '≡',
    '&': '∧', '|': '∨', '\\xor': '⊕', '\\nand': '↑', '\\nor': '↓',
};

const NAMED = {
    sin: 'sin', cos: 'cos', tan: 'tan', csc: 'csc', sec: 'sec', cot: 'cot',
    sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
    arcsinh: 'arcsinh', arccosh: 'arccosh', arctanh: 'arctanh', atan2: 'atan2',
    ln: 'ln', max: 'max', min: 'min', gcd: 'gcd', det: 'det', mean: 'mean', round: 'round', fixed: 'fixed', random: 'random',
};

const GROUPS = { '()': ['(', ')'], '[]': ['[', ']'], '{}': ['{', '}'], '(]': ['(', ']'], '[)': ['[', ')'] };

function operation(node) {
    const { op, args } = node;
    const [a, b] = args;
    const side = (child, s) => (needsBrackets(node, child, s) && child.op !== '/' ? fenced(render(child)) : render(child));
    const unary = (child) => (unaryNeedsBrackets(op, child) ? fenced(render(child)) : render(child));
    const call = (name) => el('mrow', node, mi(name) + mo('(') + commas(args.map(render)) + mo(')'));

    if (NAMED[op]) return call(NAMED[op]);
    if (isCustomFunction(op)) {
        const decorate = args.length === 1 && DECORATIONS[customName(op)];
        return decorate ? el('mrow', node, decorate(render(a))) : call(customName(op));
    }
    if (MATRICES[op]) {
        const rows = node.args.map((r, i) => {
            const cells = matrixRows(node)[i].map((c) => `<mtd>${render(c)}</mtd>`).join('');
            return r.type === 'op' && r.op === '[]' ? el('mtr', r, cells) : `<mtr>${cells}</mtr>`;
        });
        return el('mrow', node, mo(MATRICES[op][0]) + `<mtable>${rows.join('')}</mtable>` + mo(MATRICES[op][1]));
    }
    if (GROUPS[op]) return el('mrow', node, mo(GROUPS[op][0]) + commas(args.map(render)) + mo(GROUPS[op][1]));

    switch (op) {
        // -1·x is written -x, bracketed as -x is; a + (-1·x) is a - x, and a - (-1·x) is a + x
        case '+':
            if (isMinusOneTimes(b)) return operation({ ...node, op: '-', args: [a, b.args[1]] });
            return el('mrow', node, side(a, 'left') + mo('+') + side(b, 'right'));
        case '-':
            if (isMinusOneTimes(b)) return operation({ ...node, op: '+', args: [a, b.args[1]] });
            return el('mrow', node, side(a, 'left') + mo(MINUS) + side(b, 'right'));
        case '*':
            if (isMinusOneTimes(node)) return operation({ ...node, op: 'neg', args: [b] });
            // as typed, · or ×; otherwise invisible times where the product reads without a sign
            return el('mrow', node, side(a, 'left') + mo(node.written === 'cross' ? '×' : node.written || !isImplicitProduct(a, b, bracketedSides(node)) ? '⋅' : '\u2062') + side(b, 'right'));
        case '/':
            return el('mfrac', node, render(a) + render(b));
        case '^': {
            const bracketBase = needsBrackets(node, a, 'left') || startsWithSign(a);
            return el('msup', node, (bracketBase ? fenced(render(a)) : render(a)) + render(b));
        }
        case '_':
            return el('msub', node, render(a) + render(b));
        case 'neg':
            return el('mrow', node, mo(MINUS) + unary(a));
        case 'pmod':
            return el('mrow', node, render(a) + mo('(') + mo('mod') + render(b) + mo(')'));
        case 'pm':
            return el('mrow', node, mo('±') + unary(a));
        case '!':
            return el('mrow', node, unary(a) + mo('!'));
        case '\\not':
            return el('mrow', node, mo('¬') + unary(a));
        case 'sqrt':
            return el('msqrt', node, render(a));
        case 'root':
            return el('mroot', node, render(b) + render(a));
        case 'abs':
            return el('mrow', node, mo('|') + render(a) + mo('|'));
        case 'floor':
            return el('mrow', node, mo('⌊') + render(a) + mo('⌋'));
        case 'ceil':
            return el('mrow', node, mo('⌈') + render(a) + mo('⌉'));
        case 'log':
            return el('mrow', node, `<msub>${mi('log')}${render(a)}</msub>` + mo('(') + render(b) + mo(')'));
        case 'expm1':   // eˣ − 1, as LaTeX writes it
            return el('mrow', node, mo('(') + `<msup>${mi('e')}${row(render(a))}</msup>` + mo('−') + '<mn>1</mn>' + mo(')'));
        case 'loglog':
            return el('mrow', node, mi('ln') + mo('(') + mi('ln') + mo('(') + render(a) + mo(')') + mo(')'));
        case 'logloglog':
            return el('mrow', node, mi('ln') + mo('(') + mi('ln') + mo('(') + mi('ln') + mo('(') + render(a) + mo(')').repeat(3));
        case 'perm':
            return el('mmultiscripts', node, mi('P') + render(b) + '<none/><mprescripts/><none/>' + render(a));
        case 'comb':
            return el('mrow', node, mo('(') + `<mfrac linethickness="0">${render(a)}${render(b)}</mfrac>` + mo(')'));
        case '?:': {
            // a piecewise function, as LaTeX's cases: a brace, then one row per branch (an else-chain flattened)
            const rows = piecewise(node).map(({ value, when }) =>
                `<mtr><mtd>${render(value)}</mtd><mtd>${when ? row(`<mtext>if&#160;</mtext>${render(when)}`) : '<mtext>otherwise</mtext>'}</mtd></mtr>`);
            return el('mrow', node, `<mo>{</mo><mtable columnalign="left left">${rows.join('')}</mtable>`);
        }
        case 'sum':   // each term bracketed as + and · would bracket it: prod(a + b, c) is (a + b) · c
            return el('mrow', node, args.map((x, i) => (needsBrackets({ op: '+' }, x, i ? 'right' : 'left') ? fenced(render(x)) : render(x))).join(mo('+')));
        case 'prod':
            return el('mrow', node, args.map((x, i) => (needsBrackets({ op: '*' }, x, i ? 'right' : 'left') ? fenced(render(x)) : render(x))).join(mo('⋅')));
        case 'der': {
            const { n, body, by, at, variable } = derivativeOrder(node);
            const d = n > 1 ? `<msup>${mi('d')}<mn>${n}</mn></msup>` : mi('d');
            const dx = row(mi('d') + (n > 1 ? `<msup>${render(by)}<mn>${n}</mn></msup>` : render(by)));
            // d/dx [x² + 1] gets brackets; d/dx sin x doesn't — the same rule as LaTeX
            const compound = bracketOp(body) && precedenceOf(bracketOp(body)) < 100;
            const drawn = variable ? `<mfrac>${row(d + render(body))}${dx}</mfrac>` : `<mfrac>${d}${dx}</mfrac>` + (compound ? row(mo('[') + render(body) + mo(']')) : render(body));
            // at a point: a bar after it, the point below the bar (x = 2)
            // the variable below the bar is a copy: the id stays on the one in dx
            if (at) return el('msub', node, row(drawn + '<mo stretchy="true">|</mo>') + row(render(by).replace(/ id="[^"]*"/g, '') + mo('=') + render(at)));
            return variable ? el('mfrac', node, row(d + render(body)) + dx) : el('mrow', node, drawn);
        }
        // Big operators are drawn display-size, as they would be on their own line.
        case 'int':
            return el('mrow', node, integral(args), DISPLAY);
        case 'lim':
            return el('mrow', node, limit(args), DISPLAY);
        case '\\sumidx':
            return el('mrow', node, bigOperator('∑', args), DISPLAY);
        case '\\prodidx':
            return el('mrow', node, bigOperator('∏', args), DISPLAY);
    }
    if (SYMBOLS[op]) return el('mrow', node, side(a, 'left') + mo(SYMBOLS[op]) + side(b, 'right'));
    throw new Error(`No MathML for '${op}'`);
}

function integral(args) {
    const [f, second, third, fourth] = args;
    const tail = (v) => render(f) + mi('d') + v;
    const guess = () => mi(firstVariable(f) || 'x');
    const sub = (lo) => `<msub>${mo('∫')}${row(render(lo))}</msub>`;
    const subsup = (lo, hi) => `<msubsup>${mo('∫')}${row(render(lo))}${row(render(hi))}</msubsup>`;
    switch (args.length) {
        case 1: return mo('∫') + tail(guess());
        case 2: return isVariable(second) ? mo('∫') + tail(render(second)) : sub(second) + tail(guess());
        case 3: return isVariable(second) ? sub(third) + tail(render(second)) : subsup(second, third) + tail(guess());
        default: return subsup(third, fourth) + tail(render(second));
    }
}

function limit(args) {
    const [f, second, third, fourth] = args;
    const under = (content) => `<munder>${mi('lim')}${content}</munder>` + render(f);
    switch (args.length) {
        case 1: return mi('lim') + render(f);
        case 2: {
            const v = firstVariable(f);
            const approaches = second.type === 'number' || (second.type === 'symbol' && second.value.includes('∞'));
            return under(v && approaches ? row(mi(v) + mo('→') + render(second)) : render(second));
        }
        case 3: return under(row(render(second) + mo('→') + render(third)));
        default: {
            const side = firstLeaf(fourth).toLowerCase().startsWith('r') ? '+' : '-';
            return under(row(render(second) + mo('→') + `<msup>${render(third)}${mo(side)}</msup>`));
        }
    }
}

function bigOperator(symbol, args) {
    const [f, from, to] = args;
    if (args.length === 1) return mo(symbol) + render(f);
    if (args.length === 2) return `<munder>${mo(symbol)}${render(from)}</munder>` + render(f);
    return `<munderover>${mo(symbol)}${render(from)}${render(to)}</munderover>` + render(f);
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [SYMBOLS, NAMED, GROUPS]) Object.setPrototypeOf(table, null);
