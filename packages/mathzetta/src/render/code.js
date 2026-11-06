/**
 * Tree → JavaScript or Python source.
 *
 * The output is an expression that evaluates the maths, using only the
 * language's standard library (`Math.*`, or Python's `math`). Variables are
 * left as bare identifiers for the caller to supply. Symbolic operators that
 * have no numeric meaning — derivatives, integrals, limits — become calls to
 * functions named for them (`derivative(f, x)`, `sympy.diff(f, x)`), which
 * the caller must provide.
 */

import { needsParens, isCustomFunction, operator } from '../operators.js';
import { bracketOp, isMinusOneTimes, isVariable, smallWhole, customName, expandChain, guardLength, MATRICES, matrixRows } from '../common.js';
import { firstVariable } from '../tree.js';
import { JS_HELPERS } from '../js-helpers.js';

const JS = {
    name: 'javascript',
    pi: 'Math.PI', e: 'Math.E', tau: '(2 * Math.PI)', inf: 'Infinity', degree: '(Math.PI/180)',
    true: 'true', false: 'false', null: 'null',
    math: (fn) => `Math.${fn}`,
    abs: 'Math.abs', max: 'Math.max', min: 'Math.min', random: 'Math.random()',
    pow: (b, e) => `Math.pow(${b}, ${e})`,
    both: (a, b) => `(${a} && ${b})`, either: (a, b) => `(${a} || ${b})`, not: (x) => `!${x}`,
    close: (a, b) => `Math.abs((${a}) - (${b})) < 1e-9`,
    eq: { '=': '==', '===': '===', '≠': '!=', '≠=': '!==' },
    ternary: (c, t, f) => `(${c} ? ${t} : ${f})`,
    list: { '()': ['[', ']'], '[]': ['[', ']'], '{}': ['[', ']'], '(]': ['[', ']'], '[)': ['[', ']'] },
    contains: (list, x, negate) => `${negate ? '!' : ''}${list}.includes(${x})`,
    factorial: (x) => `${JS_HELPERS.factorial}(${x})`,
    perm: (n, k) => `${JS_HELPERS.perm}(${n}, ${k})`,
    comb: (n, k) => `${JS_HELPERS.comb}(${n}, ${k})`,
    gcd: (xs) => `${JS_HELPERS.gcd}([${xs}])`,
    round: (v, d) => (d === '0' ? `Math.round(${v})` : `Math.round(${v} * Math.pow(10, ${d})) / Math.pow(10, ${d})`),
    fixed: (v, d) => `Number(${v}).toFixed(${d})`,   // a string with exactly d decimals
    derivative: (f, x) => `derivative(${f}, ${x})`,
    matrix: (rows) => `[${rows.map((r) => `[${r.join(', ')}]`).join(', ')}]`,
    det: (m) => `det(${m})`,
    integral: (parts) => `integrate(${parts.join(', ')})`,
    limit: (parts) => `limit(${parts.join(', ')})`,
    indexed: (kind, idx, lower, condition, body) => kind === 'sum'
        ? `(()=>{let sum = 0; let loopCount = 0; for (let ${idx}=${lower};${condition};${idx}++) {if (loopCount++ > 1000000){break};sum += ${body};}; return sum;})()`
        : `(()=>{let prod = 1; let loopCount = 0; for (let ${idx}=${lower};${condition};${idx}++) {if (loopCount++ > 1000000){break};prod *= ${body};}; return prod;})()`,
};

const PY = {
    name: 'python', python: true,
    pi: 'math.pi', e: 'math.e', tau: 'math.tau', inf: 'math.inf', degree: '(math.pi/180)',
    true: 'True', false: 'False', null: 'None',
    math: (fn) => `math.${fn}`,
    abs: 'abs', max: 'max', min: 'min', random: 'random.random()',
    pow: null,   // Python has `**`, see '^' below
    both: (a, b) => `(${a} and ${b})`, either: (a, b) => `(${a} or ${b})`, not: (x) => `not ${x}`,
    close: (a, b) => `math.isclose(${a}, ${b})`,
    eq: { '=': '==', '===': '==', '≠': '!=', '≠=': '!=' },
    ternary: (c, t, f) => `(${t} if ${c} else ${f})`,
    list: { '()': ['(', ')'], '[]': ['[', ']'], '{}': ['{', '}'], '(]': ['(', ')'], '[)': ['(', ')'] },
    contains: (list, x, negate) => `${x} ${negate ? 'not in' : 'in'} ${list}`,
    factorial: (x) => `math.factorial(${x})`,
    perm: (n, k) => `math.perm(${n}, ${k})`,
    comb: (n, k) => `math.comb(${n}, ${k})`,
    gcd: (xs) => `math.gcd(${xs})`,
    round: (v, d) => `round(${v}, ${d})`,
    fixed: (v, d, literal) => (literal === null ? `format(${v}, '.' + str(${d}) + 'f')` : `format(${v}, '.${literal}f')`),   // a string with exactly d decimals
    derivative: (f, x) => `sympy.diff(${f}, ${x})`,
    matrix: (rows) => `[${rows.map((r) => `[${r.join(', ')}]`).join(', ')}]`,
    det: (m) => `numpy.linalg.det(${m})`,
    integral: (parts, f, v, bounds) => (bounds
        ? `scipy.integrate.quad(lambda ${v}: ${f}, ${bounds.join(', ')})[0]`
        : `sympy.integrate(${f}, sympy.Symbol(${JSON.stringify(v)}))`),
    limit: (parts) => `sympy.limit(${parts.join(', ')})`,
    indexed: (kind, idx, lower, condition, body, upper) => kind === 'sum'
        ? `sum(${body} for ${idx} in range(${lower}, ${upper} + 1))`
        : `math.prod(${body} for ${idx} in range(${lower}, ${upper} + 1))`,
};

