/**
 * Formulas as Python functions, and Python programs with formula slots.
 *
 * toPythonFunction turns `growth(P) = r P (1 - P/K)` into
 *
 *     def growth(P, r, K):
 *         # r P (1 - P/K)
 *         return r * P * (1 - P / K)
 *
 * A template is an ordinary Python program in which a comment marks where a
 * formula goes, with the function's signature and a default formula:
 *
 *     # mathzetta: growth(P, r, K) = r P (1 - P/K)
 *
 * The program's author fixes the signature (it is how the program calls the
 * function); whoever customizes the model writes only the formula.
 * fillPythonTemplate swaps each slot for its `def`.
 *
 * A slot can be a formula over a table's columns, for a chart or a model fed
 * by data: `# mathzetta: keep(data: columns) = HR >= 30 and yearID > 1990`,
 * with `# mathzetta-data: batting.csv` naming the table.
 *
 * Two choices, per function or for a whole template
 * (`# mathzetta-options: numpy errors=nan`):
 *   - numpy: the code works element-wise on arrays (np.where, np.maximum …);
 *   - errors: 'raise' (default) stops at 1/0, sqrt(-1), overflow; 'nan'
 *     returns nan instead (numpy: inf and nan element by element, as IEEE says).
 *
 * Formulas come from users and the result is run, so the generated code goes
 * through checkGeneratedPython, the Python twin of checkGeneratedJs: only
 * numbers, "…" strings, operators, the declared names and the math functions
 * the renderer writes. No other calls (print, exec, open), no attributes but
 * math.*, no dunders.
 */

import { treeOf } from './input.js';
import { toCode, pythonName, boundVariables } from './render/code.js';
import { isCustomFunction } from './operators.js';
import { customName } from './common.js';
import { walk } from './tree.js';
import { UnsafeCodeError } from './safe.js';
import { toLatex } from './render/latex.js';
import { replaceColumnNames, columnIndexOf } from './columns.js';

/** The members each module may be used for: what render/code.js writes, and a few more math functions. */
const MEMBERS = {
    math: new Set(['sqrt', 'floor', 'ceil', 'trunc', 'log', 'log2', 'log10', 'exp', 'expm1', 'pow', 'hypot', 'fabs',
        'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'asin', 'acos', 'atan', 'asinh', 'acosh', 'atanh', 'atan2',
        'degrees', 'radians', 'pi', 'e', 'tau', 'inf', 'nan', 'isclose', 'isfinite', 'factorial', 'perm', 'comb',
        'gcd', 'lcm', 'prod', 'cbrt']),
    random: new Set(['random']),
    np: new Set(['sqrt', 'floor', 'ceil', 'trunc', 'log', 'log2', 'log10', 'exp', 'expm1', 'power', 'hypot', 'abs',
        'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan', 'arcsinh', 'arccosh', 'arctanh', 'arctan2',
        'degrees', 'radians', 'pi', 'e', 'inf', 'nan', 'isclose', 'isfinite', 'isin', 'mod', 'round', 'where', 'cbrt',
        'maximum', 'minimum', 'gcd', 'logical_and', 'logical_or', 'logical_not', 'logical_xor', 'random',
        'nanmax', 'nanmin', 'nansum', 'nanprod', 'nanmean', 'nanmedian', 'nanstd', 'char', 'linalg', 'union1d', 'intersect1d', 'array']),
    'np.linalg': new Set(['det']),
    'np.random': new Set(['random']),
    'np.char': new Set(['mod']),   // what fixed() writes for numpy: np.char.mod("%.2f", x)
    scipy: new Set(['integrate', 'special']),
    'scipy.integrate': new Set(['quad']),
    'scipy.special': new Set(['factorial', 'perm', 'comb']),
    sympy: new Set(['pi', 'E', 'oo', 'true', 'false', 'nan', 'Rational', 'Integer', 'sqrt', 'root', 'exp', 'log', 'expm1',
        'sin', 'cos', 'tan', 'csc', 'sec', 'cot', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'atan2',
        'Abs', 'floor', 'ceiling', 'factorial', 'binomial', 'ff', 'gcd', 'gcd_list', 'Max', 'Min', 'Mod', 'Eq', 'Ne',
        'And', 'Or', 'Not', 'Xor', 'Nand', 'Nor', 'Piecewise', 'FiniteSet', 'Interval', 'Contains', 'S', 'Union', 'Intersection',
        'diff', 'integrate', 'limit', 'summation', 'product', 'real_root', 'Matrix', 'det']),
    'sympy.S': new Set(['Reals', 'Integers', 'Naturals', 'Rationals', 'Complexes']),
    'sympy.Interval': new Set(['open', 'Lopen', 'Ropen']),
};
const IMPORTS = {
    math: 'import math', random: 'import random', np: 'import numpy as np', sympy: 'import sympy',
    'scipy.integrate': 'import scipy.integrate', 'scipy.special': 'import scipy.special',
};
/** Built-ins the renderer calls. */
const CALLS = new Set(['abs', 'max', 'min', 'round', 'sum', 'range', 'float', 'format', 'str', 'sorted', 'set']);   // format, str: what fixed() writes; sorted(set(a) | set(b)): ∪
const KEYWORDS = new Set(['for', 'in', 'if', 'else', 'and', 'or', 'not', 'lambda', 'True', 'False', 'None']);
const PUNCT = ['**', '==', '!=', '<=', '>=', '(', ')', '[', ']', '{', '}', ',', ':', '.', '+', '-', '*', '/', '%', '<', '>', '|', '&'];   // | and &: set union and intersection
const NAME = /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]*/u;
/**
 * Python's own functions. A lambda or a generator may not bind one of these names: the scan takes a bound name as
 * bound everywhere, so `(lambda exit: 0)(0)` would let a bare `exit` through to be handed to something that calls it.
 */
