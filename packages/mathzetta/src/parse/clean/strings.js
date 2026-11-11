/**
 * Quoted strings are lifted out before cleaning, so that text inside them
 * ("2+2", "x < y") is never rewritten, and put back into the postfix at the
 * end. Each string is replaced by a placeholder made only of letters, which
 * the tokenizer treats as one ordinary operand.
 */

const PREFIX = 'strtktk';
const DIGIT_LETTERS = 'ABCDEFGHIJ';

export const placeholder = (n) => PREFIX + [...String(n)].map((d) => DIGIT_LETTERS[d]).join('');
/** Is this word a string's placeholder? (It must stay one token, never be read as letters.) */
const PLACEHOLDER = new RegExp(`^${PREFIX}[${DIGIT_LETTERS}]+$`);
export const isPlaceholder = (word) => PLACEHOLDER.test(word);

/**
 * An apostrophe right after a letter, digit, closing bracket or another
 * apostrophe is a prime (f'(x), y''), not the start of a 'string': turn it
 * into ′ so extractStrings leaves it alone.
 */
export function markPrimes(input) {
    let out = '';
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (c === '"' || c === '`') {   // copy a double-quoted or backtick string as it is
            const end = closingQuote(input, i);
            out += input.slice(i, end + 1);
            i = end;
        } else if (c === "'") {
            if (/[A-Za-z0-9)\]′\u0370-\u03FF]/.test(out[out.length - 1] ?? '')) {
                out += '′';
            } else {
                const end = closingQuote(input, i);
                out += input.slice(i, end + 1);
                i = end;
            }
        } else {
            out += c;
        }
    }
    return out;
}

function closingQuote(input, start) {
    let escaped = false;
    for (let j = start + 1; j < input.length; j++) {
        if (escaped) escaped = false;
        else if (input[j] === '\\') escaped = true;
        else if (input[j] === input[start]) return j;
    }
    return input.length - 1;
}

/**
 * @returns {{ text: string, strings: Map<string, string> }} text with
 *   placeholders, and placeholder → original string (quotes included)
 */
export function extractStrings(input) {
    const strings = new Map();
    let text = '';
    let i = 0;
    while (i < input.length) {
        const quote = input[i];
        if (quote !== '"' && quote !== "'" && quote !== '`') {
            text += input[i++];
            continue;
        }
        let j = i + 1;
        let body = '';
        let escaped = false;
        while (j < input.length && (escaped || input[j] !== quote)) {
            escaped = !escaped && input[j] === '\\';
            body += input[j++];
        }
        const id = placeholder(strings.size);
        strings.set(id, quote + body + quote);
        text += id;
        i = j + 1;
    }
    return { text, strings };
}

// a string's placeholder (strtktkBA), or a protected name's (§0§, parse/index.js)
const ANY_PLACEHOLDER = new RegExp(`${PREFIX}[${DIGIT_LETTERS}]+|§\\d+§`, 'g');

/** Put the original strings back into each token: one pass over each token, whatever the count. */
export function restoreStrings(tokens, strings) {
    if (!strings || strings.size === 0) return tokens;
    return tokens.map((token) => (typeof token !== 'string' ? token : token.replace(ANY_PLACEHOLDER, (found) => {
        const exact = strings.get(found);
        if (exact !== undefined) return exact;
        // else the longest id that is one: "a"B is strtktkA then a letter B, not strtktkAB
        for (let end = found.length - 1; end > PREFIX.length; end--) {
            const original = strings.get(found.slice(0, end));
            if (original !== undefined) return original + found.slice(end);
        }
        return found;
    })));
}
