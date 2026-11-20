/**
 * The cleaner: rewrites whatever the user typed into one compact spelling
 * the tokenizer understands. Its phases, in order:
 *
 *   1. strings     primes (f'(x)) become ′, then quoted strings are swapped
 *                  for placeholders (strings.js);
 *                  then `{{...}}` blocks are evaluated, if a callback is given
 *   2. code        programming spellings (code.js): np.where(c, a, b), a if c
 *                  else b, CASE WHEN, x IN (1, 2), [1, 2].includes(x), mz_sq(x) …
 *   3. words       WORD_REPLACEMENTS, while spaces still separate words:
 *                  ` And ` → `&`, ` choose ` → `\comb`
 *   4. spaced      structural rewrites that need spaces: \lim x→0 f,
 *                  \text{..}, log bases, ternaries, numeric scripts
 *   5. squeeze     whitespace is removed, except one space between two
 *                  letters, which separates words (`cos t`, `x y`)
 *   6. symbols     SYMBOL_REPLACEMENTS and trig spellings:
 *                  \cdot → *, >= → ≥, Math.sqrt( → sqrt(, \sin → sin
 *   7. compact     structural rewrites on the squeezed text: \frac{d}{dx},
 *                  \int, \sum, \sqrt[n], ⌊⌋, matrices, sin^2(x) (latex.js)
 *
 * Every phase is a plain string → string function, and clean() returns the
 * text after each one in `steps`, for debugging.
 */

import { makeReplacer } from './trie.js';
import { WORD_REPLACEMENTS, SYMBOL_REPLACEMENTS, trigReplacements } from './replacements.js';
import { spacedRewrites, compactRewrites } from './latex.js';
import { extractStrings, markPrimes, placeholder } from './strings.js';
import { codePhase } from './code-phase.js';
import { englishRewrites } from './english.js';
import { BAR_OPEN } from '../vocabulary.js';   // the code-spelling reader; a "plain" build swaps this file for an identity

const replaceWords = makeReplacer(WORD_REPLACEMENTS);
const replaceSymbols = makeReplacer([...SYMBOL_REPLACEMENTS, ...trigReplacements()]);

const PHASES = [
    ['code', codePhase],
    ['english', englishRewrites],
    ['words', replaceWords],
    ['spaced', spacedRewrites],
    ['squeeze', squeeze],
    ['symbols', replaceSymbols],
    ['bar', fenceBars],
    ['compact', compactRewrites],
    ['bars', evaluationBars],
    ['tidy', (s) => s.replace(/ {2,}/g, ' ').trim()],   // replacements may have doubled spaces
];


const refuseBar = () => { throw new Error('An evaluation bar (\\left. … \\right|_{x = a}) is read only after a derivative: \\left.\\frac{d}{dx} f\\right|_{x=a}'); };

/**
 * Before the derivatives are read: what an evaluation bar holds is fenced, BAR_OPEN … |_ → BAR_OPEN(…)|_, so
 * an unbracketed body (\frac{d}{dx} x^3) ends at the bar instead of taking the |_{x=2} in.
 */
function fenceBars(text) {
    let from = 0;
    for (let i = text.indexOf(BAR_OPEN, from); i >= 0; i = text.indexOf(BAR_OPEN, from)) {
        let depth = 0;
        let bar = -1;
        for (let j = i + 1; j < text.length; j++) {
            if ('([{'.includes(text[j])) depth++;
            else if (')]}'.includes(text[j])) depth--;
            else if (depth === 0 && text.startsWith('|_', j)) { bar = j; break; }
        }
        if (bar < 0) refuseBar();
        text = `${text.slice(0, i + 1)}(${text.slice(i + 1, bar)})${text.slice(bar)}`;
        from = i + 1;
    }
    return text;
}

/**
 * A derivative at a point written with an evaluation bar: \left.\frac{d}{dx} x^3\right|_{x=2}, which the
 * phases before have made BAR_OPEN(der(x^{3},x))|_{x=2}, is der(x^{3},x=2); a bare point, |_{2}, is x = 2;
 * der(f,x,n) (the nth derivative) is der(f,x=a,n). Any other use of the bar is refused: it is read only
 * after a derivative.
 */
function evaluationBars(text) {
    for (let i = text.indexOf(BAR_OPEN); i >= 0; i = text.indexOf(BAR_OPEN)) {
        const refuse = refuseBar;
        if (!text.startsWith('(der(', i + 1)) refuse();
        const fence = matching(text, i + 1, '(', ')');
        const close = matching(text, i + 5, '(', ')');
        if (close < 0 || fence !== close + 1) refuse();
        const parts = topLevelParts(text.slice(i + 6, close));
        if (parts.length < 2 || parts.length > 3 || !text.startsWith('|_', fence + 1)) refuse();
        const point_ = fence;
        let point;
        let end;
        if (text[point_ + 3] === '{') {
            end = matching(text, point_ + 3, '{', '}');
            if (end < 0) refuse();
            point = text.slice(point_ + 4, end);
        } else {
            end = point_ + 3;   // |_2: one character
            point = text[end] ?? '';
        }
        const [body, by, n] = parts;
        if (!point.trim()) refuse();
        const at = point.includes('=') ? point : `${by}=${point}`;
        text = `${text.slice(0, i)}der(${body},${at}${n ? `,${n}` : ''})${text.slice(end + 1)}`;
    }
    return text;
}