const BUILTINS = new Set(('abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex copyright '
    + 'credits delattr dict dir divmod enumerate eval exec exit filter float format frozenset getattr globals hasattr hash help hex id input int '
    + 'isinstance issubclass iter len license list locals map max memoryview min next object oct open ord pow print property quit range repr '
    + 'reversed round set setattr slice sorted staticmethod str sum super tuple type vars zip').split(' '));

/**
 * Read generated Python, refusing anything off the whitelist.
 * Python reads names NFKC-normalised (ｅｘｅｃ is exec), so they are checked that way.
 *
 * @param {Set<string>|null} variables the names it may read; null: any (and report them)
 * @returns {{ free: string[], modules: Set<string> }} the names read, in order; the modules used
 */
function scanPython(code, variables, functions) {
    const fail = (why) => { throw new UnsafeCodeError(`not allowed in a formula: ${why}`); };
    const tokens = [];
    for (let i = 0; i < code.length;) {
        const rest = code.slice(i);
        const match = (re) => re.exec(rest)?.[0];
        let text;
        if ((text = match(/^[ \t]+/))) { i += text.length; continue; }
        if ((text = match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/))) tokens.push({ type: 'num', value: text });
        else if ((text = match(NAME))) tokens.push({ type: 'id', value: text.normalize('NFKC') });
        else if (rest[0] === '"') {
            text = match(/^"(?:[^"\\\n\r]|\\(?:["\\bfnrt]|u[0-9a-fA-F]{4}))*"/);
            if (!text) fail('a string that is not a plain "…" literal');
            // f"{…}", rb"…": a name just before a quote is a prefix to Python, and an f-string runs code
            const prev = tokens[tokens.length - 1];
            if (prev && (prev.type === 'id' || prev.type === 'num' || prev.type === 'str')) fail('a string right after a value');
            tokens.push({ type: 'str', value: text });
        } else {
            text = PUNCT.find((p) => rest.startsWith(p));
            if (!text) fail(`"${rest[0]}"`);
            tokens.push({ type: 'p', value: text });
        }
        i += text.length;
    }

    // Indexing (x[i + 1], what x_{i+1} becomes) takes numbers and names only: a string index would
    // reach an object's attributes by name (x["__class__"]), and no string may name a dunder at all
    tokens.forEach((t, i) => {
        if (t.type === 'str' && t.value.includes('__')) fail(`the string ${t.value}`);
        const prev = tokens[i - 1];
        const endsValue = prev && (prev.type === 'id' || prev.type === 'num' || prev.type === 'str' || (prev.type === 'p' && [')', ']', '}'].includes(prev.value)));
        if (!(t.type === 'p' && t.value === '[' && endsValue)) return;
        for (let depth = 0, j = i; j < tokens.length; j++) {
            if (tokens[j].type === 'p' && tokens[j].value === '[') depth++;
            if (tokens[j].type === 'p' && tokens[j].value === ']' && --depth === 0) break;
            if (tokens[j].type === 'str') fail('a string inside [ ] indexing');
        }
    });

    // SymPy reads a string as code (sympify evaluates it), so its output has none but a limit's side, "+" or "-"
    if (tokens.some((t) => t.type === 'id' && t.value === 'sympy')) {
        const text = tokens.find((t) => t.type === 'str' && t.value !== '"+"' && t.value !== '"-"');
        if (text) fail(`the string ${text.value} in SymPy code`);
    }

    // Names a generator or lambda binds: sum(i ** 2 for i in …), lambda x: …
    const bound = new Set();
    tokens.forEach((t, i) => {
        if (t.type === 'id' && (t.value === 'for' || t.value === 'lambda') && tokens[i + 1]?.type === 'id') bound.add(tokens[i + 1].value);
        // lambda a, b: … binds every name before the colon
        if (t.type === 'id' && t.value === 'lambda') {
            for (let j = i + 1; tokens[j]?.type === 'id' && (tokens[j + 1]?.type === 'p' && tokens[j + 1].value === ','); j += 2) {
                if (tokens[j + 2]?.type === 'id') bound.add(tokens[j + 2].value);
            }
        }
    });

    for (const name of bound) if (BUILTINS.has(name)) fail(`"${name}" as a bound name`);

    const free = [];
    const modules = new Set();
    tokens.forEach((t, i) => {
        const prev = tokens[i - 1];
        const next = tokens[i + 1];
        const isP = (tok, v) => tok?.type === 'p' && tok.value === v;
        if (isP(t, '.')) {
            const after = next?.type === 'id' ? next.value : '';
            const ok = prev?.owner ? MEMBERS[prev.owner].has(after) : isP(prev, ')') && after === 'is_integer';
            if (!ok) fail(after ? `.${after}` : 'a "." here');
            // sympy.S is the table of sets (sympy.S.Reals); called, it is sympify, which evaluates text
            if (prev.owner === 'sympy' && after === 'S' && !isP(tokens[i + 2], '.')) fail('sympy.S without a set');
            next.owner = prev?.owner && MEMBERS[`${prev.owner}.${after}`] ? `${prev.owner}.${after}` : null;
            next.member = true;
            if (IMPORTS[next.owner]) modules.add(next.owner);
            return;
        }
        if (t.type !== 'id' || t.member) return;
        const name = t.value;
        if (name.includes('__')) fail(`the name "${name}"`);
        if (KEYWORDS.has(name)) return;
        if (MEMBERS[name] && isP(next, '.')) {
            if (IMPORTS[name]) modules.add(name);
            t.owner = name;
        } else if (isP(next, '(')) {
            if (!CALLS.has(name) && !functions.has(name)) fail(`the function "${name}"`);
        } else if (!bound.has(name)) {
            if (variables && !variables.has(name)) fail(`the name "${name}"`);
            if (!free.includes(name)) free.push(name);
        }
    });
    return { free, modules };
}

