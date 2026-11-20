/**
 * Column names in formula text: `Value * 2 + Count` over a table's header.
 * Names are matched case-insensitively as whole words and swapped for
 * placeholders before parsing, so names that look like math (`e`, `max`,
 * `2B`) still mean the column. Used by formulas.js (tabview, sqldn) and
 * python-function.js (Python templates over data).
 */

const PLACEHOLDER = 'tktk';
const DIGIT_LETTERS = 'ABCDEFGHIJ';
export const placeholderFor = (index) => PLACEHOLDER + [...String(index)].map((d) => DIGIT_LETTERS[d]).join('');

/**
 * Replace whole-word column names with placeholders — outside quoted text: in `team = "name"`, "name"
 * stays a string even with a column called name. An apostrophe after a letter, digit or bracket is a
 * prime (f'(x)), as the parser reads it, not a quote.
 */
export function replaceColumnNames(formula, header) {
    const lower = header.map((h) => String(h).toLowerCase());
    let out = '';
    for (let i = 0; i < formula.length;) {
        const c = formula[i];
        if (c === '"' || c === '`' || (c === "'" && !/[A-Za-z0-9)\]′'\u0370-\u03FF]/.test(out[out.length - 1] ?? ''))) {
            let j = i + 1;
            for (let escaped = false; j < formula.length && (escaped || formula[j] !== c); j++) escaped = !escaped && formula[j] === '\\';
            out += formula.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        const word = /[A-Za-z0-9_]+/y;
        word.lastIndex = i;
        const m = word.exec(formula);
        if (!m) {
            out += c;
            i++;
            continue;
        }
        const index = lower.indexOf(m[0].toLowerCase());
        out += index < 0 ? m[0] : placeholderFor(index);
        i += m[0].length;
    }
    return out;
}

/** The column a placeholder token stands for, or -1. */
export function columnIndexOf(token, header) {
    if (typeof token !== 'string' || !token.startsWith(PLACEHOLDER)) return -1;
    const digits = [...token.slice(PLACEHOLDER.length)].map((ch) => DIGIT_LETTERS.indexOf(ch));
    const index = digits.length && digits.every((d) => d >= 0) ? Number(digits.join('')) : -1;
    return index < header.length ? index : -1;
}
