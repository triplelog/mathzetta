/**
 * MathZetta tree → HTML laid out with CSS (see inlinemath.css).
 *
 * Every rendered piece is a box { html, h, d }: its markup, and how far it
 * reaches above (h) and below (d) the baseline, in em of the surrounding
 * text. Nothing is measured in a browser; the estimates place fractions on
 * the maths axis, raise exponents above tall bases and size the integral
 * sign, so the same string is right in Node, in a video frame or on a page.
 * Delimiters, the radical's bar and borders stretch by themselves with CSS.
 *
 * Every tree node is one element:
 *
 *   <span class="mv-n mv-op-frac" data-node="4" data-op="/">…</span>
 *
 * `data-node` is MathZetta's node id (the postfix index), the same id used
 * by toSpeechSegments(), toMathML() and toHTML(). Signs, brackets and other
 * decoration carry no id, so a click on them belongs to the node that drew
 * them.
 */

import {
    GREEK, needsBrackets, unaryNeedsBrackets, isMinusOneTimes, isImplicitProduct, isVariable,
    firstLeaf, customName, derivativeOrder, bracketedSides, bracketOp, firstVariable,
    isCustomFunction, precedenceOf, toAudioSpeech, MATRICES, matrixRows,
} from './mathzetta.js';
import { svg } from './glyphs.js';

// Metrics, in em. They match inlinemath.css; change both together.
const LH = 0.8;        // a line of text: height above the baseline (line-height 1)
const LD = 0.2;        //   and depth below it
const AXIS = 0.25;     // the maths axis: fraction bars and big operators centre here
const RULE = 0.06;     // fraction bar, radical bar
const GAP = 0.1;       // between a fraction bar and its numerator or denominator
const SCRIPT = 0.7;    // exponent and subscript size; deeper scripts use SCRIPT2
const SCRIPT2 = 0.8;
const MINUS = '−';

const OP_CLASS = {
    '+': 'add', '-': 'sub', '*': 'mul', '/': 'frac', '^': 'pow', '_': 'subscript', 'neg': 'neg', 'pm': 'pm',
    '!': 'factorial', '=': 'eq', '===': 'eq', '≠': 'neq', '≠=': 'neq', '<': 'lt', '>': 'gt', '≤': 'le', '≥': 'ge',
    '≈': 'approx', '≡': 'equiv', '∈': 'in', '∉': 'notin', '∪': 'union', '∩': 'intersect', '→': 'to', '±': 'pm',
    '&': 'and', '|': 'or', '\\not': 'not', '\\xor': 'xor', '\\nand': 'nand', '\\nor': 'nor', '?:': 'cases',
    '()': 'tuple', '[]': 'list', '{}': 'set', '(]': 'interval', '[)': 'interval',
    '\\sumidx': 'sum', '\\prodidx': 'prod', 'mod': 'mod', 'pmod': 'pmod',
    pmatrix: 'matrix', bmatrix: 'matrix', vmatrix: 'matrix',
};

const RELATIONS = {
    '=': '=', '===': '=', '≠': '≠', '≠=': '≠', '<': '<', '>': '>', '≤': '≤', '≥': '≥',
    '∈': '∈', '∉': '∉', '→': '→', '≈': '≈', '≡': '≡',
    '&': '∧', '|': '∨', '\\xor': '⊕', '\\nand': '↑', '\\nor': '↓',
};
const BINARY = { '±': '±', '∪': '∪', '∩': '∩', 'mod': 'mod' };

const TRIG = ['sin', 'cos', 'tan', 'csc', 'sec', 'cot', 'sinh', 'cosh', 'tanh'];
const INVERSE = { arcsin: 'sin', arccos: 'cos', arctan: 'tan', arcsinh: 'sinh', arccosh: 'cosh', arctanh: 'tanh' };
/** Functions written with a name and, when the argument is simple, no brackets: sin x, ln x. */
const NAMED = [...TRIG, ...Object.keys(INVERSE), 'ln', 'det'];
/** Functions always written with brackets: max(a, b). */
const CALLS = { atan2: 'atan2', max: 'max', min: 'min', gcd: 'gcd', mean: 'mean', round: 'round', fixed: 'fixed', expm1: 'expm1', random: 'random' };

const GROUPS = { '()': ['(', ')'], '[]': ['[', ']'], '{}': ['{', '}'], '(]': ['(', ']'], '[)': ['[', ')'] };
const LATEX_SYMBOLS = { '\\partial': '∂', '\\nabla': '∇', '\\ell': 'ℓ', '\\infty': '∞', '\\emptyset': '∅' };

/** Custom functions drawn as decorations: \boxed{x} parses as boxed(x). */
const ACCENTS = { vec: '→', hat: 'ˆ', widehat: 'ˆ', tilde: '˜', dot: '˙', ddot: '¨' };
const DECORATIONS = ['boxed', 'overline', 'bar', 'underline', 'cancel', ...Object.keys(ACCENTS)];