/**
 * The gate in front of running generated Python: throws UnsafeCodeError
 * unless the code is made only of numbers, "…" strings, operators, the
 * allowed `variables` and `functions`, and the math.* members and built-ins
 * the renderer writes.
 *
 *   checkGeneratedPython('math.sqrt(x) > 2', { variables: ['x'] })   → the code
 *   checkGeneratedPython('exec("…")', …)                              → throws UnsafeCodeError
 *
 * @param {string} code
 * @param {{ variables?: Iterable<string>, functions?: Iterable<string> }} [o]
 * @returns {string} the code, unchanged
 */
export function checkGeneratedPython(code, o = {}) {
    if (typeof code !== 'string') throw new UnsafeCodeError('generated code must be a string');
    const norm = (names) => new Set([...(names ?? [])].map((n) => n.normalize('NFKC')));
    scanPython(code, norm(o.variables), norm(o.functions));
    return code;
}

/** A comment can't be allowed to end early: a newline in the formula would start a line of code. */
const oneLine = (text) => text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').trim();

const isName = (name) => NAME.exec(name)?.[0] === name && !name.includes('__');

/** `f(x, y) = …` or `y = …` → { name, params, body }; anything else → null. */
function definition(tree) {
    if (tree.type !== 'op' || tree.op !== '=') return null;
    const [lhs, body] = tree.args;
    if (lhs.type === 'symbol' && isName(pythonName(lhs.value))) return { name: lhs.value, params: null, body };
    if (lhs.type === 'op' && isCustomFunction(lhs.op) && lhs.args.every((a) => a.type === 'symbol')) {
        return { name: customName(lhs.op), params: lhs.args.map((a) => a.value), body };
    }
    return null;
}

/**
 * `f(rate, dt) =` or `y =` at the start of formula text. It is split off before
 * parsing: as math, `f(x) = x > 0 ? 1 : 0` would read (f(x) = x > 0) ? 1 : 0,
 * and `rate, dt` could be split into letters.
 */
const DEFINED = /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*(?:\(([^()]*)\))?\s*=(?!=)/u;

const SYMBOLIC = { der: 'a derivative', lim: 'a limit' };