/**
 * Python over numpy arrays: element-wise throughout, so `x > 0 ? 1 : 2` is
 * np.where, `and` np.logical_and, max np.maximum. Both branches of a where
 * are worked out; whoever runs the code decides what 1/0 does (np.errstate).
 */
const NP_NAMES = { asin: 'arcsin', acos: 'arccos', atan: 'arctan', asinh: 'arcsinh', acosh: 'arccosh', atanh: 'arctanh', atan2: 'arctan2', pow: 'power' };
const chain = (fn, xs) => xs.reduce((acc, x) => `${fn}(${acc}, ${x})`);
const COMPARISONS = { '<': '<', '>': '>', '≤': '<=', '≥': '>=', '=': '==', '===': '==', '≠': '!=', '≠=': '!=' };
/** a < b < c: Python chains it with `and`, which arrays can't do; each link on its own, joined element-wise. */
const comparison = ([, right], node, render) => {
    const [a, b] = node.args;
    const link = (l) => `${l} ${COMPARISONS[node.op]} ${right}`;
    if (a.type === 'op' && COMPARISONS[a.op]) return `np.logical_and(${render(a)}, ${link(render(a.args[1]))})`;
    return link(render(a));
};
const NP = {
    ...PY,
    name: 'numpy',
    pi: 'np.pi', e: 'np.e', tau: '(2 * np.pi)', inf: 'np.inf', degree: '(np.pi/180)',
    math: (fn) => `np.${NP_NAMES[fn] ?? fn}`,
    list: { ...PY.list, '{}': ['[', ']'] },   // np.isin reads a set as one object
    abs: 'np.abs', random: 'np.random.random()',
    matrix: (rows) => `np.array(${PY.matrix(rows)})`,
    det: (m) => `np.linalg.det(${m})`,
    both: (a, b) => `np.logical_and(${a}, ${b})`, either: (a, b) => `np.logical_or(${a}, ${b})`, not: (x) => `np.logical_not(${x})`,
    close: (a, b) => `np.isclose(${a}, ${b})`,
    ternary: (c, t, f) => `np.where(${c}, ${t}, ${f})`,
    contains: (list, x, negate) => (negate ? `np.logical_not(np.isin(${x}, ${list}))` : `np.isin(${x}, ${list})`),
    factorial: (x) => `scipy.special.factorial(${x})`,
    perm: (n, k) => `scipy.special.perm(${n}, ${k})`,
    comb: (n, k) => `scipy.special.comb(${n}, ${k})`,
    round: (v, d) => `np.round(${v}, ${d})`,
    fixed: (v, d, literal) => (literal === null ? `np.char.mod('%.' + str(${d}) + 'f', ${v})` : `np.char.mod('%.${literal}f', ${v})`),   // strings, element-wise
    /**
     * Operators written differently from Python's: (args rendered, node, render) → code, or null for Python's.
     * With one argument, max, min, sum, mean and prod are over an array (a column): max(HR) is
     * np.nanmax(HR), skipping missing values; with more they are element-wise.
     */
    ops: {
        ...Object.fromEntries(Object.keys(COMPARISONS).map((op) => [op, comparison])),
        max: (xs) => (xs.length === 1 ? `np.nanmax(${xs[0]})` : chain('np.maximum', xs)),
        min: (xs) => (xs.length === 1 ? `np.nanmin(${xs[0]})` : chain('np.minimum', xs)),
        sum: (xs) => (xs.length === 1 ? `np.nansum(${xs[0]})` : null),
        prod: (xs) => (xs.length === 1 ? `np.nanprod(${xs[0]})` : null),
        mean: (xs) => (xs.length === 1 ? `np.nanmean(${xs[0]})` : null),
        '\\:median': (xs) => (xs.length === 1 ? `np.nanmedian(${xs[0]})` : null),
        '\\:stdev': (xs) => (xs.length === 1 ? `np.nanstd(${xs[0]})` : null),
        '\\:std': (xs) => (xs.length === 1 ? `np.nanstd(${xs[0]})` : null),
        gcd: (xs) => chain('np.gcd', xs),
        '\\xor': ([a, b]) => `np.logical_xor(${a}, ${b})`,
        '\\nand': ([a, b]) => `np.logical_not(np.logical_and(${a}, ${b}))`,
        '\\nor': ([a, b]) => `np.logical_not(np.logical_or(${a}, ${b}))`,
    },
};

