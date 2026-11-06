/**
 * Tree → SQL expression. PostgreSQL flavoured by default (POWER, LN,
 * GREATEST, ...); `dialect: 'sqlite'` writes SQL that SQLite (3.35+, built
 * with its math functions) runs: real division, MAX/MIN, 9e999 for ∞, and
 * an error for anything SQLite has no function for.
 */

import { needsParens, isCustomFunction, operator } from '../operators.js';
import { bracketOp, unaryNeedsBrackets, isMinusOneTimes, customName, expandChain, isText, guardLength, MATRICES, matrixRows } from '../common.js';

/**
 * @param {object} node expression tree
 * @param {object} [options]
 * @param {'postgres'|'sqlite'} [options.dialect] default 'postgres'
 * @param {boolean} [options.quoteIdentifiers] write variables as "column" names
 * @param {string} [options.stringQuote] quote character for string literals
 *   (by default strings keep the quotes they were typed with, backticks becoming
 *   single quotes; in the sqlite dialect they default to single quotes, since
 *   SQLite reads "x" as a column). The text is always re-escaped by doubling.
 * @param {Iterable<string>} [options.columns] names that are always columns,
 *   even when they look like a constant (a column called `e` or `pi`)
 */
export function toSqlCode(node, options = {}) {
    const dialect = options.dialect ?? 'postgres';
    if (dialect !== 'postgres' && dialect !== 'sqlite') throw new Error(`Unknown SQL dialect '${dialect}'`);
    const sqlite = dialect === 'sqlite';
    const opts = {
        ...options,
        sqlite,
        stringQuote: options.stringQuote ?? (sqlite ? "'" : undefined),
        columns: new Set(options.columns ?? []),
    };
    const render = (n) => guardLength(n.type === 'op' ? operation(n, render, opts) : leaf(n, opts));
    return render(node);
}

const CONSTANTS = { pi: 'PI()', 'π': 'PI()', e: 'EXP(1)', '∞': "'Infinity'", true: 'TRUE', false: 'FALSE', null: 'NULL' };
// SQLite has no infinity literal, but a real too big for a double reads as one.
const SQLITE_CONSTANTS = { ...CONSTANTS, '∞': '9e999', '-∞': '-9e999', tau: '(2 * PI())', 'τ': '(2 * PI())' };

