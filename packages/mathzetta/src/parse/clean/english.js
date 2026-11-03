/**
 * Plain English for the things that are awkward to type as symbols: comparisons (`x is at least 3`),
 * ranges (`x is between 3 and 5`), properties (`n is even`, `x is a whole number`), and the words
 * MathZetta's own speech output uses (`the square root of x`, `x squared`), so what it says it can
 * read back. A cleaning phase (clean/index.js): text in, symbols out, whole words only; strings are
 * already placeholders. Ordered longest phrase first.
 *
 * Not a grammar: a subject is the word, number or bracketed group just before a phrase; an operand
 * after `of` is one word, number or bracketed group (`the square root of (x + 1)`).
 */

// one operand: a bracketed group, or a run of name / number characters (with powers and subscripts)
// starts only where a run of name characters starts: a regex that tried every position in a long word would be quadratic
const OPERAND = String.raw`(?:\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}|(?<![\w.′^])[\w.′^]+)`;
const W = (s) => s.trim().split(/\s+/).join(String.raw`\s+`);   // a phrase's words, any spacing between them
const phrase = (words) => new RegExp(String.raw`(?<![\w.])${W(words)}(?![\w.])`, 'gi');

const COMPARISONS = [
    ['is greater than or equal to', '≥'], ['is more than or equal to', '≥'], ['is at least', '≥'], ['is no less than', '≥'], ['is not less than', '≥'],
    ['is less than or equal to', '≤'], ['is at most', '≤'], ['is no more than', '≤'], ['is not more than', '≤'], ['is not greater than', '≤'],
    ['is greater than', '>'], ['is more than', '>'], ['is bigger than', '>'], ['is larger than', '>'], ['is above', '>'], ['exceeds', '>'],
    ['is less than', '<'], ['is smaller than', '<'], ['is fewer than', '<'], ['is below', '<'],
    ['is not equal to', '≠'], ['does not equal', '≠'], ['doesn\'t equal', '≠'], ['is different from', '≠'],
    ['is approximately equal to', '≈'], ['is approximately', '≈'], ['is about', '≈'], ['is roughly', '≈'], ['is close to', '≈'],
    ['is equal to', '='], ['is the same as', '='], ['equals', '='],
    // the same without `is`, after `and` / `or`: x is at least 3 and at most 7
    ['greater than or equal to', '≥'], ['less than or equal to', '≤'], ['at least', '≥'], ['at most', '≤'],
    ['greater than', '>'], ['more than', '>'], ['less than', '<'], ['not equal to', '≠'], ['equal to', '='],
];
const CMP = '[<>≤≥=≠≈]';

const PROPERTIES = [
    // after the subject: `x is positive` → x > 0
    ['is non-negative', '≥ 0'], ['is nonnegative', '≥ 0'], ['is not negative', '≥ 0'],
    ['is non-positive', '≤ 0'], ['is nonpositive', '≤ 0'], ['is not positive', '≤ 0'],
    ['is positive', '> 0'], ['is negative', '< 0'], ['is non-zero', '≠ 0'], ['is nonzero', '≠ 0'], ['is not zero', '≠ 0'], ['is zero', '= 0'],
    ['is a whole number', '∈ ℤ'], ['is an integer', '∈ ℤ'], ['is not an integer', '∉ ℤ'], ['is a natural number', '∈ ℕ'],
    ['is a real number', '∈ ℝ'], ['is real', '∈ ℝ'], ['is a rational number', '∈ ℚ'], ['is rational', '∈ ℚ'],
];