/** Is v used outside the derivative, integral, limit or sum that binds it? (x · d/dx x²: yes.) */
function freeOutsideBinding(tree, v) {
    let found = false;
    (function visit(n) {
        if (found) return;
        if (n.type === 'op') {
            if (['der', 'int', 'lim', '\\sumidx', '\\prodidx'].includes(n.op) && boundVariables(n).map(pythonName).includes(v)) return;
            n.args.forEach(visit);
        } else if (n.type === 'symbol' && pythonName(n.value) === v) found = true;
    })(tree);
    return found;
}

/** In numpy labels, sum(HR) of one column is Σ HR, not HR (as a sum of one value would be written). */
const AGGREGATE_LATEX = { sum: '\\sum ', prod: '\\prod ', mean: '\\mathrm{mean}' };
function aggregateLatex(node, latex) {
    const symbol = node.type === 'op' && node.args.length === 1 && AGGREGATE_LATEX[node.op];
    if (!symbol) return latex;
    const inner = toLatex(node.args[0], { wrap: aggregateLatex });
    return node.op === 'mean' ? `${symbol}\\left(${inner}\\right)` : `${symbol}${node.args[0].type === 'op' ? `\\left(${inner}\\right)` : inner}`;
}

/** The names bodyLines writes itself. */
const SCAFFOLDING = ['_value', '_bad', '_v'];

/** A column's name as a Python variable: 2B → _2B, "Team Name" → Team_Name. */
function columnVariable(column, taken) {
    let id = String(column).normalize('NFKC').replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/_{2,}/g, '_');
    if (!/^[\p{L}_]/u.test(id)) id = `_${id}`;
    id = pythonName(id);
    while (taken.has(id)) id += '_';
    taken.add(id);
    return id;
}

/**
 * The lines of the function's body, around the expression: columns read from
 * the table, what 1/0 does, and for numpy, parameters as float arrays (so 1/0
 * is IEEE, not ZeroDivisionError).
 *
 * @param {{ name: string, source: string }[]} columns variable ← `data["HR"]`
 */
function bodyLines(expr, { numpy, sympy, bound = [], errors, params, columns, signature }) {
    const I = '    ';
    if (sympy) {
        // The variables calculus binds are symbols here; one that is also a parameter is differentiated
        // (or integrated) as a symbol, then given the parameter's value: f(2) is f′(2), f(Symbol("x")) f′(x).
        const lines = [];
        const kept = bound.filter((v) => params.includes(v.name));
        for (const v of kept) lines.push(`_${v.name} = ${v.name}`);
        for (const v of bound) lines.push(`${v.name} = sympy.Symbol(${JSON.stringify(v.symbol)})`);
        const value = kept.length ? `sympy.sympify(${expr}).subs({${kept.map((v) => `${v.name}: _${v.name}`).join(', ')}})` : expr;
        if (errors === 'raise') return [...lines, `return ${value}`];
        return [...lines, 'try:', `${I}return ${value}`, 'except (ArithmeticError, ValueError, TypeError):', `${I}return sympy.nan`];
    }
    if (!numpy) {
        const lines = columns.map((c) => `${c.name} = ${c.source}`);
        if (errors === 'raise') return [...lines, `return ${expr}`];
        return [...lines, 'try:', `${I}return ${expr}`, 'except (ArithmeticError, ValueError):', `${I}return math.nan`];
    }
    const lines = params.map((p) => `${p} = np.asarray(${p}, dtype=float)`);
    for (const { name, source } of columns) {
        lines.push(`${name} = np.asarray(${source})`, `${name} = ${name}.astype(float) if ${name}.dtype.kind in "iub" else ${name}`);
    }
    lines.push("with np.errstate(all='ignore'):", `${I}_value = np.asarray(${expr})`);
    if (errors === 'raise') {
        // Judged element by element on the result: np.where works out both
        // branches, and 1/x in the branch not taken must not count; nor does a
        // value that is missing because an input was.
        const inputs = [...params, ...columns.map((c) => c.name)];
        lines.push('_bad = ~np.isfinite(_value) if _value.dtype.kind in "fc" else np.False_');
        if (inputs.length) {
            lines.push(`for _v in (${inputs.join(', ')},):`, `${I}if _v.dtype.kind in "fc":`,
                `${I}${I}_bad = _bad & (np.isfinite(_v) if _v.shape == _value.shape else np.all(np.isfinite(_v)))`);
        }
        lines.push('if np.any(_bad):',
            `${I}raise FloatingPointError(${JSON.stringify(`${signature}: no finite value (1/0, sqrt(-1), overflow …)`)})`);
    }
    lines.push('return _value[()]');
    return lines;
}

