/**
 * Tree → SQL expression. PostgreSQL flavored by default (POWER, LN,
 * GREATEST, ...); `dialect: 'sqlite'` writes SQL that SQLite (3.35+, built
 * with its math functions) runs: real division, MAX/MIN, 9e999 for ∞, and
 * an error for anything SQLite has no function for.
 */

import { firstVariable } from '../tree.js';
import { needsParens, isCustomFunction, operator } from '../operators.js';
import { bracketOp, unaryNeedsBrackets, isMinusOneTimes, customName, expandChain, isText, guardLength, MATRICES, matrixRows, percentDecimal, withIndex , repeatingDecimal, inverseReciprocal, evaluationDifference, setCondition } from '../common.js';

/**
 * @param {object} node expression tree
 * @param {object} [options]
 * @param {'postgres'|'sqlite'} [options.dialect] default 'postgres'
 * @param {boolean} [options.quoteIdentifiers] write variables as "column" names
 * @param {string} [options.stringQuote] quote character for string literals
 *   (by default single quotes, in both dialects: SQL reads "x" as a column).
 *   The text is always re-escaped by doubling.
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
        stringQuote: options.stringQuote ?? "'",   // "Bob" in PostgreSQL is the column Bob
        columns: new Set(options.columns ?? []),
    };
    // each node is written once, however often a rule asks for it: a rule that reads its operands, then falls back
    // to another that reads them again, doubled the work at every level (x/y/y/… 25 deep took seconds)
    const written = new Map();
    const render = (n) => {
        let text = written.get(n);
        if (text === undefined && n.type === 'op' && n.op === 'setbuilder') throw new Error(`No ${opts.sqlite ? 'SQLite SQL' : 'SQL'} for a set described by a condition (only a test of membership in one)`);
        const test = text === undefined ? setCondition(n) : null;   // y ∈ {x | P}: P with y for x
        if (test) written.set(n, text = `(${render(test)})`);
        if (text === undefined) written.set(n, text = guardLength(n.type === 'op' ? operation(n, render, opts) : leaf(n, opts)));
        return text;
    };
    return render(node);
}

const CONSTANTS = {
    pi: 'PI()', 'π': 'PI()', e: 'EXP(1)', tau: '(2 * PI())', 'τ': '(2 * PI())', '∞': "'Infinity'", '-∞': "'-Infinity'",
    true: 'TRUE', false: 'FALSE', null: 'NULL',
};
/** Words SQL reads as values or syntax, never as a column: a variable called user is written "user". */
const RESERVED = new Set(['user', 'current_user', 'session_user', 'current_role', 'current_date', 'current_time',
    'current_timestamp', 'current_catalog', 'current_schema', 'localtime', 'localtimestamp', 'default', 'all', 'any', 'some',
    'and', 'or', 'not', 'is', 'in', 'like', 'between', 'case', 'when', 'then', 'else', 'end', 'select', 'from', 'where',
    'null', 'true', 'false', 'cast', 'as', 'distinct', 'array', 'exists', 'rowid', 'oid']);
// SQLite has no infinity literal, but a real too big for a double reads as one.
const SQLITE_CONSTANTS = { ...CONSTANTS, '∞': '9e999', '-∞': '-9e999', tau: '(2 * PI())', 'τ': '(2 * PI())' };