export function englishRewrites(text) {
    if (!/[A-Za-z]{2}/.test(text)) return text;
    let t = text;

    // ranges first: they contain `and`, which must not split them
    const range = (words, open, close, op = '∈') => {
        t = t.replace(new RegExp(String.raw`(?<![\w.])${W(words)}\s+(${OPERAND})\s+(?:and|to)\s+(${OPERAND})(?:\s+(inclusive|exclusive))?(?![\w.])`, 'gi'),
            (whole, a, b, mode) => {
                const [o, c] = mode?.toLowerCase() === 'exclusive' ? ['(', ')'] : mode?.toLowerCase() === 'inclusive' ? ['[', ']'] : [open, close];
                return ` ${op} ${o}${a}, ${b}${c} `;
            });
    };
    range('is not strictly between', '(', ')', '∉');
    range('is not between', '[', ']', '∉');
    range('is strictly between', '(', ')');
    range('is between', '[', ']');
    range('between', '[', ']');
    // what speech writes for intervals: x is in the closed interval from 3 to 5
    t = t.replace(new RegExp(String.raw`(?<![\w.])is\s+(not\s+)?in\s+the\s+(open|closed|half-open)\s+interval\s+from\s+(${OPERAND})\s+to\s+(${OPERAND})`, 'gi'),
        (whole, not, kind, a, b) => {
            const [o, c] = { open: ['(', ')'], closed: ['[', ']'], 'half-open': ['[', ')'] }[kind.toLowerCase()];
            return ` ${not ? '∉' : '∈'} ${o}${a}, ${b}${c} `;
        });

    const SUBJECT = String.raw`(${OPERAND})\s+`;
    // tolerances: x is within 0.001 of 7 → |x − 7| ≤ 0.001; x is within 1% of 7 → |x − 7| ≤ 1/100 · |7|
    t = t.replace(new RegExp(SUBJECT + String.raw`is\s+(not\s+)?within\s+(${OPERAND})\s*(%|\s+percent)?\s+of\s+(${OPERAND})`, 'gi'),
        (w, x, not, d, pct, c) => `(abs((${x}) - (${c})) ${not ? '>' : '≤'} ${pct ? `(${d})/100 * ${/^\d+(\.\d+)?$/.test(c) ? c : `abs(${c})`}` : `(${d})`})`);

    // divisibility and parity: n is even, n is a multiple of 3, 3 divides n
    t = t.replace(new RegExp(SUBJECT + String.raw`is\s+(?:a\s+)?multiple\s+of\s+(${OPERAND})`, 'gi'), '(($1) mod ($2) = 0)');
    t = t.replace(new RegExp(SUBJECT + String.raw`is\s+(not\s+)?divisible\s+by\s+(${OPERAND})`, 'gi'), (w, x, not, n) => `((${x}) mod (${n}) ${not ? '≠' : '='} 0)`);
    t = t.replace(new RegExp(String.raw`(${OPERAND})\s+divides\s+(${OPERAND})`, 'gi'), '(($2) mod ($1) = 0)');
    t = t.replace(new RegExp(SUBJECT + String.raw`is\s+(not\s+)?(even|odd)(?![\w.])`, 'gi'),
        (w, x, not, kind) => `((${x}) mod 2 ${(kind.toLowerCase() === 'even') !== Boolean(not) ? '=' : '≠'} 0)`);

    for (const [words, symbol] of PROPERTIES) t = t.replace(phrase(words), ` ${symbol} `);
    t = t.replace(phrase('is not in'), ' ∉ ').replace(phrase('is in'), ' ∈ ').replace(phrase('is an element of'), ' ∈ ');
    for (const [words, symbol] of COMPARISONS) t = t.replace(phrase(words), ` ${symbol} `);
    t = t.replace(phrase('is not'), ' ≠ ');
    t = t.replace(/(?<=[\w.)\]}′]\s+)is(?=\s+[\w.(\[{-])/gi, ' = ');   // x is 7

    // `x > 3 and < 7`: a comparison with no subject takes the one before
    for (let again = true; again;) {
        const before = t;
        t = t.replace(new RegExp(String.raw`(${OPERAND})\s*(${CMP})\s*(${OPERAND})\s+(and|or)\s+(${CMP})`, 'gi'), '$1 $2 $3 $4 $1 $5');
        again = t !== before;
    }

    // the words speech uses for operations, so what MathZetta says it can read back
    t = t.replace(new RegExp(String.raw`(?<![\w.])(?:the\s+)?absolute\s+value\s+of\s+(${OPERAND})`, 'gi'), 'abs($1)');
    t = t.replace(new RegExp(String.raw`(?<![\w.])(?:the\s+)?square\s+root\s+of\s+(${OPERAND})`, 'gi'), 'sqrt($1)');
    t = t.replace(new RegExp(String.raw`(?<![\w.])(?:the\s+)?cube\s+root\s+of\s+(${OPERAND})`, 'gi'), 'root(3, $1)');
    t = t.replace(new RegExp(String.raw`(${OPERAND})\s+to\s+the\s+power\s+of\s+(${OPERAND})`, 'gi'), '($1)^($2)');
    const ORDINALS = { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
    t = t.replace(new RegExp(String.raw`(${OPERAND})\s+to\s+the\s+(${Object.keys(ORDINALS).join('|')}|(\d+|n)(?:st|nd|rd|th))(?:\s+power)?(?![\w.])`, 'gi'),
        (w, x, ord, n) => `(${x})^(${ORDINALS[ord.toLowerCase()] ?? n})`);
    t = t.replace(new RegExp(String.raw`(${OPERAND})\s+to\s+the\s+(${OPERAND})(?![\w.])`, 'gi'), '($1)^($2)');   // x to the n
    // named functions as speech says them: sine of x, the natural log of x
    const FUNCTION_WORDS = { sine: 'sin', cosine: 'cos', tangent: 'tan', secant: 'sec', cosecant: 'csc', cotangent: 'cot',
        'natural log': 'ln', 'natural logarithm': 'ln', 'arcsine': 'arcsin', 'arccosine': 'arccos', 'arctangent': 'arctan',
        'hyperbolic sine': 'sinh', 'hyperbolic cosine': 'cosh', 'hyperbolic tangent': 'tanh', floor: 'floor', ceiling: 'ceil' };
    for (const [words, fn] of Object.entries(FUNCTION_WORDS).sort((a, b) => b[0].length - a[0].length)) {
        t = t.replace(new RegExp(String.raw`(?<![\w.])(?:the\s+)?${W(words)}\s+of\s+(${OPERAND})`, 'gi'), `${fn}($1)`);
    }
    t = t.replace(new RegExp(String.raw`(${OPERAND})\s+squared(?![\w.])`, 'gi'), '($1)^2');
    t = t.replace(new RegExp(String.raw`(${OPERAND})\s+cubed(?![\w.])`, 'gi'), '($1)^3');
    t = t.replace(new RegExp(String.raw`(?<![\w.])half\s+of\s+(${OPERAND})`, 'gi'), '($1)/2');
    t = t.replace(new RegExp(String.raw`(?<![\w.])twice\s+(${OPERAND})`, 'gi'), '2*($1)');
    t = t.replace(new RegExp(String.raw`(\d+(?:\.\d+)?)\s+percent(?![\w.])`, 'gi'), '$1%');
    // between two operands only, so a name like `times` or `plus` alone stays a name
    const between = (words) => new RegExp(String.raw`(?<=[\w.′)\]}]\s+)${W(words)}(?=\s+[\w.(\[{-])`, 'gi');
    for (const [words, symbol] of [['divided by', '/'], ['over', '/'], ['multiplied by', '*'], ['times', '*'], ['plus', '+'], ['minus', '-'], ['modulo', 'mod']]) {
        t = t.replace(between(words), ` ${symbol} `);
    }
    return t;
}
