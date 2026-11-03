/**
 * Tree → a spreadsheet formula, for Excel and Google Sheets (the functions
 * written are in both): `=IF(x>0, SQRT(x), 0)`.
 *
 * Only functions every spreadsheet has (Excel 2007 on, Sheets, Numbers,
 * LibreOffice): ceil is -INT(-x), sec 1/COS(x), xor NOT(a)<>NOT(b) — the
 * 2013 functions (CEILING.MATH, SEC, XOR) are missing from Numbers.
 *
 * Spreadsheets differ from the maths in ways that need care:
 *   - unary minus binds tighter than ^ (Excel: -2^2 is 4), and ^ groups left
 *     to right (2^3^2 is 64), so powers are bracketed: -(x^2), 2^(3^2);
 *   - ATAN2 takes (x, y), LOG takes (number, base), & joins text (and is AND()),
 *     % is a percentage (remainder is MOD), = compares;
 *   - there is no infinity, and no symbolic maths (derivatives, sums to n),
 *     so those throw `No spreadsheet formula for …`, as SQLite's SQL does.
 *
 * Variables are written as names (Excel's defined names) unless `cells`
 * maps them to references; `ranges` maps names to whole columns for
 * one-argument sum, mean, max … (`sum(Profit)` → SUM(D2:D101)).
 */

import { needsParens, isCustomFunction, operator } from '../operators.js';
import { bracketOp, isMinusOneTimes, customName, expandChain, isText, guardLength } from '../common.js';

/**
 * @param {object} node expression tree
 * @param {object} [options]
 * @param {Record<string, string> | ((name: string) => string | undefined)} [options.cells] name → cell reference ('B2')
 * @param {Record<string, string> | ((name: string) => string | undefined)} [options.ranges] name → range ('B2:B101')
 * @param {boolean} [options.equals] start with = (default true)
 */
export function toExcelFormula(node, options = {}) {
    const lookup = (map) => (typeof map === 'function' ? map : (name) => (map && Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined));
    const opts = { cell: lookup(options.cells), range: lookup(options.ranges), functions: options.functions };
    const render = (n) => guardLength(n.type === 'op' ? operation(n, render, opts) : leaf(n, opts));
    const body = render(node);
    return options.equals === false ? body : `=${body}`;
}

const fail = (what) => { throw new Error(`No spreadsheet formula for ${what}`); };

const CONSTANTS = { pi: 'PI()', 'π': 'PI()', e: 'EXP(1)', tau: '(2*PI())', 'τ': '(2*PI())', '°': '(PI()/180)', true: 'TRUE', false: 'FALSE' };

