/**
 * Raw postfix → expression tree.
 *
 * The parser leaves two things unresolved, and this step settles
 * both while building the tree:
 *
 * 1. Argument lists. Commas are binary in raw postfix and a bracket that
 *    held commas becomes a group token, so `max(1,2,3)` arrives as
 *    `1 2 , 3 , () max`. A function applied directly to a group takes the
 *    group's items as its arguments; anywhere else a group is a value in its
 *    own right — a tuple, list, set or interval.
 *
 * 2. Spellings and defaults. `pow(a,b)` is `a^b`, `sqrt(n,x)` is the n-th
 *    root, `round(x)` rounds to 0 places, `der(f)` differentiates by x, and
 *    so on — see normalize().
 *
 * Every operator then has exactly the arity the operator table gives it,
 * which is what makes the tree's postfix "standard".
 */

import { operator, isCustomFunction, VARIADIC } from '../operators.js';
import { PARSE_PRECEDENCE, WRITTEN_TIMES } from './vocabulary.js';
import { EMPTY_LIST } from './parser.js';
import { leaf, op, num, sym, firstVariable } from '../tree.js';

const GROUPS = new Set(['()', '[]', '{}', '(]', '[)']);

/** Raw-only spellings and the operator they stand for. */
const RENAMES = {
    'pow': '^', 'sqrtpow': 'root', '\\binom': 'comb', '\\comb': 'comb', '\\perm': 'perm',
    'frac': '/', '==': '=', '!==': '≠=',
    ...Object.fromEntries(Object.keys(WRITTEN_TIMES).map((t) => [t, '*'])),   // · and ×: a * that remembers how it was written
};

/**
 * How many operands a function takes from the stack when it is *not*
 * applied to a group. Functions written with a single argument are
 * completed with defaults in normalize(): `round(x)` and `der(f)`.
 */
const SINGLE_ARGUMENT = new Set(['round', 'fixed', 'der']);

const isFunction = (token) => isCustomFunction(token) || PARSE_PRECEDENCE[token] === 100;

/**
 * @param {string[]} raw raw postfix from toRawPostfix()
 * @returns {object} expression tree in standard form; throws on bad input
 */
export function buildTree(raw) {
    const stack = [];   // tree nodes, plus { list: [...] } for comma lists

    const pop = (token) => {
        if (!stack.length) throw new Error(`'${token}' is missing an operand`);
        return stack.pop();
    };
    const items = (entry) => (entry.list ? entry.list : [entry]);
    const node = (entry, token) => {
        if (entry.list) throw new Error(`A list of values needs brackets around it (near '${token}')`);
        return entry;
    };

    raw.forEach((token, index) => {
        if (token === EMPTY_LIST) {
            stack.push({ list: [] });
            return;
        }
        if (token === ',') {
            const right = pop(token);
            const left = pop(token);
            stack.push({ list: [...items(left), ...items(right)] });
            return;
        }
        if (GROUPS.has(token)) {
            const members = items(pop(token));
            // Empty brackets only mean something as a call's argument list, f(), or as the empty set, {} (\emptyset, ∅)
            if (!members.length && token !== '{}' && !isFunction(raw[index + 1])) throw new Error('Empty brackets');
            stack.push(op(token, members));
            return;
        }

        const name = RENAMES[token] ?? token;
        const def = operator(name);
        if (!def) {
            if (token === '?' || token === 'abs(') throw new Error(`Unmatched '${token[0]}'`);
            stack.push(leaf(token));
            return;
        }

        let args;
        const appliedToGroup = isFunction(token) && GROUPS.has(raw[index - 1]) && stack[stack.length - 1]?.op === raw[index - 1];
        if (appliedToGroup) {
            args = stack.pop().args;
        } else {
            let count = def.arity === VARIADIC || SINGLE_ARGUMENT.has(name) ? 1 : def.arity;
            if (stack.length < count) {
                throw new Error(`'${token}' needs ${count} operand${count === 1 ? '' : 's'}`);
            }
            args = stack.splice(stack.length - count, count).map((e) => node(e, token));
        }
        const built = normalize(name, args);
        if (WRITTEN_TIMES[token] && built.op === '*') built.written = WRITTEN_TIMES[token];
        stack.push(built);
    });

    if (stack.length !== 1) {
        throw new Error(stack.length ? 'Some values are not connected by an operator' : 'Empty expression');
    }
    // x = t^2, y = t^3: equations listed side by side, each one holding (as a brace of equations is read)
    const RELATIONS = ['=', '<', '>', '≤', '≥', '≠', '≈', '≡', '∈', '∉'];
    const top = stack[0];
    if (top.list && top.list.length > 1 && top.list.every((n) => n.type === 'op' && RELATIONS.includes(n.op))) {
        return top.list.reduce((all, n) => op('&', [all, n]));
    }
    return node(stack[0], 'end');
}