/**
 * A formula as a Python function.
 *
 * The formula is an expression, or a definition: `f(x, y) = …` names the
 * function and its parameters, `y = …` names the function. Without declared
 * parameters, they are the variables the formula reads, in order. With them,
 * a definition may name some (`growth(P) = …` for growth(P, r, K)) but no others.
 *
 * With declared parameters every name the formula reads must be one of them
 * or one of `globals`, and every function it calls a math function or one of
 * `functions`; otherwise it throws, naming what is unknown.
 *
 * Over a table: with `columns` (a header), the formula may also use any
 * column by name — matched case-insensitively as whole words, as in
 * mathzetta/formulas, so `2B` is the column — read from the parameter
 * `table` (`data["2B"]`): a row (a dict) in plain Python, whole columns with
 * numpy. With numpy, max(HR), sum(HR), mean(HR), median(HR), stdev(HR) are
 * over the column, skipping missing values.
 *
 * @param {string|string[]|object} input formula text, standard postfix or a tree
 * @param {object} [options]
 * @param {string} [options.name] the function's name (default: the definition's, else 'f')
 * @param {string[]} [options.params] its parameters, in order
 * @param {string[]} [options.globals] other names it may read (module-level values in the program)
 * @param {string[]} [options.functions] functions it may call besides math.*
 * @param {boolean} [options.numpy] element-wise over numpy arrays
 * @param {boolean} [options.sympy] symbolic and exact (SymPy): calculus works; the variables a
 *   derivative, integral, limit or sum binds become sympy.Symbol inside the function
 * @param {'raise'|'nan'} [options.errors] what 1/0, sqrt(-1) and overflow do: raise (default), or give nan
 * @param {string[]} [options.columns] a table's header: column names the formula may use
 * @param {string} [options.table] the parameter holding the table (default 'data')
 * @returns {{ code: string, name: string, params: string[], imports: string[], formula: string|null, latex: string|null, tree: object }}
 *   code is the `def`, ending in a newline; imports are lines such as 'import math';
 *   formula is the text on one line, latex the math (for labels), tree the formula with
 *   columns under their own names (to draw it, e.g. with Inline Math)
 */
