/**
 * The gate in front of `new Function`: generated JavaScript is compiled only
 * if every piece of it is on a whitelist. Formulas come from users — typed
 * into a page, stored in an embed's data file, carried in a share link — so
 * the generated code must not be able to reach anything but arithmetic on
 * the values it is given.
 *
 * What passes:
 *   - numbers; string literals in double quotes with JSON escapes only
 *     (no template literals, so no `${…}`);
 *   - identifiers from an allowlist: the caller's (column variables such as
 *     c0, c1 …) plus the few keywords and locals of the helpers the
 *     generator writes (factorial, gcd …);
 *   - member access only to listed members: Math.<function or constant>,
 *     Number.isInteger / isFinite, .includes, .reduce — never a
 *     computed member (`x["constructor"]`), never .constructor / __proto__;
 *   - operators and brackets.
 * Anything else — an unknown name like `alert` or `fetch`, `import(…)`, a
 * backtick, a single quote, a backslash outside a string — is refused.
 *
 *   checkGeneratedJs('Math.sqrt(c0) > 2', { variables: /^c\d+$/ })   → the code
 *   checkGeneratedJs('alert(c0)', …)                                   → throws UnsafeCodeError
 */

import { JS_HELPERS } from './js-helpers.js';

export class UnsafeCodeError extends Error {}

const MATH = new Set(Object.getOwnPropertyNames(Math));
const MEMBERS = new Set([...MATH, 'isInteger', 'isFinite', 'includes', 'reduce', 'toFixed']);
const OBJECTS = { Math: MATH, Number: new Set(['isInteger', 'isFinite']) };
/** Names any generated code may use. */
const BUILTIN = new Set(['Math', 'Number', 'Infinity', 'NaN', 'true', 'false', 'null']);
/** Statement keywords: for generators that write statements (qblur's CPU passes); `keywords: false` refuses them. */
const KEYWORDS = new Set(['let', 'for', 'if', 'return']);
/**
 * The inline helpers render/code.js writes where Math has no function (js-helpers.js). They are
 * matched whole, as exact text, and stand in for one value; their locals (n, k, r, i, a, b …) are
 * not names a formula may use anywhere else.
 */
const HELPER_SOURCES = Object.values(JS_HELPERS).sort((a, b) => b.length - a.length);
const PUNCT = ['===', '!==', '**=', '...', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '**', '++', '--', '+=', '-=', '*=', '/=', '%=',
    '(', ')', '[', ']', '{', '}', ',', ';', '?', ':', '.', '+', '-', '*', '/', '%', '!', '=', '<', '>', '&', '|', '^', '~'];

/**
 * @param {string} code generated JavaScript (an expression, or helper-bodied code from render/code.js)
 * @param {object} [o]
 * @param {RegExp|Iterable<string>} [o.variables] the value names the code may read, e.g. /^c\d+$/ or ['r', 'g', 'b']
 * @param {RegExp} [o.indexable] variables that may be indexed with [ ] — arrays the generator made itself
 *   (the index is still checked like everything else)
 * @param {boolean} [o.strings] false: refuse every string literal (code that has no use for text)
 * @returns {string} the code, unchanged
 * @throws {UnsafeCodeError} naming the first thing that isn't allowed
 */
export function checkGeneratedJs(code, o = {}) {
    if (typeof code !== 'string') throw new UnsafeCodeError('generated code must be a string');
    const original = code;
    for (const helper of HELPER_SOURCES) code = code.split(helper).join('Math.abs');   // each a known function value
    const keywords = o.keywords !== false;
    const vars = o.variables instanceof RegExp ? o.variables : new Set(o.variables ?? []);
    const isVar = (id) => (vars instanceof RegExp ? vars.test(id) : vars.has(id));
    const indexable = o.indexable instanceof RegExp ? o.indexable : null;
    let prev = null;   // the previous token: { type, value }
    let i = 0;
    const fail = (why) => { throw new UnsafeCodeError(`not allowed in a formula: ${why}`); };
    // Can the previous token end an expression? Then `[` would index into it, and `(` would call it.
    const endsValue = () => prev && (prev.type === 'id' || prev.type === 'num' || prev.type === 'str' || (prev.type === 'p' && (prev.value === ')' || prev.value === ']' || prev.value === '}')));
    while (i < code.length) {
        const rest = code.slice(i);
        const space = /^\s+/.exec(rest);
        if (space) { i += space[0].length; continue; }
        // comments: what the checker would read as code (or a string) JavaScript skips, and the reverse;
        // <!-- and --> are line comments too in a Function body. The renderer never writes any of them.
        if (rest.startsWith('/*') || rest.startsWith('//') || rest.startsWith('<!--') || rest.startsWith('-->')) fail('a comment');
        const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
        if (num && !(prev && prev.type === 'id' && /[\w$]$/.test(code[i - 1] ?? ''))) {
            prev = { type: 'num', value: num[0] };
            i += num[0].length;
            continue;
        }
        if (rest[0] === '"') {
            if (o.strings === false) fail('a string');
            const str = /^"(?:[^"\\\n\r\u2028\u2029]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(rest);
            if (!str) fail('a string that is not a plain "…" literal');
            if (endsValue()) fail('a string right after a value');
            prev = { type: 'str', value: str[0] };
            i += str[0].length;
            continue;
        }
        const id = /^[A-Za-z_$][\w$]*/.exec(rest);
        if (id) {
            const name = id[0];
            if (prev && prev.type === 'p' && prev.value === '.') {
                const owner = prev.owner;
                const allowed = owner && OBJECTS[owner] ? OBJECTS[owner].has(name) : MEMBERS.has(name) && !MATH.has(name);
                if (!allowed) fail(`.${name}`);
            } else if (!BUILTIN.has(name) && !(keywords && KEYWORDS.has(name)) && !isVar(name)) fail(`the name "${name}"`);
            prev = { type: 'id', value: name };
            i += name.length;
            continue;
        }
        const p = PUNCT.find((t) => rest.startsWith(t));
        if (!p) fail(`"${rest[0]}"`);
        if (p === '[' && endsValue() && !(indexable && prev.type === 'id' && isVar(prev.value) && indexable.test(prev.value))) fail('indexing with [ ]');
        const tok = { type: 'p', value: p };
        if (p === '.') {
            if (!endsValue()) fail('a "." here');
            tok.owner = prev.type === 'id' && OBJECTS[prev.value] ? prev.value : null;
        }
        prev = tok;
        i += p.length;
    }
    return original;
}

/** true / false instead of throwing. */
export function isSafeGeneratedJs(code, o) {
    try {
        checkGeneratedJs(code, o);
        return true;
    } catch {
        return false;
    }
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [OBJECTS]) Object.setPrototypeOf(table, null);
