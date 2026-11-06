/**
 * Tree → LaTeX (KaTeX-compatible).
 */

import { GREEK, needsBrackets, unaryNeedsBrackets, isMinusOneTimes, isImplicitProduct, isVariable, firstLeaf, customName, bracketOp, derivativeOrder, bracketedSides, piecewise, MATRICES, matrixRows } from '../common.js';
import { firstVariable } from '../tree.js';
import { isCustomFunction, precedenceOf } from '../operators.js';

/**
 * @param {object} node expression tree
 * @param {object} [options]
 * @param {(node: object, latex: string) => string} [options.wrap] called with
 *   every node and its LaTeX; whatever it returns is used instead. Use it to
 *   tag subexpressions, e.g. `(n, s) => \htmlId{mz-${n.id}}{${s}}`.
 */
export function toLatex(node, options = {}) {
    const render = (n) => {
        const latex = n.type === 'op' ? operation(n, render) : leaf(n);
        return options.wrap ? options.wrap(n, latex) : latex;
    };
    return render(node);
}

const paren = (s) => `\\left(${s}\\right)`;

/** α → alpha, Ω → Omega: Greek letters are written as LaTeX commands. */
const GREEK_NAMES = Object.fromEntries(Object.entries(GREEK).map(([name, letter]) => [letter, name]));

/** ℝ → \\mathbb{R}: the number sets. */
const BLACKBOARD = { 'ℝ': 'R', 'ℕ': 'N', 'ℤ': 'Z', 'ℚ': 'Q', 'ℂ': 'C' };

function leaf(node) {
    const v = node.value;
    if (node.type === 'string') return `\\text{${v}}`;
    if (node.type === 'number') return v;
    if (GREEK[v]) return '\\' + v;
    if (GREEK_NAMES[v]) return '\\' + GREEK_NAMES[v];
    if (v === '\\+' || v === '\\-') return v[1];
    if (v === '∞' || v === '-∞') return v.replace('∞', '\\infty');
    if (BLACKBOARD[v]) return `\\mathbb{${BLACKBOARD[v]}}`;
    return name(v);
}

/**
 * y′′ → y'', Δx → \Delta x, rate → \mathrm{rate}: names as LaTeX writes
 * them. A word in italic would read as a product of letters, so it is upright.
 */
/**
 * A name from a postfix array or tree can hold anything: LaTeX's command characters are written as
 * characters, so `\href{…}` in a name stays text (parse() never makes such names).
 */
