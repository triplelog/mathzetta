/**
 * The words and symbols the tokenizer recognizes as operators, with the
 * precedence (binding power) the parser gives them.
 *
 * This is deliberately separate from the operator table in ../operators.js.
 * That table describes the *output* (standard postfix); this one describes
 * the *input* the parser accepts, which includes spellings that get rewritten
 * later (`frac`, `pow`, `sqrtpow`, `\binom`, `==`, ...) and the comma that
 * builds argument lists.
 */

const FUNCTION = 100;

/**
 * How a product was written, kept beside the postfix (which has only `*`): the cleaner writes
 * \cdot · ⋅ as DOT_TIMES and \times × as CROSS_TIMES, the parser treats both exactly like `*`,
 * and buildTree() makes them `*` nodes with `written: 'dot'` or `'cross'` (parseSteps' `written`).
 * Private-use characters, so nothing typed is mistaken for them.
 */
export const DOT_TIMES = '\uE0B7';
export const CROSS_TIMES = '\uE0D7';
export const WRITTEN_TIMES = { [DOT_TIMES]: 'dot', [CROSS_TIMES]: 'cross' };

/** \left. in the cleaned text: where an evaluation bar \left. … \right|_{x = a} opens (clean/index.js reads it). */
export const BAR_OPEN = '\uE0A6';

export const PARSE_PRECEDENCE = {
    // functions
    'ln': FUNCTION, 'log': FUNCTION, 'loglog': FUNCTION, 'logloglog': FUNCTION,
    'sqrt': FUNCTION, 'sqrtpow': FUNCTION, 'pow': FUNCTION, 'expm1': FUNCTION,
    'der': FUNCTION, 'lim': FUNCTION, 'int': FUNCTION,
    'round': FUNCTION, 'fixed': FUNCTION, 'floor': FUNCTION, 'ceil': FUNCTION, 'abs': FUNCTION, 'random': FUNCTION,
    'sum': FUNCTION, 'prod': FUNCTION, '\\sumidx': FUNCTION, '\\prodidx': FUNCTION,
    'perm': FUNCTION, 'comb': FUNCTION, '\\perm': FUNCTION, '\\comb': FUNCTION, '\\binom': FUNCTION,
    'max': FUNCTION, 'min': FUNCTION, 'gcd': FUNCTION, 'mean': FUNCTION,
    'pmatrix': FUNCTION, 'bmatrix': FUNCTION, 'vmatrix': FUNCTION, 'det': FUNCTION,
    'sin': FUNCTION, 'cos': FUNCTION, 'tan': FUNCTION, 'csc': FUNCTION, 'sec': FUNCTION, 'cot': FUNCTION,
    'sinh': FUNCTION, 'cosh': FUNCTION, 'tanh': FUNCTION,
    'evaluated': FUNCTION, 'setbuilder': FUNCTION,
    'arcsin': FUNCTION, 'arccos': FUNCTION, 'arctan': FUNCTION, 'arcsec': FUNCTION, 'arccsc': FUNCTION, 'arccot': FUNCTION,
    'arcsinh': FUNCTION, 'arccosh': FUNCTION, 'arctanh': FUNCTION, 'atan2': FUNCTION,
    '_': FUNCTION,

    // operators, tightest first
    '!': 90,
    '\\not': 85,
    '^': 80,
    '*': 70, '/': 70, 'frac': 70,
    [DOT_TIMES]: 70, [CROSS_TIMES]: 70,   // · and ×, read as * but remembered (WRITTEN_TIMES)
    'mod': 45,      // see parser.js: takes all of its left side, one factor on the right
    '+': 50, '-': 50, '±': 50,
    '→': 38,
    '<': 34, '>': 34, '≤': 34, '≥': 34,
    '∈': 32, '∉': 32, '∪': 33, '∩': 33,
    '=': 30, '==': 30, '===': 30, '≠': 30, '≠=': 30, '!==': 30, '≈': 30, '≡': 30,
    'pmod': 2,      // a ≡ b (mod n): applies to the whole statement
    '&': 20,
    '\\xor': 19,
    '|': 18, '∨': 18,   // ∨ is "or" written so it can't be mistaken for an absolute value bar
    '\\nor': 17, '\\nand': 17,
    '\\implies': 15, '\\iff': 14,
    '?:': 10,
    '?': 9,
    ',': 5,
};

/** Is `text` a word the tokenizer should cut out as an operator? */
export const isOperatorWord = (text) =>
    Object.prototype.hasOwnProperty.call(PARSE_PRECEDENCE, text);

/** Operators that group right-to-left: 2^3^4 = 2^(3^4). */
export const RIGHT_ASSOCIATIVE = new Set(['^', '?:', '?', 'log']);

export const OPENERS = ['(', '{', '['];
export const CLOSERS = [')', '}', ']'];

/**
 * A number as written: 3, 0.5, .5, 1., and a repeating decimal 1.333.. (the block ends the digits) — no exponent.
 * With `allowSign`, a leading minus too (-3, -.5). Not '.', '-.' or '1.2.3'.
 */
export function isNumber(text, allowSign = false) {
    return typeof text === 'string' && (allowSign ? SIGNED_NUMBER : NUMBER).test(text);
}
const NUMBER = /^(?:\d+\.?\d*|\.\d+|\d*\.\d+\.\.)$/;
const SIGNED_NUMBER = /^-?(?:\d+\.?\d*|\.\d+|\d*\.\d+\.\.)$/;

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/security.test.js).
for (const table of [PARSE_PRECEDENCE]) Object.setPrototypeOf(table, null);