export const DEFAULTS = {
    prefix: 'mv',
    display: true,           // big operators with limits above and below, full-size fractions
    fnParens: 'auto',        // 'auto': sin x, ln|x|, sin(x + 1); 'always': sin(x)
    trigPowers: true,        // sin(x)^2 written sin²x
    inverseTrig: 'arc',      // 'arc': arcsin x; 'power': sin⁻¹x
    derivativeBrackets: '[', // d/dx [x² + 1], or '(' for d/dx (x² + 1)
    scriptFractions: 'slash',// x^{1/2} written x^{1/2} with a slash; 'stack' stacks it
    cases: true,             // c ? a : b drawn as a piecewise brace
    label: true,             // accessible name of the whole expression: true = MathZetta's toAudioSpeech (the grouping in the words), a string, (tree) => string, or false
    mathml: null,            // MathZetta's toMathML (import it from 'mathzetta/mathml'): also write the expression as visually hidden MathML, which screen readers can step through and show in math braille; it replaces the label
    attributes: null,        // (node) => ({ ... }) extra attributes for a node's element
    style: null,             // (node) => 'css' inline style for a node's element
};

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const em = (x) => `${+x.toFixed(3)}em`;
const box = (html, h = LH, d = LD) => ({ html, h, d });

/** Boxes side by side. */
function row(...boxes) {
    const list = boxes.flat().filter(Boolean);
    return {
        html: list.map((b) => b.html).join(''),
        h: Math.max(LH, ...list.map((b) => b.h)),
        d: Math.max(LD, ...list.map((b) => b.d)),
    };
}

/**
 * @param {object} tree MathZetta tree (from parseTree) — nodes with ids
 * @param {object} [options] see DEFAULTS
 * @returns {{ html: string, h: number, d: number }}
 */
export function layout(tree, options = {}) {
    const r = new Layout({ ...DEFAULTS, ...options });
    const b = r.render(tree, { level: 0 });
    const cls = `${r.p}${r.o.display ? ` ${r.p}-display` : ''}`;
    // Screen readers get the expression as MathML they can walk (mathml: true), or read as a teacher would (the
    // label); the spans and glyphs of the drawing are never read piecemeal.
    const mathml = typeof r.o.mathml === 'function' ? assistiveMathML(r.o.mathml, tree, r.p, r.o.display) : '';
    const label = mathml ? null : accessibleName(tree, r.o.label);
    const body = label === null && !mathml ? b.html : b.html.replace(/^<span /, '<span aria-hidden="true" ');
    const attrs = label === null ? '' : ` role="math" aria-label="${escape(label)}"`;
    return { html: `<span class="${cls}"${attrs}>${body}${mathml}</span>`, h: b.h, d: b.d };
}

/**
 * The expression as MathML for assistive technology: no ids (two drawings on a page must not share them), hidden
 * from sight. The page passes MathZetta's toMathML, so Inline Math itself imports only what every page maps.
 */
function assistiveMathML(toMathML, tree, prefix, display) {
    try {
        return String(toMathML(tree)).replace(/ id="mz-\d+"/g, '')
            .replace(/^<math>/, `<math class="${prefix}-sr-math"${display ? ' display="block"' : ''}>`);
    } catch {
        return '';   // nothing MathZetta can write as MathML: the label stands in
    }
}

function accessibleName(tree, label) {
    if (label === false || label === null) return null;
    if (typeof label === 'string') return label;
    try {
        // a screen reader is speech with no drawing in view: the grouping has to be in the words
        return typeof label === 'function' ? label(tree) : toAudioSpeech(tree);
    } catch {
        return null;
    }
}

class Layout {
    constructor(options) {
        this.o = options;
        this.p = options.prefix;
    }

    /** An element of class `mv-<kind>` (several kinds: 'a b'). */
    el(kind, content, style = '', extra = '') {
        const cls = kind.split(' ').map((k) => `${this.p}-${k}`).join(' ');
        return `<span class="${cls}"${style ? ` style="${style}"` : ''}${extra}>${content}</span>`;
    }

    /** A run of text. Remembered as a leaf so a node holding only this needs no second element. */
    text(kind, s) {
        const b = box(this.el(kind, escape(s)));
        b.leaf = { kind, content: escape(s) };
        return b;
    }
    /** Binary operator and relation signs carry the spacing around them. */
    bin(s) { return this.text('bin', s); }
    rel(s) { return this.text('rel', s); }
    punct(s) { return this.text('punct', s); }
    word(s) { return this.text('word', s); }

