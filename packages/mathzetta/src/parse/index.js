/**
 * The parsing pipeline:
 *
 *   text ──clean──▶ cleaned text ──tokenize──▶ tokens ──parse──▶
 *   raw postfix ──build──▶ tree ──▶ standard postfix
 *
 * Each stage lives in its own file in this folder; parseSteps() returns the
 * output of every stage, which is the quickest way to see where an input
 * goes wrong.
 */

import { clean as cleanText } from './clean/index.js';
import { casesToTernary } from './clean/latex.js';
import { isOperatorWord, WRITTEN_TIMES } from './vocabulary.js';
import { restoreStrings } from './clean/strings.js';
import { tokenize, PROTECTED } from './tokenize.js';
import { toRawPostfix } from './parser.js';
import { buildTree } from './build.js';
import { toPostfix, fromPostfix, walk } from '../tree.js';

/** The cleaner's · and × (WRITTEN_TIMES) shown as the * they stand for, in the stages a caller sees. */
const TIMES_MARKS = new RegExp(`[${Object.keys(WRITTEN_TIMES).join('')}]`, 'g');
const plainTimes = (text) => text.replace(TIMES_MARKS, '*');

/**
 * Names that must stay whole: the ones the caller lists, and the ones the
 * author marked with \text{}, \mathrm{}, \mathit{} or \operatorname{}. Each
 * is swapped for a placeholder like `§0§` before cleaning (which nothing
 * rewrites or splits) and put back afterwards.
 */
const MARKED = /\\(?:text|textrm|textit|mathrm|mathit|operatorname)\{\s*([A-Za-z][A-Za-z0-9 ]*[A-Za-z0-9])\s*\}/g;

function protectNames(text, names = [], values = []) {
    const protectedNames = new Map();
    const ids = new Map();   // one placeholder per name, however often it is written
    const placeholder = (name) => {
        let id = ids.get(name);
        if (id === undefined) {
            id = `${PROTECTED}${protectedNames.size}${PROTECTED}`;
            protectedNames.set(id, name);
            ids.set(name, id);
        }
        return id;
    };
    // \text{round}(x, 2), \operatorname{sin} x: a function MathZetta knows stays that function
    text = text.replace(MARKED, (whole, name) => (isFunctionWord(name.trim()) ? ` ${name.trim()}` : placeholder(name.trim())));
    for (const name of [...names].sort((a, b) => b.length - a.length)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(`(?<![A-Za-z_])${escaped}(?![A-Za-z0-9_])`, 'g'), () => placeholder(name));
    }
    // A value is never a function: `strength (x + 1)` is a product, not a call.
    for (const name of [...values].sort((a, b) => b.length - a.length)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(`(?<![A-Za-z_])${escaped}(?![A-Za-z0-9_])(\\s*)(\\(?)`, 'g'),
            (whole, space, bracket) => placeholder(name) + (bracket ? ' * (' : space));
    }
    return { text, protectedNames };
}

const isFunctionWord = (name) => /^[a-z][a-z0-9]*$/.test(name) && isOperatorWord(name);

/**
 * LaTeX notation to rewrite before names are protected, because it uses
 * \text{} for words that are not names: \begin{cases} … \text{if } …, and
 * {}^{n}\mathrm{P}_{k} for permutations.
 */
function beforeProtecting(text) {
    if (!text.includes('\\')) return text;
    text = casesToTernary(text);
    return text.replace(/\{\}\^\{([^{}]*)\}\s*\\mathrm\{P\}\s*_\{([^{}]*)\}/g, '\\perm($1,$2)');
}

/** LaTeX input (anything with a \command) reads letters side by side as a product; see words.js. */
const modeOf = (text) => (/\\[A-Za-z]/.test(text) ? 'latex' : 'plain');

/**
 * How `{{…}}` blocks are filled when parse() isn't told: nothing, until a
 * handler is set. Loading 'mathzetta/calculate' sets calculateBlock, so
 * `2+2={{2+2}}` reads as `2+2=4`; without it the braces are a plain group.
 * @param {((expression: string, scope?: object) => string) | null} handler
 */
export function setBlockHandler(handler) {
    defaultBlocks = handler;
}
let defaultBlocks = null;

/**
 * The cleaner on its own: the text the tokenizer will see.
 * @param {object} [options] { blocks, scope } as for parse()
 * @returns {{ cleaned: string, stringMap: Map, steps: Array }} see clean/index.js
 */
export const clean = (expression, options = {}) => {
    const result = cleanMarked(expression, options);
    return { ...result, cleaned: plainTimes(result.cleaned), steps: result.steps.map(([name, text]) => [name, plainTimes(text)]) };
};

/** The cleaner as the tokenizer needs it: · and × still told apart (WRITTEN_TIMES). */
function cleanMarked(expression, options = {}) {
    const blocks = options.blocks === undefined ? defaultBlocks : options.blocks;
    return cleanText(expression, { evaluate: blocks ? (text) => blocks(text, options.scope) : undefined });
}

/**
 * Run the whole pipeline and keep every intermediate result.
 * Never throws: on failure the result has an `error` message and whatever
 * stages completed.
 *
 * @param {object} [options] see parse()
 * @returns {{ original, mode, cleaned, cleanSteps, tokens, rawPostfix, tree, postfix, written, error }}
 *   written: { postfix index: 'dot' | 'cross' } for each product typed as · (\cdot) or × (\times); the
 *   tree's nodes carry it too (node.written). The postfix itself has only `*`.
 */