function leaf(node, options) {
    const v = node.value;
    if (node.type === 'number') return v.endsWith('..') ? repeatingDecimal(v) : v;
    if (v === '⋯') throw new Error(`No SQL for ⋯: a sum written out with "and so on" has no value to work out (write it with ∑)`);
    if (node.type === 'string') {
        // by default the quote it was typed with; either way the text is re-escaped SQL's way (a quote doubled),
        // since SQL reads no backslash escapes: 'x\' OR 1=1 --' written as typed would end at x\ and run the rest
        const typed = /^(["'`]).*\1$/s.test(v) ? v[0] : '';
        const q = options.stringQuote ?? (typed === '"' ? '"' : "'");
        const text = typed ? v.slice(1, -1).replace(/\\([\\'"`])/g, '$1') : v;
        return q + text.split(q).join(q + q) + q;
    }
    if (options.columns.has(v)) return `"${v.replace(/"/g, '""')}"`;
    const percent = percentDecimal(v);
    if (percent) return percent;   // 50% is 0.5
    const constants = options.sqlite ? SQLITE_CONSTANTS : CONSTANTS;
    if (Object.prototype.hasOwnProperty.call(constants, v)) return constants[v];
    if (v === '°') return '(PI()/180)';
    // a name that isn't a plain identifier (a space, a quote, a keyword's company) is always quoted
    return options.quoteIdentifiers || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(v) || RESERVED.has(v.toLowerCase()) ? `"${v.replace(/"/g, '""')}"` : v;
}

const FUNCTIONS = {
    sqrt: 'SQRT', abs: 'ABS', floor: 'FLOOR', ceil: 'CEIL', ln: 'LN',
    sin: 'SIN', cos: 'COS', tan: 'TAN', cot: 'COT',
    sinh: 'SINH', cosh: 'COSH', tanh: 'TANH', arcsin: 'ASIN', arccos: 'ACOS', arctan: 'ATAN',
    arcsinh: 'ASINH', arccosh: 'ACOSH', arctanh: 'ATANH', atan2: 'ATAN2',
    max: 'GREATEST', min: 'LEAST', gcd: 'GCD', random: 'RANDOM', '!': 'FACTORIAL',
};

/** What SQL has no function for and can't be written with others: refused by name, never a call that fails in the database. */
const NO_SQL = {
    der: 'a derivative', int: 'an integral', lim: 'a limit', '\\sumidx': 'a sum to n', '\\prodidx': 'a product to n',
    '∪': 'a union of sets', '∩': 'an intersection of sets',
};

const INFIX = {
    '+': '+', '-': '-', '*': '*', '/': '/',
    '=': '=', '===': '=', '≠': '<>', '≠=': '<>', '<': '<', '>': '>', '≤': '<=', '≥': '>=',
};

const GROUPS = { '()': ['(', ')'], '{}': ['(', ')'], '[]': ['ARRAY[', ']'], '(]': ['(', ')'], '[)': ['(', ')'] };

// What SQLite has no function for. Groups of several items and intervals
// are only allowed as the right side of ∈ / ∉.
/** What a SQLite refusal calls each operator (the rest as NO_SQL words them). */
const SQLITE_WORDS = {
    '!': 'a factorial', gcd: 'gcd', perm: 'permutations (perm)', comb: 'combinations (comb)', '±': '±', pm: '±',
    _: 'an index into a list', '→': '→', pmatrix: 'a matrix', bmatrix: 'a matrix', vmatrix: 'a determinant', det: 'a determinant',
};
const SQLITE_UNSUPPORTED = new Set([
    '!', 'gcd', 'perm', 'comb', 'der', 'int', 'lim', '\\sumidx', '\\prodidx',
    '±', 'pm', '∪', '∩', '_', '→', 'pmatrix', 'bmatrix', 'vmatrix', 'det',
]);

const SQLITE_FUNCTIONS = { max: 'MAX', min: 'MIN' };
const SQLITE_RECIPROCALS = { csc: 'SIN', sec: 'COS', cot: 'TAN' };

const COMPARING = new Set(['=', '===', '≠', '≠=', '<', '>', '≤', '≥', '≡']);

function operation(node, render, options) {
    node = withIndex(node, firstVariable);   // ∑_0^3 i^2 is written SUMMATION(…, i = 0, 3), which reads back
    const chained = expandChain(node);   // 3 < x < 7 is (3 < x) and (x < 7)
    if (chained) return render(chained);
    const { op, args } = node;
    const [a, b] = args;
    // PostgreSQL gives every comparison the same precedence (and no associativity): c = (a < b) keeps its brackets
    const sideOf = (parentOp, child, s) => (needsParens(parentOp, sqlBracketOp(child), s) || (COMPARING.has(parentOp) && COMPARING.has(sqlBracketOp(child)))
        ? `(${render(child)})` : render(child));
    const side = (child, s) => sideOf(op, child, s);
    const list = () => args.map(render).join(', ');

    if (options.sqlite) {
        const out = sqliteOperation(node, render, side, list, sideOf);
        if (out !== undefined) return out;
    }

    if (op === '*' && isMinusOneTimes(node)) return operation({ ...node, op: 'neg', args: [b] }, render, options);   // -x, bracketed as -x is
    if (op === '+' && isText(node)) return `${render(a)} || ${render(b)}`;   // joining text
    // a whole number divided is integer division in PostgreSQL (1 / 2 is 0): its numerator is written real.
    // (Integer columns still divide as integers; strToSQL's SQLite dialect casts them, PostgreSQL's does not.)
    if (op === '/' && a.type === 'number' && /^-?\d+$/.test(a.value)) return `${render(a)}.0 / ${side(b, 'right')}`;
    if (INFIX[op]) return `${side(a, 'left')} ${INFIX[op]} ${side(b, 'right')}`;
    if (NO_SQL[op]) throw new Error(`No SQL for ${NO_SQL[op]}`);
    const inverse = inverseReciprocal(node) ?? evaluationDifference(node);   // [F]_a^b: F(b) - F(a)
    if (inverse) return `(${render(inverse)})`;   // arcsec u: ACOS(1.0 / u)
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
        // PostgreSQL has none of these by name; each is a line of the functions it has
        case 'expm1':
            return `(EXP(${render(a)}) - 1)`;
        case 'csc':
            return `(1.0 / SIN(${render(a)}))`;
        case 'sec':
            return `(1.0 / COS(${render(a)}))`;
        case 'perm':   // n! / (n − k)!, exact for whole numbers: FACTORIAL gives NUMERIC
            return `(FACTORIAL(${render(a)}) / FACTORIAL(${render(a)} - ${sideOf('-', b, 'right')}))`;
        case 'comb':
            return `(FACTORIAL(${render(a)}) / (FACTORIAL(${render(b)}) * FACTORIAL(${render(a)} - ${sideOf('-', b, 'right')})))`;
        case 'root': {
            // an odd root of a negative number is real: cbrt(-8) is -2, where POWER(-8, 1.0/3) fails
            const n = a.type === 'number' && /^\d+$/.test(a.value) ? Number(a.value) : 0;
            if (n > 1 && n % 2 === 1) {
                const x = render(b);
                if (n === 3 && !options.sqlite) return `CBRT(${x})`;
                const v = /^[\w."]+$/.test(x) ? x : `(${x})`;
                return `(CASE WHEN ${v} < 0 THEN -POWER(-${v}, 1.0 / ${n}) ELSE POWER(${v}, 1.0 / ${n}) END)`;
            }
            return `POWER(${render(b)}, 1.0 / (${render(a)}))`;
        }
        case 'round':   // PostgreSQL has ROUND(x, d) for NUMERIC only, which takes halves away from zero
            return `ROUND(CAST(${render(a)} AS NUMERIC), ${render(b)})`;
        case 'mod': {   // SQL's MOD takes the sign of a; mod in math takes the divisor's: -7 mod 3 is 2
            const [x, n] = [render(a), render(b)];
            if (/^\d+(\.\d+)?$/.test(x) && /^\d+(\.\d+)?$/.test(n)) return `MOD(${x}, ${n})`;   // 7 mod 3: no sign to take
            return `MOD(MOD(${x}, ${n}) + ${n}, ${n})`;
        }
        case 'log':
            return a.type === 'symbol' && a.value === 'e' ? `LN(${render(b)})` : `LOG(${render(a)}, ${render(b)})`;
        case 'loglog':
            return `LN(LN(${render(a)}))`;
        case 'logloglog':
            return `LN(LN(LN(${render(a)})))`;
        case 'neg': {   // never --x: that starts a comment in SQL
            const inner = unaryNeedsBrackets(op, a) ? `(${render(a)})` : render(a);
            return '-' + (inner.startsWith('-') ? `(${inner})` : inner);
        }
        case 'pm':
            return `ARRAY[${render(a)}, -(${render(a)})]`;
        case '≈':
            return `ABS((${render(a)}) - (${render(b)})) < 1e-9`;
        case '≡':
            return `${side(a, 'left')} = ${side(b, 'right')}`;
        case 'pmod':
            return a.type === 'op' && ['≡', '='].includes(a.op)
                ? `MOD((${render(a.args[0])}) - (${render(a.args[1])}), ${render(b)}) = 0`
                : operation({ ...node, op: 'mod' }, render, options);   // x (mod n) alone is x mod n, with the divisor's sign
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
        case '\\implies':
            return `(NOT (${side(a, 'left')}) OR ${side(b, 'right')})`;
        case '\\iff':
            return `((${render(a)}) = (${render(b)}))`;
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
        case 'mean':   // written out as a sum, so bracket like +
            return `((${args.map((x, i) => sideOf('+', x, i ? 'right' : 'left')).join(' + ')}) / ${args.length}.0)`;   // .0: whole numbers divide as whole numbers
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
function sqliteOperation(node, render, side, list, sideOf) {
    const { op, args } = node;
    const [a, b] = args;
    if (SQLITE_UNSUPPORTED.has(op)) throw new Error(`No SQLite SQL for ${NO_SQL[op] ?? SQLITE_WORDS[op] ?? `'${op}'`}`);
    if (SQLITE_FUNCTIONS[op]) return args.length === 1 ? (a.type === 'op' ? `(${render(a)})` : render(a)) : `${SQLITE_FUNCTIONS[op]}(${list()})`;
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
        case 'round':   // SQLite's ROUND takes any number, and halves away from zero
            return `ROUND(${list()})`;
        case 'mean':
            return `((${args.map((x, i) => sideOf('+', x, i ? 'right' : 'left')).join(' + ')}) / ${args.length}.0)`;
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
        __proto__: null,   // x ∈ toString is no set
        'ℝ': `(${numeric} AND ABS(${v}) < 9e999)`,
        'ℤ': `(${numeric} AND ${v} = TRUNC(${v}))`,
        'ℕ': `(${numeric} AND ${v} = TRUNC(${v}) AND ${v} > 0)`,
    };
    const test = tests[set.value];
    if (!test) return undefined;
    return node.op === '∈' ? test : `NOT ${test}`;
}

const SELF_BRACKETED = new Set(['&', '|', '\\xor', '\\implies', '\\iff', 'mean']);

function sqlBracketOp(node) {
    if (node.type !== 'op' || SELF_BRACKETED.has(node.op) || FUNCTIONS[node.op]) return null;
    if (['csc', 'sec', 'cot', 'expm1'].includes(node.op)) return null;   // bracketed or a call either way
    if (node.op === '\\not') return '&';   // NOT binds looser than + and =: (NOT a) + 1
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
    if (set.type === 'op' && set.op === '{}' && !set.args.length) return negate ? 'TRUE' : 'FALSE';   // the empty set: IN () is no SQL
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
for (const table of [CONSTANTS, SQLITE_CONSTANTS, FUNCTIONS, INFIX, GROUPS, SQLITE_FUNCTIONS, SQLITE_RECIPROCALS, POSTGRES_NUMBER_SETS, NO_SQL, SQLITE_WORDS]) Object.setPrototypeOf(table, null);