    /** The element for a tree node. */
    wrap(node, kinds, b) {
        let attrs = '';
        if (node.id !== undefined) attrs += ` data-node="${node.id}"`;
        if (node.type === 'op') attrs += ` data-op="${escape(node.op)}"`;
        const extra = this.o.attributes ? this.o.attributes(node) || {} : {};
        for (const [k, v] of Object.entries(extra)) {
            if (k !== 'class' && k !== 'style') attrs += ` ${k}="${escape(v)}"`;
        }
        const style = [extra.style, this.o.style && this.o.style(node)].filter(Boolean).join(';');
        const all = b.leaf ? ['n', ...kinds, b.leaf.kind] : ['n', ...kinds];
        const cls = all.map((k) => `${this.p}-${k}`).concat(extra.class ? [extra.class] : []).join(' ');
        const content = b.leaf ? b.leaf.content : b.html;
        return { html: `<span class="${cls}"${style ? ` style="${escape(style)}"` : ''}${attrs}>${content}</span>`, h: b.h, d: b.d };
    }

    // ---- leaves ---------------------------------------------------------------

    render(node, ctx) {
        if (node.type === 'number') return this.number(node);
        if (node.type === 'string') return this.wrap(node, ['text'], this.text('text', node.value.replace(/^["'`]|["'`]$/g, '')));
        if (node.type === 'symbol') return this.wrap(node, ['symbol'], this.symbol(node.value));
        return this.operation(node, ctx);
    }

    number(node) {
        return this.wrap(node, ['number'], this.text('num', node.value.replace(/^-/, MINUS)));
    }

    symbol(v) {
        if (GREEK[v]) v = GREEK[v];
        if (LATEX_SYMBOLS[v]) return this.text('ord', LATEX_SYMBOLS[v]);
        if (v === '\\+' || v === '\\-') return this.text('ord', v[1]);
        if (v === '-∞') return this.text('ord', MINUS + '∞');
        if (/^[A-Za-z]$/.test(v) || /^[α-ω]$/.test(v)) return this.text('var', v);
        if (/^[A-Za-z]′+$/.test(v)) return box(this.el('var', escape(v[0])) + this.el('prime', escape(v.slice(1))));
        if (/^Δ[A-Za-z]$/.test(v)) return box(this.el('ord', 'Δ') + this.el('var', v[1]));
        if (v.endsWith('⁻¹')) return this.script(this.symbol(v.slice(0, -2)), this.text('num', MINUS + '1'), { level: 0 });
        if (/^\\[A-Za-z]+$/.test(v)) return this.text('name', v.slice(1));
        if (/^[A-Za-z]{2,}$/.test(v)) return this.text('name', v);   // upright, like \mathrm
        return this.text('ord', v);
    }

    // ---- operations -----------------------------------------------------------

    operation(node, ctx) {
        const { op, args } = node;
        const [a, b] = args;
        const r = (n, c = {}) => this.render(n, { ...ctx, ...c, forceParens: c.forceParens || false, before: c.before || false });
        const kind = OP_CLASS[op] ?? (/^[a-z0-9]+$/i.test(op) ? op : 'other');
        const wrap = (content) => this.wrap(node, ['op', `op-${kind}`], content);
        const side = (child, s) => (needsBrackets(node, child, s) && child.op !== '/' ? this.fence(r(child)) : r(child));

        if (NAMED.includes(op) || op === 'log') return wrap(this.named(node, ctx));
        if (CALLS[op]) return wrap(row(this.word(CALLS[op]), this.fence(this.list(args, ctx))));
        if (isCustomFunction(op)) return wrap(this.custom(node, ctx));
        const rows = matrixRows(node);   // pmatrix, bmatrix, vmatrix, and [[1, 2], [3, 4]]
        if (rows) return wrap(this.matrix(node, rows, ctx));
        if (GROUPS[op]) return wrap(this.fence(this.list(args, ctx), ...GROUPS[op]));
        if (RELATIONS[op] && args.length === 2) return wrap(row(side(a, 'left'), this.rel(RELATIONS[op]), side(b, 'right')));
        if (BINARY[op] && args.length === 2) return wrap(row(side(a, 'left'), this.bin(BINARY[op]), side(b, 'right')));

        switch (op) {
            case '+': {
                // a + (-1·x) and a + (-3) read as a − x and a − 3.
                if (isMinusOneTimes(b)) return wrap(row(side(a, 'left'), this.bin(MINUS), this.wrap(b, ['op', 'op-mul'], this.render(b.args[1], ctx))));
                if (b.type === 'number' && b.value.startsWith('-')) return wrap(row(side(a, 'left'), this.bin(MINUS), this.wrap(b, ['number'], this.text('num', b.value.slice(1)))));
                return wrap(row(side(a, 'left'), this.bin('+'), this.signed(b, side(b, 'right'))));
            }
            case '-':
                return wrap(row(side(a, 'left'), this.bin(MINUS), this.signed(b, side(b, 'right'))));
            case '*':
                return wrap(this.product(node, ctx));
            case '/':
                return wrap(this.fraction(node, ctx));
            case '^':
                return wrap(this.power(node, ctx));
            case '_':
                return wrap(this.script(r(a, { forceParens: true }), null, ctx, r(b, { level: ctx.level + 1 })));
            case 'neg':
                return wrap(row(this.text('sign', MINUS), unaryNeedsBrackets(op, a) ? this.fence(r(a)) : r(a, { before: ctx.before })));
            case 'pm':
                return wrap(row(this.text('sign', '±'), unaryNeedsBrackets(op, a) ? this.fence(r(a)) : r(a)));
            case '!':
                return wrap(row(unaryNeedsBrackets(op, a) ? this.fence(r(a)) : r(a, { forceParens: true }), this.text('ord', '!')));
            case '\\not':
                return wrap(row(this.text('sign', '¬'), unaryNeedsBrackets(op, a) ? this.fence(r(a)) : r(a)));
            case 'pmod':
                return wrap(row(r(a), this.fence(row(this.word('mod'), this.text('space', ''), r(b)))));
            case 'sqrt':
                return wrap(this.radical(r(a)));
            case 'root':
                return wrap(this.radical(r(b), this.render(a, { level: ctx.level + 2 })));
            case 'abs':
                return wrap(this.fence(r(a), '|', '|'));
            case 'floor':
                return wrap(this.fence(r(a), '⌊', '⌋'));
            case 'ceil':
                return wrap(this.fence(r(a), '⌈', '⌉'));
            case 'loglog':
                return wrap(row(this.word('ln'), this.fence(row(this.word('ln'), this.fence(r(a))))));
            case 'logloglog':
                return wrap(row(this.word('ln'), this.fence(row(this.word('ln'), this.fence(row(this.word('ln'), this.fence(r(a))))))));
            case 'perm':
                return wrap(this.script(this.script(box(''), this.render(a, { level: ctx.level + 1 }), ctx), null, ctx,
                    this.render(b, { level: ctx.level + 1 }), this.word('P')));
            case 'comb':
                return wrap(this.fence(this.stack(r(a), r(b), false)));
            case '?:':
                return wrap(this.o.cases ? this.cases(node, ctx) : row(r(a), this.bin('?'), r(b), this.bin(':'), r(args[2])));
            case 'sum':
                return wrap(row(args.map((n, i) => (i ? [this.bin('+'), r(n)] : [r(n)])).flat()));
            case 'prod':
                return wrap(row(args.map((n, i) => (i ? [this.bin('·'), r(n)] : [r(n)])).flat()));
            case 'der':
                return wrap(this.derivative(node, ctx));
            case 'int':
                return wrap(this.integral(args, ctx));
            case 'lim':
                return wrap(this.limit(args, ctx));
            case '\\sumidx':
                return wrap(this.bigOperator('sum', args, ctx));
            case '\\prodidx':
                return wrap(this.bigOperator('prod', args, ctx));
        }
        throw new Error(`Inline Math cannot draw '${op}'`);
    }

    /** The right side of + or −: a leading sign gets brackets, a + (−b). */
    signed(node, b) {
        const starts = node.type === 'number' ? node.value.startsWith('-') : node.op === 'neg' || node.op === 'pm';
        return starts && !b.fenced ? this.fence(b) : b;
    }

    list(args, ctx) {
        return row(args.map((n, i) => (i ? [this.punct(','), this.render(n, ctx)] : [this.render(n, ctx)])).flat());
    }

    /** 2x, x·2, (x+1)(x−2), sin x cos x. */
    product(node, ctx) {
        const [a, b] = node.args;
        if (isMinusOneTimes(node)) return row(this.text('sign', MINUS), this.render(b, ctx));
        const sides = bracketedSides(node);
        const implicit = isImplicitProduct(a, b, sides);
        // "sin x · y" must keep its brackets: sin(x) y. Before another function it needn't: sin x cos x.
        const nextIsCall = startsWithCall(b);
        const left = sides.left ? this.fence(this.render(a, ctx)) : this.render(a, { ...ctx, before: implicit && !nextIsCall });
        const right = sides.right ? this.fence(this.render(b, ctx)) : this.render(b, { ...ctx, before: ctx.before });
        // A thin space before a function name: 2 sin x, x² ln x.
        const join = !implicit ? this.bin('·') : box(this.el(nextIsCall ? 'fnspace' : 'times', ''));
        return row(left, join, right);
    }

    // ---- functions ------------------------------------------------------------

    /** sin x, sin(x + 1), sin²x, sin⁻¹x, ln|x|, log₂ x. */
    named(node, ctx, power = null) {
        const { op, args } = node;
        const arg = op === 'log' ? args[1] : args[0];
        let name;
        if (INVERSE[op] && this.o.inverseTrig === 'power') {
            name = this.script(this.word(INVERSE[op]), this.text('num', MINUS + '1'), ctx);
        } else {
            name = this.word(op);
        }
        if (power) name = this.script(name, power, ctx);
        if (op === 'log') name = this.script(name, null, ctx, this.render(args[0], { level: ctx.level + 1 }));
        const bare = this.o.fnParens === 'auto' && !ctx.forceParens && !ctx.before && isSimpleArgument(arg);
        const body = this.render(arg, { ...ctx, forceParens: false, before: false });
        return row(name, bare ? row(box(this.el('fnspace', '')), body) : this.fence(body));
    }

    custom(node, ctx) {
        const name = customName(node.op);
        const args = node.args;
        if (DECORATIONS.includes(name) && args.length === 1) return this.decorate(name, this.render(args[0], ctx));
        // f(x), g′(x): a one-letter function is italic like a variable; sgn(x) is upright.
        const head = /^[A-Za-z]′*(⁻¹)?$/.test(name) ? this.symbol(name) : this.word(name);
        return row(head, box(this.el('callgap', '')), this.fence(this.list(args, ctx)));
    }

    decorate(name, b) {
        switch (name) {
            case 'boxed': return box(this.el('boxed', b.html), b.h + 0.22, b.d + 0.22);
            // a drawn stroke, not a background: Windows high contrast drops backgrounds, and a cancelled term would look kept
            case 'cancel': return box(this.el('cancel', b.html + svg('cancel', `${this.p}-cancel-line`)), b.h, b.d);
            case 'underline': return box(this.el('underline', b.html), b.h, b.d + 0.12);
            case 'overline': case 'bar': return box(this.el('over', b.html), b.h + 0.14, b.d);
            default: return box(this.el('accent', this.el('accent-mark', ACCENTS[name]) + b.html), b.h + 0.3, b.d);
        }
    }

    // ---- fractions, scripts, radicals ------------------------------------------

    fraction(node, ctx) {
        const [a, b] = node.args;
        if (ctx.level > 0 && this.o.scriptFractions === 'slash' && isSimpleArgument(a, true) && isSimpleArgument(b, true)) {
            const side = (n) => (n.type === 'op' && !isSimpleArgument(n) ? this.fence(this.render(n, ctx)) : this.render(n, ctx));
            return row(side(a), this.text('ord', '/'), side(b));
        }
        // A fraction inside a fraction, or in running text, is set smaller.
        const k = ctx.level > 0 || ctx.inFraction || !this.o.display ? 0.8 : 1;
        const inner = { ...ctx, inFraction: true, forceParens: false, before: false };
        return this.stack(this.render(a, inner), this.render(b, inner), true, k);
    }

    /** One box over another, centred on the axis; with a bar for fractions, without for binomials. */
    stack(num, den, bar = true, k = 1) {
        const scale = (b) => (k === 1 ? b.html : this.el('scaled', b.html, `font-size:${em(k)}`));
        const t = bar ? RULE : 0;
        // Numerator and denominator are lines of the surrounding size, so never shallower than one.
        const lift = AXIS + t / 2 + GAP + Math.max(LD, k * num.d);   // the numerator's baseline
        const html = this.el(`frac${bar ? '' : ' frac-nobar'}`,
            this.el('numer', scale(num)) + this.el('denom', scale(den)),
            `vertical-align:${em(lift)}`);
        return box(html, lift + Math.max(LH, k * num.h), Math.max(LH, k * den.h) + Math.max(LD, k * den.d) + GAP + t / 2 - AXIS);
    }

    /** x², (x+1)³, e^{x²}, sin²x, x₁². */
    power(node, ctx) {
        const [a, b] = node.args;
        const up = { ...ctx, level: ctx.level + 1, forceParens: false, before: false, inFraction: false };
        const exponent = () => this.render(b, up);
        if (this.o.trigPowers && TRIG.includes(a.op) && isPositiveWhole(b)) {
            return this.wrap(a, ['op', `op-${a.op}`], this.named(a, ctx, exponent()));
        }
        if (a.op === '_') {
            const sub = this.render(a.args[1], up);
            return this.wrap(a, ['op', 'op-subscript'], this.script(this.render(a.args[0], { ...ctx, forceParens: true }), exponent(), ctx, sub));
        }
        // (sin x)^{1/2}: a named function keeps its own name outside the brackets only as sin²x.
        const fenceBase = needsBrackets(node, a, 'left') || (a.type === 'number' && a.value.startsWith('-')) || a.op === '/' || NAMED.includes(a.op);
        const base = fenceBase ? this.fence(this.render(a, ctx)) : this.render(a, { ...ctx, forceParens: true });
        return this.script(base, exponent(), ctx);
    }

    /**
     * A base with an exponent, a subscript or both. `pre` goes between the
     * base and the scripts, used for ⁿPₖ.
     */
    script(base, sup, ctx, sub = null, pre = null) {
        const kk = ctx.level > 0 ? SCRIPT2 : SCRIPT;   // relative to the current size
        const head = pre ? row(base, pre) : base;
        let rise = sup ? Math.max(0.42, base.h - 0.38, kk * sup.d + 0.12) : 0;
        let drop = sub ? Math.max(0.2, base.d - 0.05, kk * sub.h - 0.45) : 0;
        if (sup && sub) {
            const clash = 0.1 - ((rise - kk * sup.d) - (kk * sub.h - drop));
            if (clash > 0) drop += clash;
        }
        const scaled = (b) => this.el('script', b.html, `font-size:${em(kk)}`);
        if (sup && !sub) {
            return box(base.html + this.el('sup', sup.html, `font-size:${em(kk)};vertical-align:${em(rise / kk)}`),
                Math.max(head.h, rise + kk * sup.h), Math.max(head.d, kk * sup.d - rise));
        }
        if (sub && !sup) {
            return box(head.html + this.el('sub', sub.html, `font-size:${em(kk)};vertical-align:${em(-drop / kk)}`),
                Math.max(head.h, kk * sub.h - drop), Math.max(head.d, drop + kk * sub.d));
        }
        const top = rise + kk * sup.h;
        const bottom = drop + kk * sub.d;
        const column = this.el('subsup', scaled(sup) + scaled(sub), `vertical-align:${em(rise)};height:${em(top + bottom)}`);
        return box(head.html + column, Math.max(head.h, top), Math.max(head.d, bottom));
    }

    /** √x and ⁿ√x: the hook is drawn as tall as the radicand, the bar is its top border. */
    radical(inner, index = null) {
        const top = Math.max(inner.h, LH) + GAP + RULE;
        const depth = Math.max(inner.d, LD);
        const height = top + depth;
        const hook = svg('sqrt', `${this.p}-hook`, `height:${em(height)};width:${em(0.5 + 0.06 * (height - 1))};vertical-align:${em(-depth)}`);
        let pre = '';
        if (index) {
            const k = SCRIPT * 0.8;
            pre = this.el('rootindex', index.html, `font-size:${em(k)};vertical-align:${em((-depth + 0.55 * height) / k)}`);
        }
        return box(this.el('sqrt', pre + hook + this.el('radicand', inner.html)), top, depth);
    }

    /**
     * Brackets that grow with what they hold. Each side is drawn at 100% of
     * the content's height, so no measuring is needed.
     */
    fence(inner, open = '(', close = ')') {
        const height = Math.max(inner.h, LH) + Math.max(inner.d, LD);
        const tall = height > 1.25;
        const pad = tall ? 0.1 : 0;
        const side = (ch, where) => {
            if (!ch) return { html: '', w: 0 };
            const w = { '(': 0.26, ')': 0.26, '{': 0.36, '}': 0.36 }[ch];
            if (w) {
                const width = w + (tall ? Math.min(0.2, 0.05 * (height - 1)) : 0);
                return { html: svg(ch, `${this.p}-delim ${this.p}-delim-${where}`, `width:${em(width)}`), w: width + 0.1 };
            }
            const name = { '[': 'lbrack', ']': 'rbrack', '|': 'vert', '⌊': 'lfloor', '⌋': 'rfloor', '⌈': 'lceil', '⌉': 'rceil' }[ch];
            return { html: this.el(`delim ${name} delim-${where}`, ''), w: ch === '|' ? 0.18 : 0.3 };
        };
        const l = side(open, 'l');
        const rr = side(close, 'r');
        const style = `padding:${em(pad)} ${em(rr.w)} ${em(pad)} ${em(l.w)}`;
        const b = box(this.el('fence', l.html + inner.html + rr.html, style), Math.max(inner.h, LH) + pad, Math.max(inner.d, LD) + pad);
        b.fenced = true;
        return b;
    }

    // ---- calculus -------------------------------------------------------------

    /** dy/dx, d²y/dx², and d/dx [f] with the body after the fraction. */
    derivative(node, ctx) {
        const { n, body, by, variable } = derivativeOrder(node);
        const up = { ...ctx, level: ctx.level + 1 };
        const d = () => this.text('d', 'd');
        const power = () => (n > 1 ? this.render({ type: 'number', value: String(n) }, up) : null);
        const inner = { ...ctx, inFraction: true };
        const dx = row(d(), power() ? this.script(this.render(by, inner), power(), inner) : this.render(by, inner));
        const top = (rest) => row(power() ? this.script(d(), power(), inner) : d(), rest || []);
        const k = ctx.level > 0 || ctx.inFraction || !this.o.display ? 0.8 : 1;
        if (variable) return this.stack(top(this.render(body, inner)), dx, true, k);
        const compound = bracketOp(body) && precedenceOf(bracketOp(body)) < 100;
        const [open, close] = this.o.derivativeBrackets === '(' ? ['(', ')'] : ['[', ']'];
        const after = compound ? this.fence(this.render(body, ctx), open, close) : this.render(body, ctx);
        return row(this.stack(top(), dx, true, k), after);
    }

    /** ∫ with its limits to the right of the sign, then the integrand and dx. */
    integral(args, ctx) {
        const [f, second, third, fourth] = args;
        const r = (n) => this.render(n, ctx);
        const lim = (n) => (n ? this.render(n, { ...ctx, level: ctx.level + 1 }) : null);
        const guess = () => this.text('var', firstVariable(f) || 'x');
        let lo = null;
        let hi = null;
        let v;
        switch (args.length) {
            case 1: v = guess(); break;
            case 2: if (isVariable(second)) v = r(second); else { v = guess(); lo = lim(second); } break;
            case 3: if (isVariable(second)) { v = r(second); lo = lim(third); } else { v = guess(); lo = lim(second); hi = lim(third); } break;
            default: v = r(second); lo = lim(third); hi = lim(fourth);
        }
        const body = r(f);
        const dx = box(this.el('dx', this.el('d', 'd') + v.html), v.h, v.d);
        return row(this.bigSign('int', body, lo, hi, ctx), body, dx);
    }

    /** The ∫ sign, centred on the axis and at least as tall as the integrand, with limits beside it. */
    bigSign(name, body, lo, hi, ctx) {
        const small = !this.o.display || ctx.level > 0;
        const half = Math.max(small ? 0.6 : 0.95, Math.max(body.h - AXIS, body.d + AXIS) + 0.12);
        const sign = svg(name, `${this.p}-bigsign ${this.p}-${name}sign`,
            `height:${em(2 * half)};width:${em(small ? 0.38 : 0.5)};vertical-align:${em(AXIS - half)}`);
        if (!lo && !hi) return box(sign, AXIS + half, half - AXIS);
        const k = SCRIPT;
        const hiBox = hi || box('');
        const loBox = lo || box('');
        const rise = AXIS + half - k * hiBox.h;
        const drop = half - AXIS - k * loBox.d;
        const column = this.el('limits',
            this.el('script', hiBox.html, `font-size:${em(k)}`) + this.el('script lower', loBox.html, `font-size:${em(k)}`),
            `vertical-align:${em(rise)};height:${em(2 * half)}`);
        return box(sign + column, AXIS + half, half - AXIS);
    }

    limit(args, ctx) {
        const [f, second, third, fourth] = args;
        const below = { ...ctx, level: ctx.level + 1 };
        const r = (n) => this.render(n, below);
        const arrow = () => this.rel('→');
        let under;
        switch (args.length) {
            case 1: return row(this.word('lim'), box(this.el('fnspace', '')), this.render(f, ctx));
            case 2: {
                const v = firstVariable(f);
                const approaches = second.type === 'number' || (second.type === 'symbol' && second.value.includes('∞'));
                under = v && approaches ? row(this.text('var', v), arrow(), r(second)) : r(second);
                break;
            }
            case 3: under = row(r(second), arrow(), r(third)); break;
            default: {
                const sign = firstLeaf(fourth).toLowerCase().startsWith('r') ? '+' : MINUS;
                under = row(r(second), arrow(), this.script(r(third), this.wrap(fourth, ['symbol'], this.text('ord', sign)), below));
            }
        }
        return row(this.under(this.word('lim'), under, ctx), this.render(f, ctx));
    }

    /** A word with something set small beneath it, lim over x → 0; the word keeps the baseline. */
    under(top, below, ctx) {
        const k = SCRIPT;
        if (!this.o.display || ctx.level > 0) return this.script(top, null, ctx, below);
        return box(this.el('under', top.html + this.el('script', below.html, `font-size:${em(k)}`)),
            top.h, Math.max(top.d, LD) + 0.05 + k * (below.h + below.d));
    }

    /** ∑ and ∏ with the index below and the end above. */
    bigOperator(name, args, ctx) {
        const [f, from, to] = args;
        const up = { ...ctx, level: ctx.level + 1 };
        const lo = from ? this.render(from, up) : null;
        const hi = to ? this.render(to, up) : null;
        const body = this.render(f, ctx);
        if (!this.o.display || ctx.level > 0) {
            const half = 0.55;
            const sign = svg(name, `${this.p}-bigsign`, `height:${em(2 * half)};width:${em(0.8)};vertical-align:${em(AXIS - half)}`);
            return row(this.script(box(sign, AXIS + half, half - AXIS), hi, ctx, lo), body);
        }
        const half = 0.68;
        const k = SCRIPT;
        const sign = svg(name, `${this.p}-bigsign`, `height:${em(2 * half)};width:${em(name === 'sum' ? 1.0 : 1.05)}`);
        // The first item sets the column's baseline: the upper limit's, or the sign's bottom edge.
        const lift = hi ? AXIS + half + 0.08 + k * hi.d : AXIS - half;
        const scaled = (b) => this.el('script', b.html, `font-size:${em(k)}`);
        const column = this.el('bigop', (hi ? scaled(hi) : '') + sign + (lo ? scaled(lo) : ''), `vertical-align:${em(lift)}`);
        const op = box(column,
            AXIS + half + (hi ? 0.08 + k * (hi.h + hi.d) : 0),
            half - AXIS + (lo ? 0.08 + k * (lo.h + lo.d) : 0));
        return row(op, body);
    }

    /**
     * A matrix: a grid of entries, centred on the maths axis, in brackets as tall as it is. Each
     * row that is a list in the tree is an element of its own (display: contents), so a row can
     * be pointed at like any part.
     */
    matrix(node, rows, ctx) {
        const ROWGAP = 0.3;
        const cells = rows.map((r) => r.map((c) => this.render(c, ctx)));
        const heights = cells.map((r) => ({ h: Math.max(LH, ...r.map((b) => b.h)), d: Math.max(LD, ...r.map((b) => b.d)) }));
        const total = heights.reduce((s, x) => s + x.h + x.d, 0) + ROWGAP * (rows.length - 1);
        const lift = AXIS + total / 2 - heights[0].h;   // the first row's baseline
        const html = cells.map((r, i) => {
            const inner = r.map((b) => this.el('matrix-cell', b.html)).join('');
            const tree = node.args[i];
            return tree && tree.type === 'op' && tree.op === '[]' ? this.wrap(tree, ['op', 'op-list', 'matrix-row'], box(inner)).html : inner;
        }).join('');
        const columns = rows[0].length;
        const grid = box(this.el('matrix', html, `grid-template-columns:repeat(${columns},auto);vertical-align:${em(lift)}`), AXIS + total / 2, total / 2 - AXIS);
        const [open, close] = MATRICES[node.op] ?? ['[', ']'];
        return this.fence(grid, open, close);
    }

    /** c ? a : b  →  a brace with "a  if c", "b  otherwise". Nested ternaries add rows. */
    cases(node, ctx) {
        const rows = [];
        let n = node;
        while (n.type === 'op' && n.op === '?:') {
            rows.push([this.render(n.args[1], ctx), row(this.word('if'), this.text('space', ''), this.render(n.args[0], ctx))]);
            n = n.args[2];
        }
        // a case nobody wrote (`unchanged`: no else, no otherwise row) is not drawn
        if (!(n.type === 'symbol' && n.value === 'unchanged')) rows.push([this.render(n, ctx), this.word('otherwise')]);
        const ROWGAP = 0.25;
        const heights = rows.map(([v, c]) => ({ h: Math.max(v.h, c.h), d: Math.max(v.d, c.d) }));
        const total = heights.reduce((s, x) => s + x.h + x.d, 0) + ROWGAP * (rows.length - 1);
        const lift = AXIS + total / 2 - heights[0].h;   // the first row's baseline
        const cells = rows.map(([v, c]) => this.el('case-value', v.html) + this.el('case-cond', c.html)).join('');
        const grid = box(this.el('cases', cells, `vertical-align:${em(lift)}`), AXIS + total / 2, total / 2 - AXIS);
        return this.fence(grid, '{', '');
    }
}

// ---- helpers ------------------------------------------------------------------

/** Written without brackets after sin or ln: x, 2, θ, 2x, πx, |x|. Within scripts also x² and −x. */
function isSimpleArgument(node, inScript = false) {
    if (node.type === 'number') return !node.value.startsWith('-') || inScript;
    if (node.type === 'symbol') return true;
    if (node.type !== 'op') return false;
    if (node.op === 'abs' || matrixRows(node)) return !inScript;   // |x| and a matrix bring their own brackets
    if (inScript && (node.op === 'neg' || node.op === '^')) return isSimpleArgument(node.args[0], true) && (node.op === 'neg' || isSimpleArgument(node.args[1], true));
    if (node.op === '*' && !isMinusOneTimes(node)) {
        return node.args.every((c) => (c.type === 'number' && !c.value.startsWith('-')) || isShortSymbol(c) || (c.op === '*' && isSimpleArgument(c, inScript)));
    }
    return false;
}

const isShortSymbol = (n) => n.type === 'symbol' && (n.value.length === 1 || /^[α-ωΑ-Ω]$/.test(n.value) || Boolean(GREEK[n.value]));
const isPositiveWhole = (n) => n.type === 'number' && /^[1-9]\d*$/.test(n.value) && Number(n.value) < 10;

/** Does this expression begin with a function name, so that "sin x cos x" needs no brackets? */
function startsWithCall(node) {
    while (node.type === 'op') {
        if (NAMED.includes(node.op) || node.op === 'log' || CALLS[node.op] || isCustomFunction(node.op)) return true;
        if (node.op === '^' || node.op === '*') { node = node.args[0]; continue; }
        return false;
    }
    return false;
}