/**
 * Python over SymPy: symbolic and exact. Numbers stay exact (0.07 is
 * Rational(7, 100), 1/3 Rational(1, 3)); = is Eq (== in SymPy only compares how
 * two expressions are written); choices are Piecewise; sets are FiniteSet,
 * Interval and S.Reals; derivatives, integrals, limits and sums are diff,
 * integrate, limit, summation. Variables are left for the caller to make
 * symbols (x, y = sympy.symbols("x y")); toPythonFunction makes them.
 */
const S = (name) => `sympy.${name}`;
/** A whole number, or minus one: 1/2 and -5/0 must be exact, not Python's float (or ZeroDivisionError). */
const isInteger = (n) => (n.type === 'number' && /^-?\d+$/.test(n.value)) || (n.type === 'op' && n.op === 'neg' && isInteger(n.args[0]));
const SY_SETS = { 'ℝ': 'sympy.S.Reals', 'ℤ': 'sympy.S.Integers', 'ℕ': 'sympy.S.Naturals', 'ℚ': 'sympy.S.Rationals', 'ℂ': 'sympy.S.Complexes' };
const SY_INTERVALS = { '[]': 'sympy.Interval', '()': 'sympy.Interval.open', '(]': 'sympy.Interval.Lopen', '[)': 'sympy.Interval.Ropen' };
/** A set: {1, 2} → FiniteSet, [0, 1) → Interval.Ropen, ℝ → S.Reals; anything else as it is (a set-valued name). */
function symSet(node, render) {
    if (node.type === 'symbol' && SY_SETS[node.value]) return SY_SETS[node.value];
    if (node.type === 'op' && SY_INTERVALS[node.op] && node.args.length === 2) return `${SY_INTERVALS[node.op]}(${node.args.map(render).join(', ')})`;
    if (node.type === 'op' && operator(node.op)?.group) return `sympy.FiniteSet(${node.args.map(render).join(', ')})`;
    return render(node);
}
/** a and b and c: one And, not And(And(a, b), c). */
function flatten(op, node, render, name) {
    const items = [];
    (function visit(n) { if (n.type === 'op' && n.op === op) n.args.forEach(visit); else items.push(render(n)); })(node);
    return `${name}(${items.join(', ')})`;
}
/** The variable a calculus operator binds, as written for the integral (int(f) uses f's first variable, or x). */
export function boundVariables(node) {
    const out = [];
    (function visit(n) {
        if (n.type !== 'op') return;
        const [f, second] = n.args;
        if (n.op === 'der') { if (second?.type === 'symbol') out.push(second.value); }
        else if (n.op === 'lim') {
            if (second?.type === 'op' && second.op === '→') out.push(second.args[0].value);
            else out.push(n.args.length === 2 ? firstVariable(f) || 'x' : second?.value);
        }
        else if (n.op === 'int') out.push(n.args.length >= 2 && isVariable(second) ? second.value : firstVariable(f) || 'x');
        else if ((n.op === '\\sumidx' || n.op === '\\prodidx') && second?.type === 'op' && second.op === '=' && second.args[0].type === 'symbol') out.push(second.args[0].value);
        n.args.forEach(visit);
    })(node);
    return [...new Set(out)];
}
const SY = {
    ...PY,
    name: 'sympy',
    noStrings: true,
    pi: S('pi'), e: S('E'), tau: '(2*sympy.pi)', inf: S('oo'), degree: '(sympy.pi/180)',
    true: S('true'), false: S('false'), null: 'None',
    math: (fn) => S({ log: 'log', asin: 'asin', acos: 'acos', atan: 'atan', asinh: 'asinh', acosh: 'acosh', atanh: 'atanh', atan2: 'atan2', expm1: 'expm1', ceil: 'ceiling' }[fn] ?? fn),
    abs: S('Abs'), random: 'random.random()',
    matrix: (rows) => `sympy.Matrix(${PY.matrix(rows)})`,
    det: (m) => `${m}.det()`,
    both: (a, b) => `sympy.And(${a}, ${b})`, either: (a, b) => `sympy.Or(${a}, ${b})`, not: (x) => `sympy.Not(${x})`,
    close: (a, b) => `sympy.Abs((${a}) - (${b})) < sympy.Rational(1, 10**9)`,
    exactNumber: (v) => {
        const m = /^(\d*)\.(\d+)$/.exec(v);
        if (!m) return v;
        const scale = 10n ** BigInt(m[2].length);
        let [n, d] = [BigInt(m[1] || '0') * scale + BigInt(m[2]), scale];
        const g = (a, b) => (b ? g(b, a % b) : a);
        const k = g(n, d);
        [n, d] = [n / k, d / k];
        return d === 1n ? String(n) : `sympy.Rational(${n}, ${d})`;
    },
    factorial: (x) => `sympy.factorial(${x})`,
    perm: (n, k) => `sympy.ff(${n}, ${k})`,
    comb: (n, k) => `sympy.binomial(${n}, ${k})`,
    ops: {
        '/': (parts, node) => (isInteger(node.args[0]) && isInteger(node.args[1]) ? `sympy.Rational(${parts[0]}, ${parts[1]})` : null),
        '^': (parts, node) => (node.args[0].type === 'symbol' && node.args[0].value === 'e' ? `sympy.exp(${parts[1]})` : null),
        '=': (parts) => `sympy.Eq(${parts[0]}, ${parts[1]})`,
        '===': (parts) => `sympy.Eq(${parts[0]}, ${parts[1]})`,
        '≡': (parts) => `sympy.Eq(${parts[0]}, ${parts[1]})`,
        '≠': (parts) => `sympy.Ne(${parts[0]}, ${parts[1]})`,
        '≠=': (parts) => `sympy.Ne(${parts[0]}, ${parts[1]})`,
        mod: (parts) => `sympy.Mod(${parts[0]}, ${parts[1]})`,
        pmod: (parts, node, render) => {
            const [statement] = node.args;
            return statement.type === 'op' && ['≡', '='].includes(statement.op)
                ? `sympy.Eq(sympy.Mod((${render(statement.args[0])}) - (${render(statement.args[1])}), ${parts[1]}), 0)`
                : `sympy.Mod(${parts[0]}, ${parts[1]})`;
        },
        '!': (parts) => `sympy.factorial(${parts[0]})`,
        perm: (parts) => `sympy.ff(${parts[0]}, ${parts[1]})`,
        comb: (parts) => `sympy.binomial(${parts[0]}, ${parts[1]})`,
        gcd: (parts) => (parts.length === 2 ? `sympy.gcd(${parts.join(', ')})` : `sympy.gcd_list([${parts.join(', ')}])`),
        max: (parts) => `sympy.Max(${parts.join(', ')})`,
        min: (parts) => `sympy.Min(${parts.join(', ')})`,
        floor: (parts) => `sympy.floor(${parts[0]})`,
        ceil: (parts) => `sympy.ceiling(${parts[0]})`,
        csc: (parts) => `sympy.csc(${parts[0]})`,
        sec: (parts) => `sympy.sec(${parts[0]})`,
        cot: (parts) => `sympy.cot(${parts[0]})`,
        ln: (parts) => `sympy.log(${parts[0]})`,
        log: (parts, node) => (node.args[0].type === 'symbol' && node.args[0].value === 'e' ? `sympy.log(${parts[1]})` : `sympy.log(${parts[1]}, ${parts[0]})`),
        loglog: (parts) => `sympy.log(sympy.log(${parts[0]}))`,
        logloglog: (parts) => `sympy.log(sympy.log(sympy.log(${parts[0]})))`,
        expm1: (parts) => `(sympy.exp(${parts[0]}) - 1)`,
        root: (parts) => `sympy.root(${parts[1]}, ${parts[0]})`,
        // round half up, written so it works on symbols too (Python's round does not)
        round: (parts, node) => (node.args[1].type === 'number' && node.args[1].value === '0'
            ? `sympy.floor(${parts[0]} + sympy.Rational(1, 2))`
            : `sympy.floor((${parts[0]}) * 10**(${parts[1]}) + sympy.Rational(1, 2)) / 10**(${parts[1]})`),
        '&': (parts, node, render) => flatten('&', node, render, 'sympy.And'),
        '|': (parts, node, render) => flatten('|', node, render, 'sympy.Or'),
        '\\not': (parts) => `sympy.Not(${parts[0]})`,
        '\\xor': (parts) => `sympy.Xor(${parts.join(', ')})`,
        '\\nand': (parts) => `sympy.Nand(${parts.join(', ')})`,
        '\\nor': (parts) => `sympy.Nor(${parts.join(', ')})`,
        '?:': (parts) => `sympy.Piecewise((${parts[1]}, ${parts[0]}), (${parts[2]}, True))`,
        '∈': (parts, node, render) => `sympy.Contains(${parts[0]}, ${symSet(node.args[1], render)})`,
        '∉': (parts, node, render) => `sympy.Not(sympy.Contains(${parts[0]}, ${symSet(node.args[1], render)}))`,
        '∪': (parts, node, render) => `sympy.Union(${node.args.map((a) => symSet(a, render)).join(', ')})`,
        '∩': (parts, node, render) => `sympy.Intersection(${node.args.map((a) => symSet(a, render)).join(', ')})`,
        '{}': (parts) => `sympy.FiniteSet(${parts.join(', ')})`,
        der: (parts) => `sympy.diff(${parts.join(', ')})`,
        int: (parts, node, render) => {
            const [f, second, third, fourth] = node.args;
            const hasVariable = node.args.length >= 2 && isVariable(second);
            const v = hasVariable ? render(second) : firstVariable(f) || 'x';
            let bounds = [];
            if (node.args.length === 4) bounds = [third, fourth];
            else if (node.args.length === 3) bounds = hasVariable ? [third] : [second, third];
            else if (node.args.length === 2 && !hasVariable) bounds = [second];
            bounds = bounds.map(render);
            if (!bounds.length) return `sympy.integrate(${render(f)}, ${v})`;
            return `sympy.integrate(${render(f)}, (${v}, ${bounds[0]}, ${bounds[1] ?? 'sympy.oo'}))`;
        },
        lim: (parts, node, render) => {
            // lim(f, x → a), lim(f, x, a[, side]), or lim(f, a) with the variable read from f
            const [f, second] = node.args;
            const arrow = second?.type === 'op' && second.op === '→';
            const [variable, to] = arrow ? second.args.map(render)
                : node.args.length === 2 ? [firstVariable(f) || 'x', parts[1]] : [parts[1], parts[2]];
            const side = node.args[3]?.type === 'symbol' ? { r: ', "+"', l: ', "-"' }[node.args[3].value] ?? '' : '';
            return `sympy.limit(${parts[0]}, ${variable}, ${to}${side})`;
        },
        '\\sumidx': (parts, node, render) => symbolicIndexed('summation', node, render),
        '\\prodidx': (parts, node, render) => symbolicIndexed('product', node, render),
    },
};