/** Resolve one operator application to its standard form. */
function normalize(name, args) {
    switch (name) {
        case 'sqrt':
            if (args.length === 2) return op('root', args);       // sqrt[n]{x} arrives as sqrt(n, x)
            break;
        case 'round':
            if (args.length === 1) return op('round', [args[0], num(0)]);
            break;
        case 'sum': case 'prod': {
            // sum(f, i=a, b) and prod(f, i ∈ S) are indexed, as \sum_{i=a}^{b} f — a list of values never holds i=a
            const index = args[1];
            const bound = index?.type === 'op' && index.args[0]?.type === 'symbol';
            if (bound && ((args.length === 3 && index.op === '=') || (args.length === 2 && index.op === '∈'))) {
                return op(name === 'sum' ? '\\sumidx' : '\\prodidx', args);
            }
            break;
        }
        case 'evaluated':   // evaluated(F, a, b): the variable is F's first (x when it has none)
            if (args.length === 3) return op('evaluated', [args[0], sym(firstVariable(args[0]) || 'x'), args[1], args[2]]);
            break;
        case 'det':     // det([[1, 2], [3, 4]]): the call's brackets took the list's, so its rows arrive one by one
            if (args.length > 1 && args.every((a) => a.type === 'op' && a.op === '[]')) return op('det', [op('[]', args)]);
            break;
        case 'fixed':   // fixed(x) is two decimals, like a spreadsheet's FIXED
            if (args.length === 1) return op('fixed', [args[0], num(2)]);
            break;
        case 'der':
            if (args.length === 1) return op('der', [args[0], sym('x')]);
            if (args.length === 3) return nthDerivative(args);
            break;
        case 'log':
            if (args.length === 2 && args[0].type === 'symbol' && args[0].value === 'e') return op('ln', [args[1]]);
            break;
        case 'lim':
            checkArity(name, args);   // lim() is refused like max()
            return op('lim', oneSided(args));
        case '\\:if':   // IF(condition, value, otherwise) — without the third, the value is `unchanged`
            if (args.length === 2 || args.length === 3) return op('?:', [args[0], args[1], args[2] ?? sym('unchanged')]);
            throw new Error('if() takes a condition, a value, and optionally an alternative');
    }
    checkArity(name, args);
    return op(name, args);
}

/**
 * x→0^+ is a one-sided limit: lim(f, x→a^+) and lim(f, x, a^+) become
 * lim(f, x, a, r) — and l for a^-.
 */
const SIDES = { '\\+': 'r', '\\-': 'l' };   // a^+ and a^-: the side a limit is taken from
function oneSided(args) {
    // the marker ends the point as written, so it belongs to all of it: π/2^- is (π/2)^-, -1^+ is (-1)^+
    const peel = (n) => {
        if (n.type !== 'op') return null;
        if (n.op === '^' && n.args[1].type === 'symbol' && SIDES[n.args[1].value]) return { point: n.args[0], side: SIDES[n.args[1].value] };
        const inner = n.args.length ? peel(n.args[n.args.length - 1]) : null;
        return inner && { point: { ...n, args: [...n.args.slice(0, -1), inner.point] }, side: inner.side };
    };
    const [f, second, third] = args;
    if (args.length === 2 && second.type === 'op' && second.op === '→') {
        const [x, a] = second.args;
        const p = peel(a);
        if (p) return [f, x, p.point, sym(p.side)];
    }
    const p = args.length === 3 && peel(third);
    if (p) return [f, second, p.point, sym(p.side)];
    return args;
}

/**
 * der(f, x, n) for a whole number n is d/dx applied n times; der(f, x = a, n) is the nth derivative at a:
 * d/dx applied n − 1 times, then once more at the point.
 */
function nthDerivative([f, x, n]) {
    const times = n.type === 'number' ? Number(n.value) : NaN;
    if (!Number.isInteger(times) || times < 1 || times > 20) {
        throw new Error('der(f, x, n) needs n to be a whole number from 1 to 20');
    }
    const at = x.type === 'op' && x.op === '=' ? x : null;
    const by = at ? at.args[0] : x;
    let result = f;
    for (let i = 0; i < times; i++) result = op('der', [result, at && i === times - 1 ? at : by]);
    return result;
}

function checkArity(name, args) {
    const { arity } = operator(name);
    if (arity === VARIADIC) {
        // Only a user's own function can be called with nothing: f().
        if (args.length === 0 && !isCustomFunction(name)) throw new Error(`'${name}' needs at least one argument`);
        return;
    }
    if (args.length !== arity) {
        const s = arity === 1 ? '' : 's';
        throw new Error(`'${name}' takes ${arity} argument${s}, not ${args.length}`);
    }
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [RENAMES, SIDES]) Object.setPrototypeOf(table, null);