const texEscape = (v) => v.replace(/[\\{}$#&~]/g, (c) => ({ '\\': '\\backslash ', '~': '\\sim ' })[c] ?? `\\${c}`);

function name(v) {
    if (/[\\{}$#&~]/.test(v)) return `\\mathrm{${texEscape(v)}}`;
    const greek = GREEK_NAMES[v[0]];
    if (greek && v.length > 1) return `\\${greek} ${name(v.slice(1))}`;
    if (/^[A-Za-z]{2,}$/.test(v)) return `\\mathrm{${v}}`;
    return v.replace(/′/g, "'").replace('⁻¹', '^{-1}').replace(/%/g, '\\%');   // % starts a comment in LaTeX
}

const COMPARISONS = {
    '=': '=', '===': '=', '≠': '\\neq', '≠=': '\\neq', '<': '<', '>': '>', '≤': '\\leq', '≥': '\\geq',
    '∈': '\\in', '∉': '\\notin', '±': '\\pm', '≈': '\\approx', '∪': '\\cup', '∩': '\\cap', '≡': '\\equiv',
    '&': '\\land', '|': '\\lor', '\\xor': '\\oplus', '\\nand': '\\barwedge', '\\nor': '\\downarrow',
};

/** Functions written as a named operator applied to bracketed arguments. */
const NAMED = {
    sin: '\\sin', cos: '\\cos', tan: '\\tan', csc: '\\csc', sec: '\\sec', cot: '\\cot',
    sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
    arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
    arcsinh: '\\sinh^{-1}', arccosh: '\\cosh^{-1}', arctanh: '\\tanh^{-1}',
    ln: '\\ln', max: '\\max', min: '\\min', gcd: '\\gcd', det: '\\det',
    round: '\\text{round}', fixed: '\\text{fixed}', atan2: '\\text{atan2}',
    random: '\\text{random}',
};

const GROUPS = { '()': ['(', ')'], '[]': ['[', ']'], '{}': ['\\{', '\\}'], '(]': ['(', ']'], '[)': ['[', ')'] };

function operation(node, render) {
    const { op, args } = node;
    const [a, b] = args;
    // A fraction is its own bracket: a \cdot \frac{b}{c} needs none.
    const side = (child, s) => (needsBrackets(node, child, s) && child.op !== '/' ? paren(render(child)) : render(child));
    const list = () => args.map(render).join(', ');

    if (COMPARISONS[op]) return `${side(a, 'left')} ${COMPARISONS[op]} ${side(b, 'right')}`;
    if (NAMED[op]) return `${NAMED[op]}${paren(list())}`;
    if (MATRICES[op]) return `\\begin{${op}}${matrixRows(node).map((r) => r.map(render).join(' & ')).join(' \\\\ ')}\\end{${op}}`;
    if (GROUPS[op]) return GROUPS[op][0] + list() + GROUPS[op][1];
    if (isCustomFunction(op)) {
        const fn = customName(op);
        return (/^.(′*|⁻¹)$/.test(fn) ? name(fn) : `\\operatorname{${texEscape(fn)}}`) + paren(list());
    }

    switch (op) {
        case '→':
            return `${side(a, 'left')}\\to ${side(b, 'right')}`;
        case '+':
            return side(a, 'left') + (isMinusOneTimes(b) ? ' ' : ' + ') + side(b, 'right');
        case '-':
            return side(a, 'left') + (isMinusOneTimes(b) ? ' + ' + render(b).slice(1) : ' - ' + side(b, 'right'));
        case '*': {
            if (isMinusOneTimes(node)) return '-' + render(b);
            const l = side(a, 'left');
            const r = side(b, 'right');
            if (!isImplicitProduct(a, b, bracketedSides(node))) return `${l} \\cdot ${r}`;
            // \pi followed by a letter would read as one command: \pir
            return /\\[a-zA-Z]+$/.test(l) && /^[a-zA-Z]/.test(r) ? `${l} ${r}` : l + r;
        }
        case '/':
            return `\\frac{${render(a)}}{${render(b)}}`;
        case '^': {
            const base = render(a);
            const exponent = render(b);
            const bracketBase = needsBrackets(node, a, 'left') || base.startsWith('-');
            return `${bracketBase ? paren(base) : base}^${exponent.length > 1 ? `{${exponent}}` : exponent}`;
        }
        case 'mod':
            return `${side(a, 'left')} \\bmod ${side(b, 'right')}`;
        case '_':
            return `${render(a)}_{${render(b)}}`;
        case 'neg':
            return '-' + (unaryNeedsBrackets(op, a) ? paren(render(a)) : render(a));
        case 'pmod':
            return `${render(a)} \\pmod{${render(b)}}`;
        case 'pm':
            return '\\pm ' + (unaryNeedsBrackets(op, a) ? paren(render(a)) : render(a));
        case '!':
            return (unaryNeedsBrackets(op, a) ? paren(render(a)) : render(a)) + '!';
        case '\\not':
            return '\\neg ' + (unaryNeedsBrackets(op, a) ? paren(render(a)) : render(a));
        case 'sqrt':
            return `\\sqrt{${render(a)}}`;
        case 'root':
            return `\\sqrt[${render(a)}]{${render(b)}}`;
        case 'abs':
            return `\\left|${render(a)}\\right|`;
        case 'floor':
            return `\\lfloor ${render(a)} \\rfloor`;
        case 'ceil':
            return `\\lceil ${render(a)} \\rceil`;
        case 'log':
            if (a.type === 'symbol' && a.value === 'e') return `\\ln${paren(render(b))}`;
            return `\\log_{${render(a)}}${paren(render(b))}`;
        case 'expm1':
            return `\\left(e^{${render(a)}}-1\\right)`;
        case 'loglog':
            return `\\ln${paren(`\\ln${paren(render(a))}`)}`;
        case 'logloglog':
            return `\\ln${paren(`\\ln${paren(`\\ln${paren(render(a))}`)}`)}`;
        case 'perm':
            return `{}^{${render(a)}}\\mathrm{P}_{${render(b)}}`;
        case 'comb':
            return `\\binom{${render(a)}}{${render(b)}}`;
        case '?:': {
            // a piecewise function: one line per branch, an else-chain flattened into one block
            const lines = piecewise(node).map(({ value, when }) => `${render(value)} & ${when ? `\\text{if } ${render(when)}` : '\\text{otherwise}'}`);
            return `\\begin{cases}${lines.join(' \\\\ ')} \\end{cases}`;
        }
        case 'sum':
            return args.map(render).join(' + ');
        case 'mean':
            return `\\frac{${args.map(render).join(' + ')}}{${args.length}}`;
        case 'prod':
            return args.map(render).join(' \\cdot ');
        case 'der': {
            // dy/dx, d²y/dx²; d/dx [x^2 + 1] gets brackets, d/dx sin x doesn't.
            const { n, body, by, variable } = derivativeOrder(node);
            const power = n > 1 ? `^{${n}}` : '';
            if (variable) return `\\frac{\\mathrm{d}${power}${render(body)}}{\\mathrm{d}${render(by)}${power}}`;
            const inner = bracketOp(body) && precedenceOf(bracketOp(body)) < 100 ? `\\left[${render(body)}\\right]` : `{${render(body)}}`;
            return `\\frac{\\mathrm{d}${power}}{\\mathrm{d}${render(by)}${power}}${inner}`;
        }
        case 'int':
            return integral(args, render);
        case 'lim':
            return limit(args, render);
        case '\\sumidx':
            return bigOperator('\\sum', args, render);
        case '\\prodidx':
            return bigOperator('\\prod', args, render);
    }
    throw new Error(`No LaTeX for '${op}'`);
}

/** int(f), int(f, x), int(f, a), int(f, x, a), int(f, a, b), int(f, x, a, b). */
function integral(args, render) {
    const [f, second, third, fourth] = args;
    const body = `{${render(f)}}`;
    const d = (v) => `\\mathrm{d}${v}`;
    const guess = () => firstVariable(f) || 'x';
    switch (args.length) {
        case 1: return `\\int${body}${d(guess())}`;
        case 2: return isVariable(second)
            ? `\\int${body}${d(render(second))}`
            : `\\int_{${render(second)}}${body}${d(guess())}`;
        case 3: return isVariable(second)
            ? `\\int_{${render(third)}}${body}${d(render(second))}`
            : `\\int_{${render(second)}}^{${render(third)}}${body}${d(guess())}`;
        default: return `\\int_{${render(third)}}^{${render(fourth)}}${body}${d(render(second))}`;
    }
}

/** lim(f), lim(f, x→a), lim(f, a), lim(f, x, a), lim(f, x, a, side). */
function limit(args, render) {
    const [f, second, third, fourth] = args;
    const body = `{${render(f)}}`;
    switch (args.length) {
        case 1: return `\\lim${body}`;
        case 2: {
            const v = firstVariable(f);
            const approaches = second.type === 'number' || (second.type === 'symbol' && second.value.includes('∞'));
            return v && approaches ? `\\lim_{${v}\\to ${render(second)}}${body}` : `\\lim_{${render(second)}}${body}`;
        }
        case 3: return `\\lim_{${render(second)}\\to ${render(third)}}${body}`;
        default: {
            const side = firstLeaf(fourth).toLowerCase().startsWith('r') ? '^+' : '^-';
            return `\\lim_{${render(second)}\\to ${render(third)}${side}}${body}`;
        }
    }
}

/** \sumidx(f, i=1, n) → \sum_{i = 1}^{n}{f}, and \prod likewise. */
function bigOperator(symbol, args, render) {
    const [f, from, to] = args;
    if (args.length === 1) return `${symbol} {${render(f)}}`;
    if (args.length === 2) return `${symbol}_{${render(from)}}{${render(f)}}`;
    return `${symbol}_{${render(from)}}^{${render(to)}}{${render(f)}}`;
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [BLACKBOARD, COMPARISONS, NAMED, GROUPS, GREEK_NAMES]) Object.setPrototypeOf(table, null);