function leaf(node, opts) {
    const v = node.value;
    if (node.type === 'number') return v.endsWith('..') ? v.replace(/\.+$/, '') : v;
    if (node.type === 'string') {
        const quoted = /^(["'`]).*\1$/s.test(v);
        // its quotes as typed (\" in code, "" in a spreadsheet), then doubled once, as a spreadsheet writes them
        const text = quoted ? v.slice(1, -1).replace(/\\(["'\\])/g, '$1').replace(/""/g, '"') : v;
        return `"${text.replace(/"/g, '""')}"`;
    }
    const ref = opts.cell(v);
    if (ref !== undefined) return ref;
    if (Object.prototype.hasOwnProperty.call(CONSTANTS, v)) return CONSTANTS[v];
    if (v === '∞' || v === '-∞') fail('∞ (spreadsheets have no infinity)');
    if (v === 'null' || v === 'undefined') return '""';
    const name = v.replace(/′/g, '_prime').replace('⁻¹', '_inverse');
    if (!/^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name)) fail(`the name ${JSON.stringify(v)}`);
    return name;
}

const FUNCTIONS = {
    sqrt: 'SQRT', abs: 'ABS', floor: 'INT', ln: 'LN',
    sin: 'SIN', cos: 'COS', tan: 'TAN',
    sinh: 'SINH', cosh: 'COSH', tanh: 'TANH', arcsin: 'ASIN', arccos: 'ACOS', arctan: 'ATAN',
    arcsinh: 'ASINH', arccosh: 'ACOSH', arctanh: 'ATANH',
    round: 'ROUND', fixed: 'FIXED', perm: 'PERMUT', comb: 'COMBIN', gcd: 'GCD', '!': 'FACT',
    '\\not': 'NOT', '&': 'AND', '|': 'OR',
};
const RECIPROCALS = { csc: 'SIN', sec: 'COS', cot: 'TAN' };
const COMPARE = { '=': '=', '===': '=', '≡': '=', '≠': '<>', '≠=': '<>', '<': '<', '>': '>', '≤': '<=', '≥': '>=' };
/** One-argument aggregates: over a column when the argument is one (`ranges`). */
const AGGREGATES = { sum: 'SUM', prod: 'PRODUCT', mean: 'AVERAGE', max: 'MAX', min: 'MIN', '\\:median': 'MEDIAN', '\\:stdev': 'STDEVP', '\\:count': 'COUNT' };
const UNSUPPORTED = { der: 'a derivative', int: 'an integral', lim: 'a limit', '\\sumidx': 'a sum to n', '\\prodidx': 'a product to n',
    pm: '±', '±': '±', '∪': '∪', '∩': '∩', '→': '→' };

/** Brackets for a spreadsheet: as in maths, except that powers and negation bracket more. */
function excelBracketOp(node) {
    if (node.type !== 'op') return null;
    if (FUNCTIONS[node.op] || AGGREGATES[node.op] || isCustomFunction(node.op) || operator(node.op)?.group) return null;
    if (['root', 'log', 'mod', 'max', 'min', 'gcd', 'atan2', 'random', 'expm1', 'loglog', 'logloglog', '?:', '≈', '∈', '∉', 'pmod', '\\nand', '\\nor', '\\xor'].includes(node.op)) return null;
    if (RECIPROCALS[node.op]) return '/';
    if (node.op === 'ceil') return 'neg';
    return bracketOp(node);
}

/** A leaf or a call: safe on either side of ^ without brackets. */
function isAtom(node, text) {
    if (node.type === 'number') return !text.startsWith('-');
    if (node.type !== 'op') return true;
    return /^[A-Za-z_.]+\(/.test(text) && closesAtEnd(text);
}
function closesAtEnd(text) {
    let depth = 0;
    for (let i = text.indexOf('('); i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')' && --depth === 0) return i === text.length - 1;
    }
    return false;
}

function operation(node, render, opts) {
    const chained = expandChain(node);   // 3 < x < 7 is (3 < x) and (x < 7)
    if (chained) return render(chained);
    const { op, args } = node;
    const [a, b] = args;
    const side = (child, s) => (needsParens(op, excelBracketOp(child), s) ? `(${render(child)})` : render(child));
    const list = () => args.map(render).join(', ');
    if (UNSUPPORTED[op]) fail(UNSUPPORTED[op]);

    if (AGGREGATES[op] && args.length === 1) {
        const range = a.type === 'symbol' ? opts.range(a.value) : undefined;
        if (range !== undefined) return `${AGGREGATES[op]}(${range})`;
        if (op === 'sum' || op === 'prod' || op === 'mean' || op === 'max' || op === 'min') return render(a);
    }
    if (op === '+' && isText(node)) return `${render(a)}&${render(b)}`;   // joining text
    if (FUNCTIONS[op]) return `${FUNCTIONS[op]}(${list()})`;
    if (RECIPROCALS[op]) return `1/${RECIPROCALS[op]}(${render(a)})`;
    if (COMPARE[op]) return `${side(a, 'left')}${COMPARE[op]}${side(b, 'right')}`;
    if (isCustomFunction(op)) {
        // only the functions the caller lists: a spreadsheet name could be WEBSERVICE or IMPORTXML
        const name = customName(op);
        if (!(typeof opts.functions === 'function' ? opts.functions(name) : (opts.functions ?? []).some((f) => f.toLowerCase() === name.toLowerCase())) || !/^[A-Za-z_][\w.]*$/.test(name)) fail(`the function ${name}(…)`);
        return `${name}(${list()})`;
    }
    if (operator(op)?.group) {
        if (args.length === 1) return `(${render(a)})`;
        fail('a list (only after ∈)');
    }

    switch (op) {
        case '+': case '-': case '/':
            return `${side(a, 'left')}${op}${side(b, 'right')}`;
        case '*':
            return isMinusOneTimes(node) ? `-${side(b, 'right')}` : `${side(a, 'left')}*${side(b, 'right')}`;
        case 'neg': {
            const inner = render(a);   // -(x^2): a spreadsheet's minus would take x first
            return a.type === 'op' && !isAtom(a, inner) ? `-(${inner})` : `-${inner}`;
        }
        case '^': {
            if (a.type === 'symbol' && a.value === 'e') return `EXP(${render(b)})`;
            const base = render(a);
            const exponent = render(b);
            return `${isAtom(a, base) ? base : `(${base})`}^${isAtom(b, exponent) ? exponent : `(${exponent})`}`;
        }
        case 'root': {
            const index = render(a);
            return `POWER(${render(b)}, 1/${isAtom(a, index) ? index : `(${index})`})`;
        }
        case 'mod':
            return `MOD(${render(a)}, ${render(b)})`;
        case 'log':
            return a.type === 'symbol' && a.value === 'e' ? `LN(${render(b)})` : `LOG(${render(b)}, ${render(a)})`;
        case 'loglog':
            return `LN(LN(${render(a)}))`;
        case 'logloglog':
            return `LN(LN(LN(${render(a)})))`;
        case 'expm1':
            return `(EXP(${render(a)})-1)`;
        case 'atan2':   // ATAN2(x, y): the other way round
            return `ATAN2(${render(b)}, ${render(a)})`;
        case 'random':
            return 'RAND()';
        case 'max': case 'min':
            return `${op.toUpperCase()}(${list()})`;
        case 'mean':
            return `AVERAGE(${list()})`;
        case 'sum':
            return args.map((x, i) => (i && needsParens('+', excelBracketOp(x), 'right') ? `(${render(x)})` : render(x))).join('+');
        case 'prod':
            return args.map((x) => (needsParens('*', excelBracketOp(x), 'right') ? `(${render(x)})` : render(x))).join('*');
        case 'ceil':   // CEILING.MATH is not in every spreadsheet; this is exact
            return `-INT(-${isAtom(a, render(a)) ? render(a) : `(${render(a)})`})`;
        case '\\xor':   // XOR is not either; NOT makes each side true or false first
            return `(NOT(${render(a)})<>NOT(${render(b)}))`;
        case '\\nand':
            return `NOT(AND(${list()}))`;
        case '\\nor':
            return `NOT(OR(${list()}))`;
        case '?:':
            return `IF(${render(a)}, ${render(b)}, ${render(args[2])})`;
        case '≈':
            return `ABS((${render(a)})-(${render(b)}))<1E-9`;
        case 'pmod':
            return a.type === 'op' && ['≡', '='].includes(a.op)
                ? `MOD((${render(a.args[0])})-(${render(a.args[1])}), ${render(b)})=0`
                : `MOD(${render(a)}, ${render(b)})`;
        case '∈': case '∉': {
            const test = membership(a, b, render);
            return op === '∈' ? test : `NOT(${test})`;
        }
        case '_':
            return b.type === 'op' ? fail('an index') : `${render(a)}_${render(b)}`;
    }
    return fail(`'${op}'`);
}

/** x ∈ {1, 2} → OR(x=1, x=2); x ∈ [0, 1) → AND(x>=0, x<1); ℤ, ℕ, ℝ. */
function membership(x, set, render) {
    const v = render(x);
    if (set.type === 'symbol') {
        const tests = { 'ℤ': `${v}=INT(${v})`, 'ℕ': `AND(${v}=INT(${v}), ${v}>0)`, 'ℝ': `ISNUMBER(${v})` };
        return tests[set.value] ?? fail(`∈ ${set.value}`);
    }
    if (set.type === 'op' && ['()', '[]', '(]', '[)'].includes(set.op) && set.args.length === 2) {
        const [lo, hi] = set.args.map(render);
        return `AND(${v}${set.op[0] === '[' ? '>=' : '>'}${lo}, ${v}${set.op[1] === ']' ? '<=' : '<'}${hi})`;
    }
    if (set.type === 'op' && operator(set.op)?.group) return `OR(${set.args.map((item) => `${v}=${render(item)}`).join(', ')})`;
    return fail('∈ a set that is not written out');
}

/**
 * Functions newer than Excel 2007 are stored as _xlfn.NAME in an .xlsx file
 * (Excel shows #NAME? without it); typed into a cell they have no prefix.
 */
const NEWER = ['CEILING.MATH', 'FLOOR.MATH', 'STDEV.P', 'STDEV.S', 'XOR', 'CSC', 'SEC', 'COT', 'CSCH', 'SECH', 'COTH', 'ACOT', 'ACOTH', 'PERMUTATIONA', 'COMBINA'];
export function forXlsxFile(formula) {
    let out = '';
    let i = 0;
    const text = formula.startsWith('=') ? formula.slice(1) : formula;
    while (i < text.length) {
        if (text[i] === '"') {   // strings stay as written
            let j = i + 1;
            while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        const name = /^[A-Z][A-Z0-9.]*(?=\()/.exec(text.slice(i))?.[0];
        if (name && (i === 0 || !/[A-Za-z0-9_.]/.test(text[i - 1]))) {
            out += NEWER.includes(name) ? `_xlfn.${name}` : name;
            i += name.length;
        } else {
            out += text[i++];
        }
    }
    return out;
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [CONSTANTS, FUNCTIONS, RECIPROCALS, COMPARE, AGGREGATES, UNSUPPORTED]) Object.setPrototypeOf(table, null);