export function toPythonFunction(input, options = {}) {
    const errors = options.errors ?? 'raise';
    if (errors !== 'raise' && errors !== 'nan') throw new Error(`errors is 'raise' or 'nan', not ${JSON.stringify(errors)}`);
    const numpy = Boolean(options.numpy);
    const sympy = Boolean(options.sympy);
    if (numpy && sympy) throw new Error('numpy or sympy, not both');
    if (sympy && options.columns) throw new Error('SymPy functions take values, not table columns');
    const globals = (options.globals ?? []).map(pythonName);
    const functions = new Set(options.functions ?? []);
    const header = options.columns ?? null;
    const table = header ? pythonName(options.table ?? 'data') : null;
    // A definition names this function: in a slot for keep, `league = "AL"` is an equation.
    const isColumn = (word) => Boolean(header?.some((h) => String(h).toLowerCase() === word.toLowerCase()));
    const defines = (word) => (options.name ? pythonName(word) === pythonName(options.name) : !isColumn(word));
    const match = typeof input === 'string' ? DEFINED.exec(input) : null;
    const head = match && defines(match[1]) ? match : null;
    const written = head?.[2]?.split(',').map((p) => p.trim()).filter(Boolean);

    let text = head ? input.slice(head[0].length) : input;
    if (header && typeof text === 'string') text = replaceColumnNames(text, header);
    // Known names are read as values, whole: `rate dt` is rate·dt, `r P (1 - P/K)` a product (not nPr).
    const placeholders = typeof text === 'string' ? text.match(/tktk[A-J]+/g) ?? [] : [];
    const values = [...(options.params ?? written ?? []), ...globals, ...placeholders];
    let tree = treeOf(text, typeof text === 'string' ? { values, names: [...functions] } : undefined);
    let name = options.name;
    let params = options.params ? options.params.map(pythonName) : null;
    let def = head ? { name: head[1], params: written ?? null, body: tree } : definition(tree);
    if (def && !head && (!defines(def.name) || (header && columnIndexOf(def.name, header) >= 0))) def = null;
    if (def) {
        name = def.name;
        const own = def.params?.map(pythonName);
        if (own && params && own.some((p) => !params.includes(p))) {
            throw new Error(`${name}(${own.join(', ')}) should be ${name}(${params.join(', ')})`);
        }
        params ??= own;
        tree = def.body;
    }
    name = pythonName(name ?? 'f');
    if (!isName(name)) throw new Error(`"${name}" can't be a Python function name`);
    if (table && params && !params.includes(table)) throw new Error(`${name}(${params.join(', ')}) has no parameter ${table} for the columns`);
    const signature = () => (params ? `${name}(${params.join(', ')})` : name);

    walk(tree, (n) => {
        if (!sympy && n.type === 'op' && SYMBOLIC[n.op]) throw new Error(`${signature()}: ${SYMBOLIC[n.op]} can't be computed numerically (sympy: true can)`);
    });

    // Columns: the math (for latex) under their own names, the code under Python ones.
    const columnNodes = [];
    if (header) walk(tree, (n) => {
        const index = n.type === 'symbol' ? columnIndexOf(n.value, header) : -1;
        if (index >= 0) { n.value = String(header[index]); columnNodes.push([n, index]); }
    });
    const display = structuredClone(tree);
    let latex = null;
    try { latex = toLatex(tree, numpy ? { wrap: aggregateLatex } : {}); } catch { /* a label is a nicety */ }
    const taken = new Set([...(params ?? []), ...globals, ...functions, ...Object.keys(MEMBERS), ...CALLS, ...KEYWORDS,
        table ?? 'data', ...SCAFFOLDING]);
    const columns = new Map();   // column index → { name, source }
    for (const [n, index] of columnNodes) {
        if (!columns.has(index)) {
            columns.set(index, { name: columnVariable(header[index], taken), source: `${table}[${JSON.stringify(String(header[index]))}]` });
        }
        n.value = columns.get(index).name;
    }
    const columnNames = [...columns.values()].map((c) => c.name);

    let body;
    try {
        body = toCode(tree, sympy ? 'sympy' : numpy ? 'numpy' : 'python');
    } catch (error) {
        error.message = `${signature()}: ${error.message}`;
        throw error;
    }
    if (!sympy && /\bsympy\./.test(body)) throw new Error(`${signature()}: an integral needs limits to be computed numerically (sympy: true can)`);
    const bound = sympy ? boundVariables(tree).map((v) => ({ name: pythonName(v), symbol: v })) : [];
    const boundNames = bound.map((v) => v.name);

    let scanned;
    try {
        scanned = scanPython(body, null, functions);
    } catch (error) {
        error.message = `${signature()}: ${error.message}`;
        throw error;
    }
    const free = scanned.free.filter((v) => !columnNames.includes(v) && !boundNames.includes(v));
    if (params) {
        const unknown = free.filter((v) => !params.includes(v) && !globals.includes(v));
        if (unknown.length) {
            const known = [...params.filter((p) => p !== table), ...globals];
            const hints = [...(header ? ['not a column'] : []), ...(known.length ? [`it can use ${known.join(', ')}`] : [])];
            throw new Error(`${signature()}: unknown name${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`
                + (hints.length ? ` (${hints.join('; ')})` : ''));
        }
    } else {
        params = [...(table ? [table] : []), ...free.filter((v) => !globals.includes(v) && v !== table)];
        // a variable that is bound and also used freely (x · d/dx x²) is still a parameter
        for (const v of scanned.free) if (boundNames.includes(v) && !params.includes(v) && freeOutsideBinding(tree, v)) params.push(v);
    }
    params.forEach((p) => { if (!isName(p)) throw new Error(`"${p}" can't be a Python parameter name`); });
    checkGeneratedPython(body, { variables: [...params, ...globals, ...columnNames, ...boundNames], functions });

    const lines = bodyLines(body, {
        numpy, sympy, bound, errors, params: params.filter((p) => p !== table), columns: [...columns.values()], signature: signature(),
    });
    if (numpy) scanned.modules.add('np');
    if (sympy) scanned.modules.add('sympy');
    else if (errors === 'nan') scanned.modules.add('math');
    const formula = typeof input === 'string' ? oneLine(input) : null;
    if (formula) lines.unshift(`# ${formula}`);
    return {
        code: `def ${name}(${params.join(', ')}):\n${lines.map((l) => `    ${l}\n`).join('')}`,
        name,
        params,
        imports: Object.keys(IMPORTS).filter((m) => scanned.modules.has(m)).map((m) => IMPORTS[m]),
        formula,
        latex,
        tree: display,
    };
}

const SLOT = /^([ \t]*)#[ \t]*mathzetta:[ \t]*(.*?)[ \t\r]*$/gm;
const OPTIONS = /^[ \t]*#[ \t]*mathzetta-options:[ \t]*(.*?)[ \t\r]*$/m;
const DATA = /^([ \t]*)#[ \t]*mathzetta-data:[ \t]*(.*?)[ \t\r]*$/m;
const SIGNATURE = /^([\p{L}_][\p{L}\p{N}_]*)[ \t]*\(([^)]*)\)[ \t]*(?:=(.*))?$/u;
const PARAM = /^([\p{L}_][\p{L}\p{N}_]*)[ \t]*(:[ \t]*columns)?$/u;