/** The longest expression read by default: far more than maths needs, and a bound on the work. */
export const MAX_LENGTH = 5000;

export function parseSteps(expression, options = {}) {
    const steps = { original: expression };
    try {
        if (typeof expression !== 'string') throw new Error('Expression must be a string');
        // a bound on the work: some cleaning and tokenizing steps grow faster than the length
        const maxLength = options.maxLength ?? MAX_LENGTH;
        if (expression.length > maxLength) throw new Error(`Longer than ${maxLength} characters (options.maxLength)`);
        // § marks the names kept whole (§0§): a typed one would be taken for a mark, or never end
        if (expression.includes(PROTECTED)) throw new Error(`The character ${PROTECTED} can't be read: MathZetta uses it to mark names`);
        // =B2*2: a spreadsheet formula, whose cells (B2, $C$3) and ranges (B2:B9) are names
        const sheet = /^\s*=(?!=)/.test(expression);
        // $B$1 is B1 (absolute or not, the same cell); outside strings only
        if (sheet) expression = expression.replace(/("(?:[^"]|"")*")|\$(?=[A-Za-z]{0,3}\d|[A-Za-z]{1,3}\$?\d)/g, (m, string) => string ?? '');
        const cells = sheet ? [...new Set(expression.replace(/"(?:[^"]|"")*"/g, '')
            .match(/(?<![\w.])[A-Za-z]{1,3}\d+(?::[A-Za-z]{1,3}\d+)?(?![\w.(])/g) ?? [])] : [];
        const { text, protectedNames } = protectNames(beforeProtecting(expression), options.names, [...(options.values ?? []), ...cells]);
        const mode = modeOf(text);
        const { cleaned, stringMap, steps: cleanSteps } = cleanMarked(text, { blocks: options.blocks, scope: options.scope });
        const restore = (tokens) => restoreStrings(restoreStrings(tokens, stringMap), protectedNames);
        steps.mode = mode;
        steps.cleaned = plainTimes(restore([cleaned])[0]);
        steps.cleanSteps = cleanSteps.map(([name, text]) => [name, plainTimes(text)]);
        const tokens = tokenize(cleaned, mode);
        steps.tokens = tokens.map(plainTimes);
        const raw = restore(toRawPostfix(tokens, mode));
        steps.rawPostfix = raw.map(plainTimes);
        // how each product was written (· or ×), by postfix index: the postfix has only *
        const written = {};
        const postfix = toPostfix(buildTree(raw), written);
        steps.postfix = postfix;
        steps.written = written;
        steps.tree = fromPostfix(postfix);   // re-read so node ids are postfix indexes
        if (Object.keys(written).length) walk(steps.tree, (node) => { if (written[node.id]) node.written = written[node.id]; });
    } catch (error) {
        steps.error = error instanceof RangeError ? 'Nested too deeply' : error.message;   // the call stack, on absurd nesting
    }
    return steps;
}

/**
 * Parse an expression to standard postfix.
 *
 * @param {string} expression anything from `2x+1` to `\frac{1}{2}` or `Math.sqrt(x)`
 * @param {object} [options]
 * @param {boolean} [options.keepIntermediateSteps] return parseSteps() output instead
 * @param {boolean} [options.allowUnvalidated] on a malformed expression,
 *   return the raw postfix instead of throwing
 * @param {string[]} [options.names] multi-letter names to keep whole, e.g.
 *   ['cost', 'rate'] — otherwise runs of letters may be read as products
 * @param {string[]} [options.values] names kept whole that are never
 *   functions: `rate (x + 1)` is a product, where `f (x + 1)` is a call
 * @param {(expression: string, scope?: object) => string | null} [options.blocks]
 *   fills each `{{...}}` block with the text to read instead; `null` leaves
 *   blocks as plain groups. Default: the handler set by setBlockHandler()
 *   (calculateBlock once 'mathzetta/calculate' is loaded).
 * @param {number} [options.maxLength] longest input read, in characters (default 5000)
 * @param {object} [options.scope] variable values passed to `blocks`:
 *   parse('x = {{a/b}}', { scope: { a: 1, b: 3 } })
 * @returns {string[]} postfix tokens
 */
/** The input as an error message quotes it: the start of a long one. */
const shown = (text) => (typeof text === 'string' && text.length > 80 ? `${text.slice(0, 77)}…` : text);

export function parse(expression, options = {}) {
    const steps = parseSteps(expression, options);
    if (options.keepIntermediateSteps) return steps;
    if (!steps.error) return steps.postfix;
    if (options.allowUnvalidated && steps.rawPostfix) return steps.rawPostfix;
    throw new Error(`Failed to parse expression "${shown(expression)}": ${steps.error}`);
}

/** Parse an expression to a tree whose node ids are postfix indexes. Options as for parse(). */
export function parseTree(expression, options = {}) {
    const steps = parseSteps(expression, options);
    if (steps.error) throw new Error(`Failed to parse expression "${shown(expression)}": ${steps.error}`);
    return steps.tree;
}
