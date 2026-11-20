/**
 * Tree → plain text with math symbols: `x^2 + 3 * x`, `√(x)`, `∫ x dx`; limits, definite integrals and sums
 * as the calls MathZetta reads back: `int(x, x, 0, 1)`, `lim(2 * x + 1, x → 3)`, `sum(i^2, i = 1, n)`.
 * Meant for people to read, not for any program to parse.
 */

import { needsParens, isCustomFunction } from '../operators.js';
import { GREEK, bracketOp, unaryNeedsBrackets, isMinusOneTimes, isVariable, firstLeaf, customName, derivativeOrder, guardLength, MATRICES, matrixRows, conditionNeedsBrackets } from '../common.js';
import { firstVariable } from '../tree.js';

export function toPlainText(node) {
    const render = (n) => guardLength(n.type === 'op' ? operation(n, render) : leaf(n));
    return render(node);
}

function leaf(node) {
    const v = node.value;
    if (node.type !== 'symbol') return v;
    if (GREEK[v]) return GREEK[v];
    if (v === '\\+' || v === '\\-') return v[1];
    return v;
}

const INFIX = {
    '+': '+', '-': '-', '*': '*', '/': '/', '^': '^', mod: 'mod', '±': '±',
    '=': '=', '===': '===', '≠': '≠', '≠=': '≠', '<': '<', '>': '>', '≤': '≤', '≥': '≥',
    '∈': '∈', '∉': '∉', '→': '→', '≈': '≈', '∪': '∪', '∩': '∩', '≡': '≡',
    '&': '∧', '|': '∨', '\\xor': '⊕', '\\nand': '↑', '\\nor': '↓',
};

const GROUPS = { '()': ['(', ')'], '[]': ['[', ']'], '{}': ['{', '}'], '(]': ['(', ']'], '[)': ['[', ')'] };

function operation(node, render) {
    const { op, args } = node;
    const [a, b] = args;
    const side = (child, s) => (needsParens(op, bracketOp(child), s) ? `(${render(child)})` : render(child));
    const list = () => args.map(render).join(', ');
    const unary = (child) => (unaryNeedsBrackets(op, child) ? `(${render(child)})` : render(child));

    // -1·x is written -x, bracketed as -x is; a + (-1·x) is a - x, and a - (-1·x) is a + x
    if (op === '*' && isMinusOneTimes(node)) return operation({ ...node, op: 'neg', args: [b] }, render);
    if (op === '+' && isMinusOneTimes(b)) return operation({ ...node, op: '-', args: [a, b.args[1]] }, render);
    if (op === '-' && isMinusOneTimes(b)) return operation({ ...node, op: '+', args: [a, b.args[1]] }, render);
    if (op === '^') {
        const base = side(a, 'left');
        return `${base.startsWith('-') ? `(${base})` : base}^${side(b, 'right')}`;
    }
    // a product typed with · or × keeps it, so the text reads back the same way (parseSteps' written)
    if (op === '*' && node.written) return `${side(a, 'left')} ${node.written === 'cross' ? '×' : '·'} ${side(b, 'right')}`;
    if (INFIX[op]) return `${side(a, 'left')} ${INFIX[op]} ${side(b, 'right')}`;
    if (MATRICES[op]) return `${op}(${matrixRows(node).map((r) => `[${r.map(render).join(', ')}]`).join(', ')})`;
    if (GROUPS[op]) return GROUPS[op][0] + list() + GROUPS[op][1];
    if (isCustomFunction(op)) return `${customName(op)}(${list()})`;

    switch (op) {
        case 'neg': return '-' + unary(a);
        case 'pmod': return `${render(a)} (mod ${render(b)})`;
        case 'pm': return '±' + unary(a);
        case '!': return unary(a) + '!';
        case '\\not': return '¬' + unary(a);
        case 'sqrt': return `√(${render(a)})`;
        case 'root': {   // 3√(x) would read as 3 times √(x)
            const index = a.type === 'number' ? { 3: '∛', 4: '∜' }[a.value] : null;
            return index ? `${index}(${render(b)})` : `root(${render(a)}, ${render(b)})`;
        }
        case 'abs': return `|${render(a)}|`;
        case 'floor': return `⌊${render(a)}⌋`;
        case 'ceil': return `⌈${render(a)}⌉`;
        case 'log': return `log_${a.type === 'op' ? `(${render(a)})` : render(a)}(${render(b)})`;
        case 'loglog': return `ln(ln(${render(a)}))`;
        case 'logloglog': return `ln(ln(ln(${render(a)})))`;
        case 'perm': return `perm(${render(a)}, ${render(b)})`;   // nPk and C(n, k) would read back as products
        case 'comb': return `comb(${render(a)}, ${render(b)})`;
        case '_': return `${render(a)}_${render(b)}`;
        case '?:': return `${conditionNeedsBrackets(a) ? `(${render(a)})` : render(a)} ? ${render(b)} : ${render(args[2])}`;   // (y = x > 0) ? …: see conditionNeedsBrackets
        // each term bracketed as + and * would bracket it: prod(a + b, c) is (a + b) * c
        case 'sum': return args.map((x, i) => (needsParens('+', bracketOp(x), i ? 'right' : 'left') ? `(${render(x)})` : render(x))).join(' + ');
        case 'prod': return args.map((x, i) => (needsParens('*', bracketOp(x), i ? 'right' : 'left') ? `(${render(x)})` : render(x))).join(' * ');
        case 'der': {
            const { n, body, by, at, variable } = derivativeOrder(node);
            // at a point: der(f, x = 2), and der(f, x = 2, n) for the nth derivative (both read back)
            if (at) return `der(${render(body)}, ${render(by)} = ${render(at)}${n > 1 ? `, ${n}` : ''})`;
            const power = n > 1 ? `^${n}` : '';
            return variable
                ? `d${power}${render(body)}/d${render(by)}${power}`
                : `d${power}/d${render(by)}${power}(${render(body)})`;
        }
        case 'int': return integral(args, render);
        case 'lim': return limit(args, render);
        case '\\sumidx': return bigOperator('∑', args, render);
        case '\\prodidx': return bigOperator('∏', args, render);
    }
    return `${op}(${list()})`;   // sin, max, round, ... read fine as calls
}