function leaf(node, options) {
    const v = node.value;
    if (node.type === 'number') return v.endsWith('..') ? v.replace(/\.+$/, '') : v;
    if (node.type === 'string') {
        // by default the quote it was typed with; either way the text is re-escaped SQL's way (a quote doubled),
        // since SQL reads no backslash escapes: 'x\' OR 1=1 --' written as typed would end at x\ and run the rest
        const typed = /^(["'`]).*\1$/s.test(v) ? v[0] : '';
        const q = options.stringQuote ?? (typed === '"' ? '"' : "'");
        const text = typed ? v.slice(1, -1).replace(/\\([\\'"`])/g, '$1') : v;
        return q + text.split(q).join(q + q) + q;
    }
    if (options.columns.has(v)) return `"${v.replace(/"/g, '""')}"`;
    const constants = options.sqlite ? SQLITE_CONSTANTS : CONSTANTS;
    if (Object.prototype.hasOwnProperty.call(constants, v)) return constants[v];
    if (v === '°') return '(PI()/180)';
    // a name that isn't a plain identifier (a space, a quote, a keyword's company) is always quoted
    return options.quoteIdentifiers || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const FUNCTIONS = {
    sqrt: 'SQRT', abs: 'ABS', floor: 'FLOOR', ceil: 'CEIL', ln: 'LN', expm1: 'EXPM1',
    sin: 'SIN', cos: 'COS', tan: 'TAN', csc: 'CSC', sec: 'SEC', cot: 'COT',
    sinh: 'SINH', cosh: 'COSH', tanh: 'TANH', arcsin: 'ASIN', arccos: 'ACOS', arctan: 'ATAN',
    arcsinh: 'ASINH', arccosh: 'ACOSH', arctanh: 'ATANH', atan2: 'ATAN2',
    round: 'ROUND', perm: 'PERM', comb: 'COMB', max: 'GREATEST', min: 'LEAST', gcd: 'GCD',
    random: 'RANDOM', der: 'DERIVATIVE', int: 'INTEGRATE', lim: 'LIMIT',
    '\\sumidx': 'SUMMATION', '\\prodidx': 'PRODUCT', '!': 'FACTORIAL',
};

const INFIX = {
    '+': '+', '-': '-', '*': '*', '/': '/',
    '=': '=', '===': '=', '≠': '<>', '≠=': '<>', '<': '<', '>': '>', '≤': '<=', '≥': '>=',
};

const GROUPS = { '()': ['(', ')'], '{}': ['(', ')'], '[]': ['ARRAY[', ']'], '(]': ['(', ')'], '[)': ['(', ')'] };

// What SQLite has no function for. Groups of several items and intervals
// are only allowed as the right side of ∈ / ∉.
const SQLITE_UNSUPPORTED = new Set([
    '!', 'gcd', 'perm', 'comb', 'der', 'int', 'lim', '\\sumidx', '\\prodidx',
    '±', 'pm', '∪', '∩', '_', '→', 'pmatrix', 'bmatrix', 'vmatrix', 'det',
]);

const SQLITE_FUNCTIONS = { max: 'MAX', min: 'MIN' };
const SQLITE_RECIPROCALS = { csc: 'SIN', sec: 'COS', cot: 'TAN' };

function operation(node, render, options) {
    const chained = expandChain(node);   // 3 < x < 7 is (3 < x) and (x < 7)
    if (chained) return render(chained);
    const { op, args } = node;
    const [a, b] = args;
    const sideOf = (parentOp, child, s) => (needsParens(parentOp, sqlBracketOp(child), s) ? `(${render(child)})` : render(child));
    const side = (child, s) => sideOf(op, child, s);
    const list = () => args.map(render).join(', ');

    if (options.sqlite) {
        const out = sqliteOperation(node, render, side, list);
        if (out !== undefined) return out;
    }

    if (op === '*' && isMinusOneTimes(node)) return '-' + render(b);
    if (op === '+' && isText(node)) return `${render(a)} || ${render(b)}`;   // joining text
    if (INFIX[op]) return `${side(a, 'left')} ${INFIX[op]} ${side(b, 'right')}`;
    if (FUNCTIONS[op]) return `${FUNCTIONS[op]}(${list()})`;
    if (op === 'vmatrix' || op === 'det') throw new Error('No SQL for a determinant');
    if (MATRICES[op]) return `ARRAY[${matrixRows(node).map((r) => `ARRAY[${r.map(render).join(', ')}]`).join(', ')}]`;
    if (GROUPS[op]) return GROUPS[op][0] + list() + GROUPS[op][1];
    if (isCustomFunction(op)) {
        // f(x) names no SQL function of ours, and a name in SQL could be anything the database has
        // (a subquery's words, load_extension): only the functions the caller lists are written
        const name = customName(op);
        if (!(typeof options.functions === 'function' ? options.functions(name) : (options.functions ?? []).some((f) => f.toLowerCase() === name.toLowerCase())) || !/^[A-Za-z_]\w*$/.test(name)) {
            throw new Error(`No SQL for the function ${name}(…)`);
        }
        return `${name.toUpperCase()}(${list()})`;
    }

    switch (op) {
        case '^':
            return `POWER(${render(a)}, ${render(b)})`;
        case 'root':
            return `POWER(${render(b)}, 1.0 / (${render(a)}))`;
        case 'mod':
            return `MOD(${render(a)}, ${render(b)})`;
        case 'log':
            return a.type === 'symbol' && a.value === 'e' ? `LN(${render(b)})` : `LOG(${render(a)}, ${render(b)})`;
        case 'loglog':
            return `LN(LN(${render(a)}))`;
        case 'logloglog':
            return `LN(LN(LN(${render(a)})))`;
        case 'neg':
            return '-' + (unaryNeedsBrackets(op, a) ? `(${render(a)})` : render(a));
        case 'pm':
            return `ARRAY[${render(a)}, -(${render(a)})]`;
        case '≈':
            return `ABS((${render(a)}) - (${render(b)})) < 1e-9`;
        case '≡':
            return `${side(a, 'left')} = ${side(b, 'right')}`;
        case 'pmod':
            return a.type === 'op' && ['≡', '='].includes(a.op)
                ? `MOD((${render(a.args[0])}) - (${render(a.args[1])}), ${render(b)}) = 0`
                : `MOD(${render(a)}, ${render(b)})`;
        case '∪':
            return `UNION(${render(a)}, ${render(b)})`;
        case '∩':
            return `INTERSECTION(${render(a)}, ${render(b)})`;
        case '\\not':
            return 'NOT ' + (unaryNeedsBrackets(op, a) ? `(${render(a)})` : render(a));
        case '&':
            return `(${render(a)} AND ${render(b)})`;
        case '|':
            return `(${render(a)} OR ${render(b)})`;
        case '\\xor':
            return `((${side(a, 'left')} AND NOT (${side(b, 'right')})) OR (NOT (${side(a, 'left')}) AND ${side(b, 'right')}))`;
        case '\\nand':
            return `NOT (${side(a, 'left')} AND ${side(b, 'right')})`;
        case '\\nor':
            return `NOT (${side(a, 'left')} OR ${side(b, 'right')})`;
        case '?:':
            return `CASE WHEN ${render(a)} THEN ${render(b)} ELSE ${render(args[2])} END`;
        case 'fixed':   // a NUMERIC keeps its scale, so ROUND(…::numeric, 2) shows 2.50, not 2.5
            return `ROUND(CAST(${render(a)} AS NUMERIC), ${render(b)})`;
        case 'sum':   // written out as a + b + c, so bracket like +
            return args.map((x, i) => sideOf('+', x, i ? 'right' : 'left')).join(' + ');
        case 'prod':
            return args.map((x, i) => sideOf('*', x, i ? 'right' : 'left')).join(' * ');
        case 'mean':
            return `((${args.map(render).join(' + ')}) / ${args.length})`;
        case '∈': case '∉':
            return membership(node, render);
        case '±':
            return `ARRAY[${render(a)} + ${side(b, 'right')}, ${render(a)} - ${side(b, 'right')}]`;
        case '→':
            return `${render(a)}, ${render(b)}`;
        case '_':
            return `${render(a)}_${render(b)}`;
    }
    throw new Error(`No SQL for '${op}'`);
}

/**
 * The SQLite spellings that differ from PostgreSQL; undefined means "same".
 */
function sqliteOperation(node, render, side, list) {
    const { op, args } = node;
    const [a, b] = args;
    if (SQLITE_UNSUPPORTED.has(op)) throw new Error(`No SQLite SQL for '${op}'`);
    if (SQLITE_FUNCTIONS[op]) return args.length === 1 ? render(a) : `${SQLITE_FUNCTIONS[op]}(${list()})`;
    if (SQLITE_RECIPROCALS[op]) return `(1.0 / ${SQLITE_RECIPROCALS[op]}(${render(a)}))`;
    if (operator(op)?.group) {
        // A lone bracketed value is just brackets; (a, b) or [1, 2) has no meaning outside ∈.
        if (args.length === 1) return `(${render(a)})`;
        throw new Error(`No SQLite SQL for '${op}' outside ∈`);
    }
    switch (op) {
        case '/':   // SQLite divides integers as integers: 7 / 2 is 3
            return `${realLeft(a, render, side)} / ${side(b, 'right')}`;
        case 'expm1':
            return `(EXP(${render(a)}) - 1)`;
        case 'mean':
            return `((${args.map(render).join(' + ')}) / ${args.length}.0)`;
        case 'fixed':   // text with exactly that many decimals
            return b.type === 'number' && /^\d+$/.test(b.value) ? `printf('%.${b.value}f', ${render(a)})` : `printf('%.' || (${render(b)}) || 'f', ${render(a)})`;
        case '∈': case '∉':
            return sqliteNumberSet(node, render);
    }
    return undefined;
}

// Operators whose SQLite form is always a real (SQLite's math functions
// return reals), so dividing by something is already real division.
const SQLITE_REAL = new Set([
    '/', 'mean', '^', 'root', 'sqrt', 'ln', 'log', 'loglog', 'logloglog', 'expm1', 'mod', 'round', 'atan2',
    'sin', 'cos', 'tan', 'csc', 'sec', 'cot', 'sinh', 'cosh', 'tanh',
    'arcsin', 'arccos', 'arctan', 'arcsinh', 'arccosh', 'arctanh',
]);

/** The left side of a division, made real unless it already is. */
function realLeft(a, render, side) {
    if (a.type === 'number') {
        const n = render(a);
        return /^-?\d+$/.test(n) ? `${n}.0` : n;
    }
    if (a.type === 'op' && SQLITE_REAL.has(a.op)) return side(a, 'left');
    return `CAST(${render(a)} AS REAL)`;
}

/** x ∈ ℝ, ℤ, ℕ in SQLite; undefined for other sets. */
function sqliteNumberSet(node, render) {
    const [x, set] = node.args;
    if (set.type !== 'symbol') return undefined;
    const v = render(x);
    const numeric = `typeof(${v}) IN ('integer', 'real')`;
    const tests = {
        'ℝ': `(${numeric} AND ABS(${v}) < 9e999)`,
        'ℤ': `(${numeric} AND ${v} = TRUNC(${v}))`,
        'ℕ': `(${numeric} AND ${v} = TRUNC(${v}) AND ${v} > 0)`,
    };
    const test = tests[set.value];
    if (!test) return undefined;
    return node.op === '∈' ? test : `NOT ${test}`;
}

const SELF_BRACKETED = new Set(['&', '|', '\\xor', 'mean']);

function sqlBracketOp(node) {
    if (node.type !== 'op' || SELF_BRACKETED.has(node.op) || FUNCTIONS[node.op]) return null;
    if (['csc', 'sec', 'cot', 'expm1'].includes(node.op)) return null;   // bracketed or a call either way
    return bracketOp(node);
}

/** x ∈ ℝ, ℤ, ℕ in PostgreSQL (SQLite's are above): IN (ℤ) would be no SQL at all. */
const POSTGRES_NUMBER_SETS = {
    'ℝ': (v) => `(ABS(${v}) < 'Infinity')`,
    'ℤ': (v) => `(${v} = TRUNC(${v}))`,
    'ℕ': (v) => `(${v} = TRUNC(${v}) AND ${v} > 0)`,
};

function membership(node, render) {
    const [x, set] = node.args;
    const v = render(x);
    const negate = node.op === '∉';
    const numbers = set.type === 'symbol' && POSTGRES_NUMBER_SETS[set.value];
    if (numbers) return negate ? `NOT ${numbers(v)}` : numbers(v);
    if (set.type === 'op' && ['()', '[]', '(]', '[)'].includes(set.op) && set.args.length === 2) {
        const [lo, hi] = set.args.map(render);
        const test = `(${v} ${set.op[0] === '[' ? '>=' : '>'} ${lo} AND ${v} ${set.op[1] === ']' ? '<=' : '<'} ${hi})`;
        return negate ? `NOT ${test}` : test;
    }
    const items = set.type === 'op' && set.op in GROUPS ? `(${set.args.map(render).join(', ')})` : `(${render(set)})`;
    return `${v} ${negate ? 'NOT IN' : 'IN'} ${items}`;
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [CONSTANTS, SQLITE_CONSTANTS, FUNCTIONS, INFIX, GROUPS, SQLITE_FUNCTIONS, SQLITE_RECIPROCALS, POSTGRES_NUMBER_SETS]) Object.setPrototypeOf(table, null);