/** \sum_{i=1}^{n} f → sympy.summation(f, (i, 1, n)). */
function symbolicIndexed(name, node, render) {
    const [f, from, to] = node.args;
    if (node.args.length < 3 || from.type !== 'op' || from.op !== '=' || from.args[0].type !== 'symbol') return null;
    return `sympy.${name}(${render(f)}, (${render(from.args[0])}, ${render(from.args[1])}, ${render(to)}))`;
}

const LANGUAGES = { javascript: JS, python: PY, numpy: NP, sympy: SY };

/** @param {'javascript'|'python'|'numpy'|'sympy'} language */
export function toCode(node, language = 'javascript') {
    const lang = LANGUAGES[language] ?? JS;
    const render = (n) => guardLength(n.type === 'op' ? operation(n, render, lang) : leaf(n, lang));
    return render(node);
}

function leaf(node, lang) {
    const v = node.value;
    if (node.type === 'number') {
        const n = v.endsWith('..') ? v.replace(/\.+$/, '') : v;
        return lang.exactNumber ? lang.exactNumber(n) : n;
    }
    // Re-quoted as a JSON literal ("…", escaped): a template literal or a stray quote in the
    // user's text could otherwise become code. Valid JavaScript and Python alike.
    if (node.type === 'string' && lang.noStrings) throw new Error(`No SymPy for text (${v}): SymPy compares numbers and symbols, not strings`);
    if (node.type === 'string') return JSON.stringify(/^(["'`]).*\1$/s.test(v) ? v.slice(1, -1) : v);
    switch (v) {
        case 'pi': case 'π': return lang.pi;
        case 'e': return lang.e;
        case 'tau': case 'τ': return lang.tau;
        case '∞': return lang.inf;
        case '-∞': return '-' + lang.inf;
        case '°': return lang.degree;
        case 'true': return lang.true;
        case 'false': return lang.false;
        case 'null': case 'undefined': return lang.null;
        case '\\+': case '\\-': return v[1];
    }
    return identifier(v, lang);
}

/** Python keywords a variable might be called: `lambda` the rate, `in` the inflow. */
const PYTHON_KEYWORDS = new Set(['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
    'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
    'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);

/**
 * A name as the language writes it: f′ → f_prime, f⁻¹ → f_inverse, and in
 * Python a keyword gets a trailing underscore (lambda → lambda_).
 */
function identifier(name, lang = JS) {
    const id = name.replace(/′/g, '_prime').replace('⁻¹', '_inverse');
    return lang.python && PYTHON_KEYWORDS.has(id) ? id + '_' : id;
}

/** A variable's name in generated Python: what a template's parameters must be called. */
export const pythonName = (name) => identifier(name, PY);

/**
 * The operator that decides brackets in code, which can differ from the
 * maths: a small factorial is written out as a product, csc x as 1 / sin x,
 * and some operators already come wrapped in their own brackets.
 */
const SELF_BRACKETED = new Set(['&', '|', '\\xor', '\\nand', '\\nor', '?:', 'mean', 'log']);

/** What SymPy always writes as a call (sympy.factorial(n), sympy.Eq(a, b)): never bracketed again. */
const SY_CALLS = new Set(['!', 'perm', 'comb', 'mod', 'pmod', '=', '===', '≡', '≠', '≠=', '&', '|', '\\not', '\\xor', '\\nand', '\\nor',
    '?:', '∈', '∉', '∪', '∩', 'der', 'int', 'lim', '\\sumidx', '\\prodidx', 'floor', 'ceil', 'ln', 'log', 'loglog', 'logloglog', 'root', 'max', 'min', 'gcd', 'csc', 'sec', 'cot', '{}', 'pmatrix', 'bmatrix', 'vmatrix']);

function codeBracketOp(node, lang = JS) {
    if (lang === SY && SY_CALLS.has(node.op)) return null;
    // sum(x) of one item is written as the item (numpy: a function call)
    if ((node.op === 'sum' || node.op === 'prod') && node.args.length === 1) {
        return node.args[0].type === 'op' ? codeBracketOp(node.args[0], lang) : null;
    }
    if (node.op === '!' || node.op === 'perm') return '*';
    if (['comb', 'csc', 'sec', 'cot'].includes(node.op)) return '/';
    if (node.op === 'round' && !(node.args[1].type === 'number' && node.args[1].value === '0')) return '/';
    if (SELF_BRACKETED.has(node.op)) return null;
    return bracketOp(node);
}

const MATH_FUNCTIONS = {
    sqrt: 'sqrt', floor: 'floor', ceil: 'ceil', ln: 'log', expm1: 'expm1',
    sin: 'sin', cos: 'cos', tan: 'tan', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
    arcsin: 'asin', arccos: 'acos', arctan: 'atan', arcsinh: 'asinh', arccosh: 'acosh', arctanh: 'atanh',
    atan2: 'atan2',
};

const RECIPROCALS = { csc: 'sin', sec: 'cos', cot: 'tan' };

function operation(node, render, lang) {
    const chained = lang.python && lang.name !== 'sympy' ? null : expandChain(node);   // Python chains comparisons itself
    if (chained) return render(chained);
    const { op, args } = node;
    const [a, b] = args;
    const sideOf = (parentOp, child, s) => {
        const childOp = child.type === 'op' ? codeBracketOp(child, lang) : null;
        return needsParens(parentOp, childOp, s) ? `(${render(child)})` : render(child);
    };
    const side = (child, s) => sideOf(op, child, s);
    const list = () => args.map(render).join(', ');
    const binary = (symbol) => `${side(a, 'left')} ${symbol} ${side(b, 'right')}`;
    const unary = (child) => {
        const childOp = child.type === 'op' ? codeBracketOp(child, lang) : null;
        const childPrec = childOp ? operator(childOp)?.prec : undefined;
        const bracket = childPrec !== undefined && childPrec < (op === '\\not' ? operator('\\not').prec : 100);
        return bracket ? `(${render(child)})` : render(child);
    };

    const special = lang.ops?.[op]?.(args.map(render), node, render);
    if (special != null) return special;
    if (MATH_FUNCTIONS[op]) return `${lang.math(MATH_FUNCTIONS[op])}(${list()})`;
    if (RECIPROCALS[op]) return `1 / ${lang.math(RECIPROCALS[op])}(${render(a)})`;
    if (op === 'det') return lang.det(render(a));
    if (MATRICES[op]) {
        const m = lang.matrix(matrixRows(node).map((r) => r.map(render)));
        return op === 'vmatrix' ? lang.det(m) : m;
    }
    if (lang.list[op]) return lang.list[op][0] + list() + lang.list[op][1];
    if (lang.eq[op]) return binary(lang.eq[op]);
    if (isCustomFunction(op)) return `${identifier(customName(op), lang)}(${list()})`;

    switch (op) {
        case '+': case '-': case '*': case '/': case 'mod':
            if (op === '*' && isMinusOneTimes(node)) return '-' + render(b);
            return binary(op === 'mod' ? '%' : op);
        case '<': case '>':
            return binary(op);
        case '≤':
            return binary('<=');
        case '≥':
            return binary('>=');
        case '^': {
            const base = render(a);
            const bracketBase = needsParens('^', codeBracketOp(a, lang), 'left') || base.startsWith('-');
            const b0 = bracketBase ? `(${base})` : base;
            return lang.pow ? lang.pow(b0, render(b)) : `${b0} ** ${side(b, 'right')}`;
        }
        case 'neg':
            return '-' + unary(a);
        case 'pm':   // both values
            return `${lang.list['[]'][0]}${render(a)}, -${unary(a)}${lang.list['[]'][1]}`;
        case '≈':
            return lang.close(render(a), render(b));
        case '≡':   // without a modulus, congruent just means equal
            return binary(lang.eq['=']);
        case 'pmod':
            return congruence(node, render, lang);
        case '∪':
            return `union(${render(a)}, ${render(b)})`;
        case '∩':
            return `intersection(${render(a)}, ${render(b)})`;
        case '\\not':
            return lang.not(unary(a));
        case '!': {
            const n = smallWhole(a, 13);
            if (n <= 1) return '1';
            if (n) return Array.from({ length: n }, (_, i) => n - i).join(' * ');
            return lang.factorial(render(a));
        }
        case 'perm': case 'comb': {
            const n = smallWhole(a, 21);
            const k = smallWhole(b, 21);
            if (n >= k) {
                if (k === 0) return '1';
                const top = Array.from({ length: k }, (_, i) => n - i).join(' * ');
                if (op === 'perm') return top;
                return `(${top}) / (${Array.from({ length: k }, (_, i) => i + 1).join(' * ')})`;
            }
            return lang[op](render(a), render(b));
        }
        case 'abs':
            return `${lang.abs}(${render(a)})`;
        case 'root':
            return `${lang.math('pow')}(${render(b)}, 1 / (${render(a)}))`;
        case 'log':
            if (a.type === 'symbol' && a.value === 'e') return `${lang.math('log')}(${render(b)})`;
            return `(${lang.math('log')}(${render(b)}) / ${lang.math('log')}(${render(a)}))`;
        case 'loglog':
            return `${lang.math('log')}(${lang.math('log')}(${render(a)}))`;
        case 'logloglog':
            return `${lang.math('log')}(${lang.math('log')}(${lang.math('log')}(${render(a)})))`;
        case 'round':
            return lang.round(render(a), render(b));
        case 'fixed':
            return lang.fixed(render(a), render(b), b.type === 'number' && /^\d+$/.test(b.value) ? b.value : null);
        case 'random':
            return lang.random;
        case 'max': case 'min':
            return `${lang[op]}(${list()})`;
        case 'gcd':
            return lang.gcd(list());
        case 'mean':
            return `((${args.map(render).join(' + ')}) / ${args.length})`;
        case 'sum':   // written out as a + b + c, so bracket like +
            return args.map((x, i) => sideOf('+', x, i ? 'right' : 'left')).join(' + ');
        case 'prod':
            return args.map((x, i) => sideOf('*', x, i ? 'right' : 'left')).join(' * ');
        case '&':
            return lang.both(render(a), render(b));
        case '|':
            return lang.either(render(a), render(b));
        case '\\xor': {
            const l = side(a, 'left');
            const r = side(b, 'right');
            return lang.either(lang.both(l, lang.not(`(${r})`)), lang.both(lang.not(`(${l})`), r));
        }
        case '\\nand':
            return lang.not(lang.both(side(a, 'left'), side(b, 'right')));
        case '\\nor':
            return lang.not(lang.either(side(a, 'left'), side(b, 'right')));
        case '?:':
            return lang.ternary(render(a), render(b), render(args[2]));
        case '∈': case '∉':
            return membership(node, render, lang);
        case '±':
            return `${lang.list['[]'][0]}${render(a)} + ${side(b, 'right')}, ${render(a)} - ${side(b, 'right')}${lang.list['[]'][1]}`;
        case '→':
            return `${render(a)}, ${render(b)}`;
        case '_':
            return b.type === 'op' ? `${render(a)}[${render(b)}]` : `${render(a)}_${render(b)}`;
        case 'der':
            return lang.derivative(render(a), render(b));
        case 'int':
            return integral(args, render, lang);
        case 'lim':   // a 4th argument says which side: "r" or "l"
            // the side is r or l and nothing else: it is written inside quotes, so text there could close them
            return lang.limit(args.map((x, i) => {
                if (i !== 3) return render(x);
                const side = x.type === 'symbol' || x.type === 'string' ? x.value.replace(/^["'`]|["'`]$/g, '') : '';
                if (side !== 'r' && side !== 'l') throw new Error(`A limit's side is r or l, not ${JSON.stringify(side || x.value || x.op)}`);
                return `"${side}"`;
            }));
        case '\\sumidx':
            return indexed('sum', args, render, lang);
        case '\\prodidx':
            return indexed('prod', args, render, lang);
    }
    throw new Error(`No ${lang.name} for '${op}'`);
}

/** x ∈ ℝ, ℤ, ℕ as code: is it a (whole, positive whole) number? */
const NUMBER_SETS = {
    'ℝ': { javascript: (v) => `Number.isFinite(${v})`, python: (v) => `math.isfinite(${v})`, numpy: (v) => `np.isfinite(${v})` },
    'ℤ': { javascript: (v) => `Number.isInteger(${v})`, python: (v) => `float(${v}).is_integer()`, numpy: (v) => `(np.mod(${v}, 1) == 0)` },
    'ℕ': {
        javascript: (v) => `(Number.isInteger(${v}) && ${v} > 0)`,
        python: (v) => `(float(${v}).is_integer() and ${v} > 0)`,
        numpy: (v) => `np.logical_and(np.mod(${v}, 1) == 0, ${v} > 0)`,
    },
};

function membership(node, render, lang) {
    const [x, set] = node.args;
    const v = render(x);
    const numbers = set.type === 'symbol' && NUMBER_SETS[set.value];
    if (numbers) {
        const test = numbers[lang.name](v);
        return node.op === '∈' ? test : lang.not(test.startsWith('(') ? test : `(${test})`);
    }
    const interval = set.type === 'op' && ['()', '[]', '(]', '[)'].includes(set.op) && set.args.length === 2;
    if (interval) {
        const [lo, hi] = set.args.map(render);
        const lower = set.op[0] === '[' ? '>=' : '>';
        const upper = set.op[1] === ']' ? '<=' : '<';
        const test = lang.both(`${v} ${lower} ${lo}`, `${v} ${upper} ${hi}`);
        return node.op === '∈' ? test : lang.not(test);
    }
    return lang.contains(render(set), v, node.op === '∉');
}

/** a ≡ b (mod n) as code: is a - b a multiple of n? Anything else: its remainder mod n. */
function congruence(node, render, lang) {
    const [statement, n] = node.args;
    const zero = lang === JS ? '=== 0' : '== 0';
    if (statement.type === 'op' && ['≡', '='].includes(statement.op)) {
        const [l, r] = statement.args.map(render);
        return `((${l}) - (${r})) % (${render(n)}) ${zero}`;
    }
    return `(${render(statement)}) % (${render(n)})`;
}

/** int(f[, x][, a[, b]]) — which argument is which depends on the count. */
function integral(args, render, lang) {
    const [f, second, third, fourth] = args;
    const hasVariable = args.length >= 2 && isVariable(second);
    const v = hasVariable ? render(second) : firstVariable(f) || 'x';
    // The bounds actually written; a single bound is a lower bound.
    let bounds = [];
    if (args.length === 4) bounds = [third, fourth];
    else if (args.length === 3) bounds = hasVariable ? [third] : [second, third];
    else if (args.length === 2 && !hasVariable) bounds = [second];
    bounds = bounds.map(render);

    if (!lang.python) return lang.integral([render(f), hasVariable ? v : JSON.stringify(v), ...bounds]);
    const definite = bounds.length ? [bounds[0], bounds[1] ?? lang.inf] : null;
    return lang.integral(null, render(f), v, definite);
}

/** \sumidx(f, i=1, n): a loop from the lower bound up to n. */
function indexed(kind, args, render, lang) {
    const [f, from, to] = args;
    if (args.length < 3) {
        const name = kind === 'sum' ? 'summation' : 'product';
        return `${name}(${args.map(render).join(', ')})`;
    }
    let idx;
    let lower;
    if (from.type === 'op' && from.op === '=' && from.args[0].type === 'symbol') {
        idx = from.args[0].value;
        lower = render(from.args[1]);
    } else {
        idx = firstVariable(from) || firstVariable(f) || 'i';
        lower = render(from);
    }
    // The upper bound is usually a value (n, 2n+1); \sum_{i in [3,10]} gives a condition instead.
    const isCondition = to.type === 'op' && (operator(to.op)?.prec ?? 100) < 50;
    const condition = isCondition ? render(to) : `${idx}<=${render(to)}`;
    return lang.indexed(kind, idx, lower, condition, render(f), render(to));
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [JS, PY, NP_NAMES, COMPARISONS, NP, SY_SETS, SY_INTERVALS, SY, LANGUAGES, MATH_FUNCTIONS, RECIPROCALS, NUMBER_SETS]) Object.setPrototypeOf(table, null);