/** Index of the bracket closing the one at `start`, or -1. */
function matching(text, start, open, close) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === open) depth++;
        else if (text[i] === close && --depth === 0) return i;
    }
    return -1;
}

/** The comma-separated parts of `text`, split only outside brackets. */
function topLevelParts(text) {
    const parts = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < text.length; i++) {
        if ('([{'.includes(text[i])) depth++;
        else if (')]}'.includes(text[i])) depth--;
        else if (text[i] === ',' && depth === 0) { parts.push(text.slice(from, i)); from = i + 1; }
    }
    parts.push(text.slice(from));
    return parts;
}

/**
 * Remove whitespace — except one space between two letters, which keeps
 * words apart: `cos t` must not become `cost`, nor `x y` the word `xy`.
 */
function squeeze(text) {
    return text.replace(/\s+/g, (space, at) => {
        const before = text[at - 1] ?? '';
        const after = text[at + space.length] ?? '';
        if (before === 'Δ') return '';   // Δ x is the one quantity Δx
        return /[A-Za-z\u0370-\u03FF′]/.test(before) && /[A-Za-z\u0370-\u03FF]/.test(after) ? ' ' : '';
    });
}

/**
 * Clean an expression for tokenizing.
 * @param {string} input
 * @param {object} [options]
 * @param {(expression: string) => string} [options.evaluate] called with the
 *   text of each `{{...}}` block; its result replaces the block (a quoted
 *   result, like "undefined", becomes a string). Blocks it throws on are left
 *   as they are. Without it, blocks are left alone.
 * @returns {{ cleaned: string, stringMap: Map<string, string>, steps: Array }}
 *   cleaned text (strings replaced by placeholders), the placeholder → string
 *   map, and [phase name, text after it] for every phase
 */
export function clean(input, options = {}) {
    if (typeof input !== 'string') throw new Error('Expression must be a string');
    const { text, strings } = extractStrings(markPrimes(input));
    let cleaned = text.replace(/\t/g, ' ');
    if (options.evaluate) cleaned = evaluateBlocks(cleaned, strings, options.evaluate);
    const steps = [['strings', cleaned]];
    for (const [name, phase] of PHASES) {
        cleaned = phase(cleaned);
        if (cleaned.length > 100000) throw new Error('The expression expands too much when read');   // a rewrite that copies an operand, nested
        steps.push([name, cleaned]);
    }
    return { cleaned, stringMap: strings, steps };
}

/**
 * Where LaTeX expects an argument: right after a command (\frac, \sqrt), `^`, `_`, or the `}` or `]`
 * that ends an earlier argument (\frac{1}{…}, \sqrt[3]{…}).
 */
const ARGUMENT = /(?:\\[A-Za-z]+\*?|[\^_}\]])$/;

/** Is the character at `i` escaped (\{ is a brace, not the start of a block; \\{ is a line break, then a brace)? */
function escaped(text, i) {
    let slashes = 0;
    while (text[i - 1 - slashes] === '\\') slashes++;
    return slashes % 2 === 1;
}

/**
 * Replace each `{{expression}}` with ` value `, left to right.
 * In LaTeX, braces that open an argument come first: \frac{{{2+2}}}{4} is \frac{ {{2+2}} }{4}, so where an
 * argument is expected the first of three braces is the argument's own; a block that is a whole argument by
 * itself (\frac{{2+2}}{4}) becomes {value}; and \{{{1+1}}, 3\} is the set {2, 3}.
 */
function evaluateBlocks(text, strings, evaluate) {
    const latex = /\\[A-Za-z]/.test(text);
    let from = 0;
    for (;;) {
        let start = text.indexOf('{{', from);
        if (start < 0) return text;
        let argument = false;
        const opensArgument = latex && ARGUMENT.test(text.slice(0, start));
        if (escaped(text, start) || (opensArgument && text[start + 2] === '{')) start += 1;   // the first brace isn't the block's
        else argument = opensArgument;
        if (!text.startsWith('{{', start)) { from = start; continue; }
        const end = matchingClose(text, start);
        if (end < 0) return text;
        let expression = text.slice(start + 2, end).trim();
        for (const [id, original] of strings) expression = expression.split(id).join(original);
        try {
            let value = evaluate(expression);
            if (/^["'`]/.test(value)) {
                const id = placeholder(strings.size);
                strings.set(id, value);
                value = id;
            }
            // A bare number next to a digit would join it: 2{{1+1}} is 2·2, not 22.
            const before = text.slice(0, start).trimEnd();
            const after = text.slice(end + 2).trimStart();
            if (/^[\d.]/.test(value) && (/[\d.]$/.test(before) || /^[\d.]/.test(after))) value = `(${value})`;
            if (argument) value = `{${value}}`;   // the block is the whole argument: \frac{{2+2}}{4} is \frac{4}{4}
            text = text.slice(0, start) + ' ' + value + ' ' + text.slice(end + 2);
            from = start + 1 + value.length;   // past the value: what a handler returns is not read for blocks again
        } catch {
            from = end + 2;
        }
    }
}

/** Index of the `}}` closing the `{{` at `start`, counting braces in between. */
function matchingClose(text, start) {
    let depth = 0;
    for (let i = start + 2; i < text.length; i++) {
        if (text.startsWith('}}', i) && depth === 0) return i;
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
    }
    return -1;
}