/** The module docstring, after any comment lines (#!, coding). */
const DOCSTRING = /^\s*(?:#[^\n]*\n\s*)*(?:"""|''')([\s\S]*?)(?:"""|''')/;

/** The comment lines just above a slot (stopping at a blank line, code or another mathzetta line), as one text. */
function docAbove(lines, line) {
    const doc = [];
    for (let i = line - 2; i >= 0; i--) {
        const m = /^[ \t]*#[ \t]?(.*?)[ \t\r]*$/.exec(lines[i]);
        if (!m || /^[ \t]*mathzetta[-:]/.test(m[1])) break;
        doc.unshift(m[1]);
    }
    return doc.join(' ').trim();
}

/** `# mathzetta-options: numpy errors=nan` → { numpy: true, errors: 'nan' }. */
function templateOptions(template) {
    const m = OPTIONS.exec(template);
    const options = {};
    for (const word of m ? m[1].split(/[\s,]+/).filter(Boolean) : []) {
        if (word === 'numpy' || word === 'math' || word === 'sympy') { options.numpy = word === 'numpy'; options.sympy = word === 'sympy'; }
        else if (/^errors=(raise|nan)$/.test(word)) options.errors = word.slice(7);
        else throw new Error(`mathzetta-options: "${word}" is not numpy, sympy, math, errors=raise or errors=nan`);
    }
    return options;
}

/**
 * What a Python template asks for:
 *   - slots, lines like `# mathzetta: growth(P, r, K) = r P (1 - P/K)` (the
 *     default formula is optional). A parameter written `data: columns` holds a
 *     table: the formula may use its columns by name.
 *   - `# mathzetta-data: batting.csv`, the table the program reads (data).
 *   - `# mathzetta-options: numpy errors=nan` (numpy, errors).
 * Each slot's doc is the comment just above it; description is the first
 * paragraph of the module docstring.
 *
 * @param {string} template
 * @returns {{ slots: { name: string, params: string[], columns: string|null, formula: string|null, line: number, indent: string, doc: string }[],
 *   data: string|null, description: string, numpy?: boolean, errors?: 'raise'|'nan' }}
 */
export function readPythonTemplate(template) {
    const slots = [];
    const lines = template.split('\n');
    for (const m of template.matchAll(SLOT)) {
        const line = template.slice(0, m.index).split('\n').length;
        const sig = SIGNATURE.exec(m[2]);
        if (!sig) throw new Error(`line ${line}: a slot is written "# mathzetta: name(a, b) = default formula", not "${m[2]}"`);
        const params = [];
        let columns = null;
        for (const p of sig[2].split(',').map((x) => x.trim()).filter(Boolean)) {
            const pm = PARAM.exec(p);
            if (!pm || !isName(pm[1])) throw new Error(`line ${line}: "${p}" is not a Python name (or a name: columns)`);
            if (pm[2] && columns) throw new Error(`line ${line}: only one parameter can hold the columns`);
            if (pm[2]) columns = pm[1];
            params.push(pm[1]);
        }
        if (!isName(sig[1])) throw new Error(`line ${line}: "${sig[1]}" is not a Python name`);
        if (slots.some((s) => s.name === sig[1])) throw new Error(`line ${line}: a second slot called ${sig[1]}`);
        slots.push({ name: sig[1], params, columns, formula: sig[3]?.trim() || null, line, indent: m[1], doc: docAbove(lines, line) });
    }
    const docstring = DOCSTRING.exec(template)?.[1].trim() ?? '';
    return { slots, data: DATA.exec(template)?.[2] || null, description: docstring.split(/\n\s*\n/)[0].replace(/\s+/g, ' '), ...templateOptions(template) };
}

/** Every slot's function, or its error (an Error, line-prefixed by fill); the template's own error. */
function prepare(template, formulas, options) {
    const read = readPythonTemplate(template);
    const names = read.slots.map((s) => s.name);
    const unknown = Object.keys(formulas).filter((key) => !names.includes(key));
    const error = unknown.length
        ? new Error(`the template has no slot called ${unknown[0]} (it has ${names.join(', ') || 'none'})`) : null;
    const functions = [...names, ...(options.functions ?? [])];
    const numpy = options.numpy ?? read.numpy;
    const sympy = options.sympy ?? read.sympy;
    const errors = options.errors ?? read.errors;
    const slots = read.slots.map((slot) => {
        const formula = (Object.prototype.hasOwnProperty.call(formulas, slot.name) ? formulas[slot.name] : undefined) ?? slot.formula;   // a slot called toString
        const result = { ...slot, default: slot.formula, formula, fn: null, error: null };
        try {
            if (formula == null || (typeof formula === 'string' && !formula.trim())) {
                throw new Error(`no formula for ${slot.name}(${slot.params.join(', ')})`);
            }
            if (slot.columns && !options.columns) throw new Error(`${slot.name} reads columns: pass the table's header as columns`);
            result.fn = toPythonFunction(formula, {
                name: slot.name, params: slot.params, globals: options.globals, functions, numpy, sympy, errors,
                ...(slot.columns ? { columns: options.columns, table: slot.columns } : {}),
            });
        } catch (e) {
            result.error = e;
        }
        return result;
    });
    return { read, slots, error };
}

/** The program, from slots that all have a function. */
function assemble(template, read, slots, options) {
    const imported = new Set();
    for (const m of template.matchAll(/^import[ \t]+([^\n#]+)/gm)) {
        for (const part of m[1].split(',')) imported.add(`import ${part.trim().replace(/\s+/g, ' ')}`);
    }
    const filled = new Map(slots.map(({ fn, line, indent }) => {
        const missing = fn.imports.filter((i) => !imported.has(i));
        if (!indent) missing.forEach((i) => imported.add(i));   // a top-level import serves the slots after it
        const lines = [...missing, ...fn.code.trimEnd().split('\n')];
        if (fn.formula) lines.push(`${fn.name}.formula = ${JSON.stringify(fn.formula)}`);
        if (fn.latex) lines.push(`${fn.name}.latex = ${JSON.stringify(fn.latex)}`);
        return [line, lines.map((l) => indent + l).join('\n')];
    }));
    let program = template.replace(SLOT, (whole, indent, text, offset) => filled.get(template.slice(0, offset).split('\n').length));
    const path = options.data ?? read.data;
    if (path) program = program.replace(DATA, (whole, indent) => `${indent}DATA_FILE = ${JSON.stringify(path)}`);
    return program;
}

/**
 * Everything a form for a template needs, without throwing for a bad
 * formula: each slot with its formula and either its function (code, latex,
 * tree to draw) or its error, and the program when every slot is good.
 * Takes what fillPythonTemplate takes.
 *
 * @returns {{ program: string|null, error: string|null, description: string, data: string|null,
 *   slots: { name, params, columns, doc, line, default: string|null, formula, error: string|null,
 *     code: string|null, latex: string|null, tree: object|null }[] }}
 */
export function preparePythonTemplate(template, formulas = {}, options = {}) {
    const { read, slots, error } = prepare(template, formulas, options);
    const ok = !error && slots.every((s) => s.fn);
    return {
        program: ok ? assemble(template, read, slots, options) : null,
        error: error?.message ?? null,
        description: read.description,
        data: read.data,
        slots: slots.map(({ fn, error: e, indent, ...slot }) => ({
            ...slot, error: e?.message ?? null, code: fn?.code ?? null, latex: fn?.latex ?? null, tree: fn?.tree ?? null,
        })),
    };
}

/**
 * Fill a Python template's slots with formulas: each slot line becomes the
 * function's `def` (and any import it needs that the program lacks), followed
 * by `name.formula = "…"` and `name.latex = "…"` for labels. A slot without a
 * formula here uses its default; one with neither throws. Slots may call each
 * other. The template's `# mathzetta-data:` line becomes `DATA_FILE = "…"`.
 * Throws the first problem, `line N: …` for a slot; preparePythonTemplate
 * reports every slot instead.
 *
 * @param {string} template a Python program with `# mathzetta:` slots
 * @param {Record<string, string|string[]|object>} [formulas] slot name → formula
 * @param {object} [options]
 * @param {string[]} [options.globals] module-level names every formula may read
 * @param {string[]} [options.functions] the program's functions every formula may call
 * @param {boolean} [options.numpy] as for toPythonFunction; default the template's
 * @param {'raise'|'nan'} [options.errors] as for toPythonFunction; default the template's
 * @param {string[]} [options.columns] the table's header, for slots with a `: columns` parameter
 * @param {string} [options.data] where the table is (DATA_FILE); default the template's path
 * @returns {string} the program
 */
export function fillPythonTemplate(template, formulas = {}, options = {}) {
    const { read, slots, error } = prepare(template, formulas, options);
    if (error) throw error;
    const bad = slots.find((s) => s.error);
    if (bad) {
        bad.error.message = `line ${bad.line}: ${bad.error.message}`;
        throw bad.error;
    }
    return assemble(template, read, slots, options);
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [MEMBERS, IMPORTS, SYMBOLIC, AGGREGATE_LATEX]) Object.setPrototypeOf(table, null);