function integral(args, render) {
    const [f, second, third, fourth] = args;
    const v = args.length >= 2 && isVariable(second) ? render(second) : firstVariable(f) || 'x';
    const body = `${render(f)} d${v}`;
    // ∫ x dx reads back as written; with bounds, the call does (∫[0, 1] x dx would not, nor show where the body ends)
    if (args.length === 1 || (args.length === 2 && isVariable(second))) return `∫ ${body}`;
    return `int(${args.map(render).join(', ')})`;
}

function limit(args, render) {
    const [f, second, third, fourth] = args;
    // lim(f, x → a), lim(f, x, a[, r|l]): the calls MathZetta reads back, the body bracketed by the call itself
    if (args.length === 4) return `lim(${render(f)}, ${render(second)}, ${render(third)}, ${firstLeaf(fourth).toLowerCase().startsWith('r') ? 'r' : 'l'})`;
    return `lim(${args.map(render).join(', ')})`;
}

function bigOperator(symbol, args, render) {
    const [f, from, to] = args;
    const name = symbol === '∑' ? 'sum' : 'prod';
    // sum(f, i = a, b) and prod(f, i ∈ S) read back as indexed (parse/build.js)
    if (args.length === 3 && from.type === 'op' && from.op === '=') return `${name}(${render(f)}, ${render(from)}, ${render(to)})`;
    if (args.length === 2 && from.type === 'op' && from.op === '∈') return `${name}(${render(f)}, ${render(from)})`;
    // ∑_0^3 i^2 names no index: the body's variable is it, written out so it reads back
    const index = firstVariable(f);
    if (args.length === 3 && index) return `${name}(${render(f)}, ${index} = ${render(from)}, ${render(to)})`;
    if (args.length === 1) return `${symbol} ${render(f)}`;
    if (args.length === 2) return `${symbol}[${render(from)}] ${render(f)}`;
    return `${symbol}[${render(from)}, ${render(to)}] ${render(f)}`;
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [INFIX, GROUPS]) Object.setPrototypeOf(table, null);
