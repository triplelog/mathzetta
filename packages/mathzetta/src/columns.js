/**
 * Column names in formula text: `Value * 2 + Count` over a table's header.
 * Names are matched case-insensitively as whole words and swapped for
 * placeholders before parsing, so names that look like maths (`e`, `max`,
 * `2B`) still mean the column. Used by formulas.js (tabview, sqldn) and
 * python-function.js (Python templates over data).
 */

const PLACEHOLDER = 'tktk';
const DIGIT_LETTERS = 'ABCDEFGHIJ';
export const placeholderFor = (index) => PLACEHOLDER + [...String(index)].map((d) => DIGIT_LETTERS[d]).join('');

/** Replace whole-word column names with placeholders. */
export function replaceColumnNames(formula, header) {
    const lower = header.map((h) => String(h).toLowerCase());
    return formula.replace(/[A-Za-z0-9_]+/g, (word) => {
        const index = lower.indexOf(word.toLowerCase());
        return index < 0 ? word : placeholderFor(index);
    });
}

/** The column a placeholder token stands for, or -1. */
export function columnIndexOf(token, header) {
    if (typeof token !== 'string' || !token.startsWith(PLACEHOLDER)) return -1;
    const digits = [...token.slice(PLACEHOLDER.length)].map((ch) => DIGIT_LETTERS.indexOf(ch));
    const index = digits.length && digits.every((d) => d >= 0) ? Number(digits.join('')) : -1;
    return index < header.length ? index : -1;
}
