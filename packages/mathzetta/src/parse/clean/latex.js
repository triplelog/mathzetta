/**
 * Structural rewrites: notation a lookup table can't handle because it
 * needs to find matching brackets. Each rewrite turns a construct into
 * plain function-call syntax the parser understands:
 *
 *   \frac{d}{dx} f, d/dx f    der(f,x)       (see derivatives())
 *   \frac{dy}{dx}, dy/dx      der(y,x)
 *   \frac{d^2y}{dx^2}         der(y,x,2)
 *   ddx(f)                der(f,x)
 *   \sqrt[n]{x}           sqrt{n,x}              (the parser makes this root(n, x))
 *   \int_a^b f dx         int(f,x,a,b)
 *   ⌊x⌋  ⌈x⌉              floor(x)  ceil(x)
 *   \binom56              \binom{5}{6}
 *   \begin{pmatrix}..     pmatrix([a, b], [c, d])   (bmatrix, vmatrix too; other kinds [[a, b], [c, d]])
 *   log(x, b)             log_{b}(x)
 *   a ? b : c             a ?(b)?: c
 *   if a then b else c    ((a) ? (b) : (c))      (no else: the value `unchanged`)
 *   x^-12, x_12           x^{-12}, x_{12}
 *   \text{abc}            abc
 *   \begin{cases} a & \text{if } p \\ b & \text{otherwise} \end{cases}    ((p) ? (a) : (b))   (casesToTernary, before names are protected)
 *
 * spacedRewrites() runs while spaces are still present; compactRewrites()
 * runs on the whitespace-free text. Limits, sums and products are left to
 * the parser, which reads lim_{x→a} and \sum_{i=1}^{n} like functions with
 * sub- and superscripts.
 */

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n';
const OPEN = '({[';
const CLOSE = ')}]';

/** Phase run before whitespace is removed. */
export function spacedRewrites(input) {
    input = bareRoots(mixedNumbers(unicodeScripts(input)));
    input = chooseNotation(nthDerivatives(spelledFunctions(input)));
    input = differentials(input);
    if (!/\\/.test(input)) input = setBuilder(input);   // plain text: {x : x > 2} (LaTeX's is read before names are protected)
    input = input.replace(/(?<![.\w=])\.\.\.(?![.\w=])/g, '⋯').replace(/∅/g, '\\{\\}');   // 1 + 2 + ... + n: three dots on their own; ∅ the empty set
    input = ifThenElse(input);
    // a ≡ b (mod n): the congruence form, applying to the whole statement
    input = input.replace(/\(\s*\\?b?mod\s+([^()\s](?:[^()]*[^()\s])?)\s*\)/g, ' \\pmod{$1}');   // the body starts and ends on a non-space: no backtracking over a run of spaces
    // lim x->0 f, lim x→a f: the spaces show where the subscript ends.
    input = input.replace(/(^|[^A-Za-z\\])lim\s+([^\s_{}]+?)\s*(->|→|\\to)\s*([^\s]+)\s+/g, '$1lim_{$2→$4} ');
    input = unwrapText(input);
    input = logBases(input);
    for (let i = 0; i < input.length - 1; i++) {
        if (input[i] === '?' && input[i + 1] !== ':') {
            input = wrapTernaryMiddle(input, i);
        } else if (input[i] === '_' || input[i] === '^') {
            // A numeric sub/superscript gets braces: x^-12 → x^{-12}, x^2-4 → x^{2}-4
            // and so does a protected name: \int_0^b with b a value (§0§) → \int_0^{§0§}
            const kept = /^§\d+§/.exec(input.slice(i + 1));
            if (kept) { input = `${input.slice(0, i + 1)}{${kept[0]}}${input.slice(i + 1 + kept[0].length)}`; continue; }
            // and a command with no argument: \sum_{n=1}^\infty \frac{1}{n^2} → ^{\infty}, or the spaces go and ∞frac is one name
            // (a _ after anything but a name or a group is the words phase's own mark, as in 2!_\cdot 3)
            const scripted = input[i] === '^' || /[A-Za-z}]/.test(input[i - 1] ?? '');
            const command = scripted && /^\\[A-Za-z]+(?![A-Za-z{\d])/.exec(input.slice(i + 1));   // not \frac12, which takes its digits
            if (command) { input = `${input.slice(0, i + 1)}{${command[0]}}${input.slice(i + 1 + command[0].length)}`; continue; }
            let j = i + 1;
            if (input[j] === '-') j++;
            while (j < input.length && '.0123456789'.includes(input[j])) j++;
            if (j === i + 2 && input[i + 1] === '-') j = i + 1;   // a lone `-` is not a number
            if (input[i + 1] === '-' && /^\s*[\^!]/.test(input.slice(j, j + 8))) continue;   // 2^-3^2 is 2^(-(3^2)), as 2^-x^2 is: the minus takes the power
            if (j > i + 1) input = input.slice(0, i + 1) + '{' + input.slice(i + 1, j) + '}' + input.slice(j);
        }
    }
    return input;
}

/** Phase run after whitespace is removed and symbols are replaced. */
export function compactRewrites(input) {
    input = logBases(input);
    input = input.replace(/(?<![A-Za-z])frac(\d)(\d)/g, 'frac{$1}{$2}');   // \frac12 → \frac{1}{2}
    input = primedGroups(input);
    input = derivatives(input);
    // each rewrite below re-reads the rest of the text: a bound on how many, or ∫∫∫… is quadratic
    if (input.split('\\int').length > 101) throw new Error('More than 100 integrals');
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        const before = (n) => input.slice(Math.max(0, i - n), i);
        const through = (n) => input.slice(Math.max(0, i - n), i + 1);

        if (char === '{') {
            if (before(6) === '\\begin') {
                const matrix = matrixToLists(input.slice(i + 1));
                if (matrix) input = input.slice(0, i - 6) + matrix;
            }
        } else if (char === '[') {
            if (before(5) === '\\sqrt') {
                input = input.slice(0, i - 5) + 'sqrt' + rootIndexToArgument(input.slice(i + 1));
            } else if (before(4) === 'sqrt') {
                input = input.slice(0, i - 4) + 'sqrt' + rootIndexToArgument(input.slice(i + 1));
            }
        } else if (char === '⌊' || char === '⌈') {
            input = input.slice(0, i) + floorCeil(input.slice(i));
        } else if (char === 't') {
            if (through(3) === '\\int') input = input.slice(0, i - 3) + integral(input.slice(i + 1));
        } else if (char === 'm') {
            if (through(5) === '\\binom') {
                input = input.slice(0, i - 5) + '\\binom' + braceBinomDigits(input.slice(i + 1));
            }
        } else if (char === 'd') {
            if (through(1) === 'dd' && input[i + 2] === '(') {
                const rewritten = ddxCall(input.slice(i + 1));
                if (rewritten) input = input.slice(0, i - 1) + 'der' + rewritten;
            }
        }
    }
    // a single letter set upright or named is that letter: \mathrm{e}^x, \operatorname{f}(x) (the d of an integral or
    // a derivative, \mathrm{d}x, has been read by now; longer names were set aside whole before cleaning)
    input = input.replace(/\\(?:text|textrm|textit|mathrm|mathit|mathbf|mathsf|operatorname)\{([A-Za-z])\}/g, '$1');
    return input.replace(/\\log/g, 'log');
}

// ---- differentials: dy = f'(x)\,dx --------------------------------------------------

/** The differential's mark until the tokenizer reads it: ⅆx is one name, dx (as Δx is). */
export const DIFFERENTIAL = 'ⅆ';
const GREEK_WORDS = 'alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega';
const DIFFERENTIAL_AT = new RegExp(String.raw`(\\(?:mathrm|operatorname|text)\{d\}\s*|d)([A-Za-zα-ω](?![A-Za-z0-9])|\\(?:${GREEK_WORDS})(?![A-Za-z]))`, 'g');

/**
 * A d before one letter (or a Greek one) that stands on its own is a differential, one quantity: dy = f'(x)\,dx,
 * du = 2x\,dx, ds = \sqrt{dx^2 + dy^2}, dA = 2\pi r\,dr. Only where it is clearly one: written \mathrm{d}x,
 * after a thin space (\,dx), or with another differential beside it; and not where an integral or a derivative
 * is written, whose readers take their own d (∫ x dx, \frac{dy}{dx}, d/dx). Elsewhere d x is still d times x.
 */
function differentials(input) {
    if (/\\[io]*int|∫|(?<![A-Za-z])int\(|\\partial|∂|(?<![A-Za-z])d\s*\/\s*d|frac\s*\{\s*(?:\\mathrm\s*\{\s*d\s*\}|\\operatorname\s*\{\s*d\s*\}|d)/.test(input)) return input;
    const found = [];
    for (const m of input.matchAll(DIFFERENTIAL_AT)) {
        const before = input.slice(0, m.index);
        const after = input.slice(m.index + m[0].length);
        const written = m[1] !== 'd';   // \mathrm{d}: a differential wherever it stands (r\mathrm{d}r)
        if (!written && (/[A-Za-z0-9\\^_/]$|frac\s*\{$/.test(before) || /^\s*[/}]/.test(after) && !/\{\s*$/.test(before))) continue;
        const strong = written || /\\[,;:! ]\s*$/.test(before);
        found.push({ m, strong });
    }
    const marked = found.length >= 2 ? found : found.filter((f) => f.strong);
    for (const { m } of marked.reverse()) {
        input = input.slice(0, m.index) + DIFFERENTIAL + m[2] + input.slice(m.index + m[0].length);
    }
    return input;
}

// ---- set-builder notation: {x | x > 2} ------------------------------------------------------------

/**
 * \{x \mid x > 2\}, \{x : x > 2\}, \left\{ x \in \mathbb{R} \middle| x^2 < 4 \right\}, and in plain text {x : x > 2}:
 * setbuilder(x, x > 2). The divider is the first \mid, \middle| or : (or, in LaTeX, |) where no bracket is open.
 */
export function setBuilder(text) {
    const OPENERS = [String.raw`\left\{`, String.raw`\left\lbrace`, String.raw`\{`, String.raw`\lbrace`, '{'];
    const CLOSERS = [String.raw`\right\}`, String.raw`\right\rbrace`, String.raw`\}`, String.raw`\rbrace`, '}'];
    const latex = /\\[A-Za-z{]/.test(text);
    for (let guard = 0, from = 0; guard < 50; guard++) {
        let start = -1;
        let open = '';
        for (let i = from; i < text.length && start < 0; i++) {
            const o = OPENERS.find((s) => text.startsWith(s, i));
            if (!o) continue;
            if (o === '{' && (latex ? true : /[\\^_A-Za-z]$/.test(text.slice(0, i)))) continue;   // in LaTeX a bare { is a group
            if (o === '{' && text[i + 1] === '{') { i++; continue; }   // {{…}}: a block
            start = i;
            open = o;
        }
        if (start < 0) return text;
        // its closer, and the first divider at depth 0
        let depth = 0;
        let divider = null;   // \mid, \middle| or : ; else the first bare | (which may also be an absolute value's)
        let bare = null;
        let end = -1;
        let asked = 0;
        for (let i = start + open.length; i < text.length; i++) {
            const c = CLOSERS.find((s) => text.startsWith(s, i));
            if (depth === 0 && c && (open === '{' ? c === '}' : c !== '}')) { end = i; open += '|' + c; break; }
            if ('([{'.includes(text[i]) && !(text[i] === '{' && text[i - 1] === '\\')) depth++;
            else if (')]}'.includes(text[i]) && text[i - 1] !== '\\') depth--;
            if (depth === 0 && text[i] === '?') asked++;   // {x > 0 ? 1 : 0}: the : is the ternary's
            if (depth === 0 && !divider) {
                const d = /^(?:\\middle\s*\||\\mid(?![A-Za-z])|:(?!=)|\|)/.exec(text.slice(i));
                if (d && d[0] === ':' && asked) asked--;
                else if (d && d[0] !== '|') divider = { at: i, length: d[0].length };
                else if (d && latex && !bare && !/\\left\s*$|\\right\s*$|\\middle\s*$/.test(text.slice(0, i))) bare = { at: i, length: 1 };
            }
        }
        divider ??= bare;
        if (end < 0 || !divider) { from = start + 1; continue; }
        const element = text.slice(start + open.split('|')[0].length, divider.at).trim();
        const condition = text.slice(divider.at + divider.length, end).trim();
        if (!element || !condition) { from = start + 1; continue; }
        const close = open.split('|')[1];
        text = `${text.slice(0, start)}setbuilder((${element}),(${condition}))${text.slice(end + close.length)}`;
        from = start;
    }
    return text;
}

// ---- evaluation bars: [F]_a^b ---------------------------------------------------

const SIZE = String.raw`\\(?:[Bb]igg?|right)[lrm]?`;
/** Where an evaluation bar closes: \right] \right| \Big] \bigg| (a size, then ] or |), or a plain ]. */
const BAR_CLOSE = new RegExp(`(?:${SIZE}\\s*([\\]|])|(\\]))\\s*(?=[_^])`, 'g');

/** One script after _ or ^: {…}, a \command (\pi, \infty) or one character. */
function barScript(text, at) {
    let i = at;
    while (text[i] === ' ') i++;
    if (text[i] === '{') {
        let depth = 0;
        for (let j = i; j < text.length; j++) {
            if (text[j] === '{') depth++;
            else if (text[j] === '}' && --depth === 0) return { value: text.slice(i + 1, j).trim(), end: j + 1 };
        }
        return null;
    }
    const command = /^\\[A-Za-z]+/.exec(text.slice(i));
    if (command) return { value: command[0], end: i + command[0].length };
    if (text[i] === '-' && /\d/.test(text[i + 1] ?? '')) return { value: text.slice(i, i + 2), end: i + 2 };
    return text[i] ? { value: text[i], end: i + 1 } : null;
}

/** _lo^hi or ^hi_lo at `at`, both there; else null. */
function readLimits(text, at) {
    let i = at;
    while (text[i] === ' ') i++;
    const first = text[i];
    if (first !== '_' && first !== '^') return null;
    const one = barScript(text, i + 1);
    if (!one) return null;
    let j = one.end;
    while (text[j] === ' ') j++;
    const second = first === '_' ? '^' : '_';
    if (text[j] !== second) return null;
    const two = barScript(text, j + 1);
    if (!two) return null;
    return first === '_' ? { lo: one.value, hi: two.value, end: two.end } : { lo: two.value, hi: one.value, end: two.end };
}

/** The opener matching a closer that ends at `close` (its first character): \left[ or \left. or a sized [, or a plain [. */
function barOpener(text, close, plain) {
    let depth = 0;
    for (let i = close - 1; i >= 0; i--) {
        if (plain) {
            if (text[i] === ']') depth++;
            else if (text[i] === '[') {
                if (depth === 0) return { start: i, end: i + 1 };
                depth--;
            }
            continue;
        }
        const before = text.slice(0, i + 1);
        const right = /\\right\s*[\]|)}.]$|\\[Bb]igg?r?\s*[\]|]$/.exec(before);
        const left = /\\left\s*(?:[[(.]|\\\{)$|\\[Bb]igg?l?\s*\[$/.exec(before);
        if (right && i + 1 < close) { depth++; i -= right[0].length - 1; continue; }
        if (left) {
            if (depth === 0) return { start: i + 1 - left[0].length, end: i + 1 };
            depth--;
            i -= left[0].length - 1;
        }
    }
    return null;
}

/** For F \Big|_0^1 with nothing opening the bar: F is the term before it, back to an = (or <, a comma …) or the start. */
function termBefore(text, bar) {
    let depth = 0;
    for (let i = bar - 1; i >= 0; i--) {
        const c = text[i];
        if (')]}'.includes(c)) depth++;
        else if ('([{'.includes(c)) { if (depth === 0) return i + 1; depth--; }
        else if (depth === 0 && /[=<>&,]/.test(c)) return i + 1;
        else if (depth === 0 && /\\(?:approx|leq?|geq?|neq?|to|quad|qquad)$/.test(text.slice(0, i + 1))) return i + 1;
    }
    return 0;
}

/**
 * An evaluation bar is F at the top limit minus F at the bottom one: \left[\frac{x^3}{3}\right]_0^1,
 * \left.x^2\right|_0^1, \frac{x^3}{3}\Big|_0^1, [x^2]_{x=0}^{x=1}. Written as evaluated(F, a, b) (or
 * evaluated(F, x, a, b) when the limits name the variable), which build.js completes with the variable.
 * Both limits are needed: \left.\frac{d}{dx} f\right|_{x=a} (one) is a derivative at a point, read later.
 */
export function evaluationBarsLatex(text) {
    for (let guard = 0; guard < 50; guard++) {
        BAR_CLOSE.lastIndex = 0;
        let found = null;
        for (let m = BAR_CLOSE.exec(text); m; m = BAR_CLOSE.exec(text)) {
            const limits = readLimits(text, m.index + m[0].length);
            if (!limits) continue;
            const plain = Boolean(m[2]);
            const bar = (m[1] ?? m[2]) === '|';
            const opener = barOpener(text, m.index, plain);
            // a bar with nothing opening it (F \Big|_0^1) takes the term before it; a ] always has its [
            if (!opener && !(bar && !/^\\right/.test(m[0]))) continue;
            if (opener && /\\left\s*\|$/.test(text.slice(opener.start, opener.end))) continue;   // |x|_…: an absolute value
            found = { m, limits, opener };
            break;
        }
        if (!found) return text;
        const { m, limits, opener } = found;
        const start = opener ? opener.start : termBefore(text, m.index);
        const body = text.slice(opener ? opener.end : start, m.index).trim();
        // the limits may name the variable, a Greek one too: _{\theta=0}^{\theta=\pi}
        const named = /^\s*([A-Za-zα-ωΑ-Ω]|\\[A-Za-z]+)\s*=\s*([\s\S]+)$/.exec(limits.lo);
        const hi = limits.hi.replace(/^\s*(?:[A-Za-zα-ωΑ-Ω]|\\[A-Za-z]+)\s*=\s*/, '');
        const call = named ? `evaluated((${body}),${named[1]},${named[2]},${hi})` : `evaluated((${body}),${limits.lo},${hi})`;
        text = `${text.slice(0, start)}${start > 0 && /[^\s(=]/.test(text[start - 1]) ? ' ' : ''}${call}${text.slice(limits.end)}`;
    }
    return text;
}

// ---- written small: x₁, x¹², 1½, \sqrt x -------------------------------------

const SPELLED = { __proto__: null, sine: 'sin', cosine: 'cos', tangent: 'tan', secant: 'sec', cosecant: 'csc', cotangent: 'cot' };
/**
 * sine(x), arcsine(x), cotangent x: the trig functions by their names, when an argument follows (a call, or a
 * space and a name or number). The tokenizer would read arcsine as arcsin times e; tangent alone stays a word.
 */
function spelledFunctions(input) {
    return input.replace(/(?<![A-Za-z\\])(arc)?(sine|cosine|tangent|secant|cosecant|cotangent)(?![A-Za-z])(?=\s*\(|\s+(?:[A-Za-z](?![A-Za-z])|\d|\\))/gi,
        (word, arc, name) => (arc ? 'arc' : '') + SPELLED[name.toLowerCase()]);
}

/**
 * f^{(4)}(x), f⁽⁴⁾(x), f^{(12)}(x): the nth derivative, written as f′′′′(x) is (a count in brackets is not a power):
 * the name f with n primes, for any whole n up to MAX_PRIMES (more is refused, so the name can't grow without bound).
 */
function nthDerivatives(input) {
    return input.replace(/(?<![A-Za-z\\])([A-Za-z])\^\s*\{?\s*\(\s*([1-9]\d*)\s*\)\s*\}?(?=\s*\()/g, (_, f, n) => {
        if (n.length > 3 || Number(n) > MAX_PRIMES) throw new Error(`A derivative f^{(n)} is read up to n = ${MAX_PRIMES}`);
        return f + '′'.repeat(Number(n));
    });
}
const MAX_PRIMES = 100;

/** ₅C₂, {}_5C_2, {}_{n}P_{r}, _nC_r: n choose r and n permute r, as \binom and perm are. */
function chooseNotation(input) {
    return input.replace(/(?:\{\s*\}|(?<![\w}\])′]))_\s*(?:\{\s*([^{}]+?)\s*\}|([A-Za-z0-9]+?))\s*(?:\\mathrm\{([CP])\}|([CP]))\s*_\s*(?:\{\s*([^{}]+?)\s*\}|([A-Za-z0-9]))/g,
        (_, n1, n2, c1, c2, r1, r2) => `${(c1 ?? c2) === 'C' ? 'comb' : 'perm'}(${n1 ?? n2},${r1 ?? r2})`);
}

const SUPERSCRIPTS = { __proto__: null };
const SUBSCRIPTS = { __proto__: null };
[...'⁰¹²³⁴⁵⁶⁷⁸⁹'].forEach((c, n) => { SUPERSCRIPTS[c] = String(n); });
[...'₀₁₂₃₄₅₆₇₈₉'].forEach((c, n) => { SUBSCRIPTS[c] = String(n); });
Object.assign(SUPERSCRIPTS, {
    '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
    'ᵃ': 'a', 'ᵇ': 'b', 'ᶜ': 'c', 'ᵈ': 'd', 'ᵉ': 'e', 'ᶠ': 'f', 'ᵍ': 'g', 'ʰ': 'h', 'ⁱ': 'i', 'ʲ': 'j', 'ᵏ': 'k', 'ˡ': 'l', 'ᵐ': 'm',
    'ⁿ': 'n', 'ᵒ': 'o', 'ᵖ': 'p', 'ʳ': 'r', 'ˢ': 's', 'ᵗ': 't', 'ᵘ': 'u', 'ᵛ': 'v', 'ʷ': 'w', 'ˣ': 'x', 'ʸ': 'y', 'ᶻ': 'z',
});
Object.assign(SUBSCRIPTS, {
    '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
    'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₒ': 'o', 'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's',
    'ₜ': 't', 'ᵤ': 'u', 'ᵥ': 'v', 'ₓ': 'x',
});
const SCRIPT_RUNS = new RegExp(`[${Object.keys(SUPERSCRIPTS).join('')}]+|[${Object.keys(SUBSCRIPTS).join('')}]+`, 'g');

/**
 * Characters written small are one script, however many there are: x₁₂ is x_{12} and x¹² is x^{12} (one
 * character at a time, x¹² was (x^1)^2 and x₁ was x times a thing called ₁); x⁻ⁿ is x^{-n}, xᵢ is x_{i}.
 */
function unicodeScripts(input) {
    return input.replace(SCRIPT_RUNS, (run) => {
        const up = run[0] in SUPERSCRIPTS;
        return `${up ? '^' : '_'}{${[...run].map((c) => (up ? SUPERSCRIPTS : SUBSCRIPTS)[c]).join('')}}`;
    });
}

const VULGAR = {
    __proto__: null,
    '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6',
    '⅐': '1/7', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅑': '1/9', '⅒': '1/10',
};
const MIXED_CHAR = new RegExp(`(?<![\\w.,^_])(\\d+)[ \\t]?([${Object.keys(VULGAR).join('')}])`, 'g');
const MIXED_SLASH = /(?<![\w.,^_/])(\d+)[ \t]+([1-9]\d*)\/(\d+)(?![\d./^!])/g;
const MIXED_FRAC = /(?<![\w.,^_])(\d+)\s*\\[dtc]?frac\s*(?:\{\s*(\d+)\s*\}\s*\{\s*(\d+)\s*\}|(\d)(\d)(?!\d))/g;

/**
 * A whole number with a fraction right after it is a mixed number, their sum: 1½, 2 ¾, 1 1/2, 3\frac{1}{4}.
 * Only a proper fraction makes one (2\frac{3}{2} and 2 3/2 stay as they were), and never after ^ or _
 * (x^2\frac{1}{2} is x² times a half). In 1 234/567 the space groups the digits, as in 1 000.
 */
function mixedNumbers(input) {
    input = input.replace(MIXED_CHAR, (_, whole, c) => `(${whole}+${VULGAR[c]})`);
    input = input.replace(MIXED_SLASH, (all, whole, n, d) => (Number(n) < Number(d) && n.length !== 3 ? `(${whole}+${n}/${d})` : all));
    return input.replace(MIXED_FRAC, (all, whole, n, d, n1, d1) => {
        const [top, bottom] = [n ?? n1, d ?? d1];
        return Number(top) < Number(bottom) ? `(${whole}+\\frac{${top}}{${bottom}})` : all;
    });
}

/**
 * \sqrt with no braces takes what TeX would give it: one letter, one number, or one command with its
 * arguments — \sqrt x, \sqrt 2, \sqrt\pi, \sqrt\frac{1}{2}, 2\sqrt x + 1. (\sqrt 2x is √2 · x, as it is
 * typeset; the plain word reads on: sqrt 2x is √(2x).) A number is taken whole, as x^12 is.
 */
function bareRoots(input) {
    // the last one first, so \sqrt\sqrt x has its inner root braced when the outer one looks
    for (let at = input.lastIndexOf('\\sqrt'); at >= 0; at = at > 0 ? input.lastIndexOf('\\sqrt', at - 1) : -1) {
        let i = at + 5;
        if (/[A-Za-z]/.test(input[i] ?? '')) continue;            // another command: \sqrtsign
        while (isSpace(input[i])) i++;
        const rest = input.slice(i);
        let token = /^(?:§\d+§|-?(?:\d+(?:\.\d+)?|\.\d+)|-?[A-Za-zͰ-Ͽ])/.exec(rest)?.[0];
        if (!token && /^\\[A-Za-z]/.test(rest) && !rest.startsWith('\\left')) {
            let j = /^\\[A-Za-z]+/.exec(rest)[0].length;
            const digits = /^\d\d/.exec(rest.slice(j));           // \frac12
            if (digits && /frac$/.test(rest.slice(0, j))) j += 2;
            else {
                const index = /^\s*\[[^\[\]{}]*\]/.exec(rest.slice(j));   // \sqrt[3]{x} inside: its index first
                if (index) j += index[0].length;
                for (;;) {                                         // its {arguments}, each closed
                    let k = j;
                    while (isSpace(rest[k])) k++;
                    if (rest[k] !== '{') break;
                    let depth = 0;
                    let end = -1;
                    for (let m = k; m < rest.length; m++) {
                        if (rest[m] === '{') depth++;
                        else if (rest[m] === '}' && --depth === 0) { end = m; break; }
                    }
                    if (end < 0) break;
                    j = end + 1;
                }
            }
            token = rest.slice(0, j);
        }
        if (!token) continue;                                      // \sqrt{…}, \sqrt[n]…, \sqrt(…): read as before
        input = `${input.slice(0, at)}\\sqrt{${token}}${input.slice(i + token.length)}`;
    }
    return input;
}

// ---- before names are protected ----------------------------------------------

/**
 * `\begin{cases} a & \text{if } p \\ b & \text{otherwise} \end{cases}` →
 * `((p) ? (a) : (b))`; more rows nest (`p ? a : q ? b : c`), and without an
 * otherwise row the last value is `unchanged`, as for `if … then`. Innermost
 * first, so a case inside a case works.
 */
export function casesToTernary(input) {
    for (let guard = 0; guard < 50; guard++) {
        const start = input.lastIndexOf('\\begin{cases}');
        const end = start < 0 ? -1 : input.indexOf('\\end{cases}', start);
        if (end < 0) return input;
        const rows = splitAtDepthZero(input.slice(start + '\\begin{cases}'.length, end), '\\\\')
            .map((row) => splitAtDepthZero(row, '&'))
            .filter((row) => row.join('').trim());
        let out = null;
        // a system: every row one cell, each an equation or inequality (no "&", no condition) — all of them hold
        const RELATION = /=|<|>|\\(?:le|ge|leq|geq|neq|ne|lt|gt)(?![A-Za-z])/;
        if (rows.length > 1 && rows.every((row) => row.length === 1 && RELATION.test(row[0]))) {
            out = rows.map((row) => `(${row[0].trim().replace(/\s*[,;.]$/, '')})`).join(' \\land ');
            input = input.slice(0, start) + `(${out})` + input.slice(end + '\\end{cases}'.length);
            continue;
        }
        for (let k = rows.length - 1; k >= 0; k--) {
            const value = rows[k][0].trim().replace(/\s*[,;]$/, '');   // x^2, & \text{if } x < 0: the comma is punctuation
            const condition = caseCondition(rows[k].slice(1).join('&'));
            if (out === null && !condition) out = `(${value})`;
            else out = `((${condition || 'true'}) ? (${value}) : ${out ?? '(unchanged)'})`;
        }
        input = input.slice(0, start) + (out ?? '') + input.slice(end + '\\end{cases}'.length);
    }
    return input;
}

/** A case's condition without its `if`; '' for otherwise / else. */
function caseCondition(text) {
    const words = /^\s*(?:\\(?:text|textrm|mathrm)\s*\{\s*(?:if|for|when|where)\s*\}|\b(?:if|for|when|where)\b)\s*,?/;
    const condition = text.replace(words, '').replace(/[\s,.;]+$/, '').trim();
    return /^(?:\\(?:text|textrm|mathrm)\s*\{\s*)?(?:otherwise|else)\s*\}?$/.test(condition) ? '' : condition;
}

/** Split at `separator` where no bracket or brace is open. */
function splitAtDepthZero(text, separator) {
    const parts = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < text.length; i++) {
        if (OPEN.includes(text[i])) depth++;
        else if (CLOSE.includes(text[i])) depth--;
        else if (depth === 0 && text.startsWith(separator, i)) {
            parts.push(text.slice(from, i));
            i += separator.length - 1;
            from = i + 1;
        }
    }
    parts.push(text.slice(from));
    return parts;
}

// ---- spaced phase -----------------------------------------------------------

/** `\text{abc}` → `abc`. */
function unwrapText(input) {
    for (let i = 0; i < input.length; i++) {
        const through = (n) => input.slice(Math.max(0, i - n), i + 1);
        if (input[i] === 't' && through(4) === '\\text' && input[i + 1] === '{') {
            let depth = 1;
            let j = i + 2;
            let text = '';
            while (depth > 0 && j < input.length) {
                if (input[j] === '{') depth++;
                else if (input[j] === '}') depth--;
                else text += input[j];
                j++;
            }
            input = input.slice(0, i - 4) + text + input.slice(j);
        }
    }
    return input;
}

/**
 * `if a then b else c` → `((a) ? (b) : (c))`, and `if a then b` →
 * `((a) ? (b) : (unchanged))` — `unchanged` being "whatever this value
 * was", which an image filter binds to the pixel's own channel. Rewritten
 * from the last `if` backwards, so `else if` chains nest properly.
 */
function ifThenElse(input) {
    for (let guard = 0; guard < 100; guard++) {
        const starts = [...input.matchAll(/\bif\b/gi)];
        if (!starts.length) return input;
        const start = starts[starts.length - 1].index;
        const then = wordAtDepthZero(input, start + 2, 'then');
        if (then < 0) return input;
        const condition = input.slice(start + 2, then);
        const otherwise = wordAtDepthZero(input, then + 4, 'else');
        const end = closeOfGroup(input, otherwise < 0 ? then + 4 : otherwise + 4);
        const value = input.slice(then + 4, otherwise < 0 ? end : otherwise);
        const fallback = otherwise < 0 ? 'unchanged' : input.slice(otherwise + 4, end).trim();
        input = `${input.slice(0, start)}((${condition.trim()}) ? (${value.trim()}) : (${fallback}))${input.slice(end)}`;
    }
    return input;
}

/** Index of `word` after `from`, outside any brackets opened since; -1 if a bracket closes first. */
function wordAtDepthZero(text, from, word) {
    let depth = 0;
    const pattern = new RegExp(`\\b${word}\\b`, 'iy');
    for (let i = from; i < text.length; i++) {
        if (OPEN.includes(text[i])) depth++;
        else if (CLOSE.includes(text[i])) { if (--depth < 0) return -1; }
        else if (depth === 0) {
            pattern.lastIndex = i;
            if (pattern.test(text)) return i;
        }
    }
    return -1;
}

/** Where the bracket enclosing `from` closes (or the text ends). */
function closeOfGroup(text, from) {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
        if (OPEN.includes(text[i])) depth++;
        else if (CLOSE.includes(text[i]) && --depth < 0) return i;
    }
    return text.length;
}

/** `a ? b : c` → `a ?(b)?: c`, matching nested ternaries. */
function wrapTernaryMiddle(input, i) {
    let depth = 1;
    for (let j = i + 1; j < input.length; j++) {
        if (input[j] === '?') depth++;
        else if (input[j] === ':' && --depth === 0) {
            return input.slice(0, i + 1) + '(' + input.slice(i + 1, j) + ')?:' + input.slice(j + 1);
        }
    }
    return input;
}

/**
 * `log_2x` → `log_{2}x`, `log_10 x` → `log_{10}x`, `log_bx` → `log_{b}x`: an
 * unbraced base is a run of digits or a single letter, as in LaTeX. And
 * `log(x, b)` → `log_{b}(x)`.
 */
function logBases(input) {
    for (let i = 2; i < input.length; i++) {
        if (input[i] !== 'g' || input.slice(i - 2, i + 1) !== 'log') continue;
        if (input[i + 1] === '_') {
            if (OPEN.includes(input[i + 2])) continue;
            const base = /^(?:\d+(?:\.\d+)?|[A-Za-z\u0370-\u03FF])/.exec(input.slice(i + 2))?.[0];
            if (!base) continue;
            const j = i + 2 + base.length;
            input = input.slice(0, i + 2) + '{' + base + '}' + input.slice(j);
        } else if (input[i + 1] === '(') {
            let depth = 1;
            let commas = 0;
            let value = '';
            let base = '';
            let end = 0;
            for (let j = i + 2; j < input.length; j++) {
                if (')]'.includes(input[j])) depth--;
                else if ('(['.includes(input[j])) depth++;
                if (depth === 0) {
                    end = j;
                    break;
                }
                if (depth === 1 && input[j] === ',') commas++;
                else if (commas === 0) value += input[j];
                else base += input[j];
            }
            if (commas === 1 && end > 0) input = input.slice(0, i + 1) + '_{' + base + '}(' + value + ')' + input.slice(end + 1);
        }
    }
    return input;
}

// ---- compact phase ----------------------------------------------------------

/** `⌊x⌋` → `floor(x)`, `⌈x⌉` → `ceil(x)`. */
function floorCeil(input) {
    const type = input[0] === '⌈' ? 'ceil' : 'floor';
    let depth = 1;
    for (let i = 1; i < input.length; i++) {
        if (input[i] === '⌊' || input[i] === '⌈') depth++;
        else if (input[i] === '⌋' || input[i] === '⌉') depth--;
        if (depth === 0) return type + '(' + input.slice(1, i) + ')' + input.slice(i + 1);
    }
    return input;
}

/** After `sqrt[`: `n]{x}` → `{n,x}`, `n]x` → `{n,x}`: the index becomes the first argument. */
function rootIndexToArgument(input) {
    let depth = 1;
    for (let i = 0; i < input.length; i++) {
        if (')]'.includes(input[i])) depth--;
        else if ('(['.includes(input[i])) depth++;
        if (depth !== 0) continue;
        const index = input.slice(0, i);
        const opener = input[i + 1];
        if (opener === '{' || opener === '(') return opener + index + ',' + input.slice(i + 2);
        const word = /^[A-Za-z0-9.\u0370-\u03FF]+/.exec(input.slice(i + 1))?.[0] ?? '';   // ∛x
        return '{' + index + ',' + word + '}' + input.slice(i + 1 + word.length);
    }
    return input;
}

const MATRIX_KINDS = new Set(['pmatrix', 'bmatrix', 'vmatrix']);

/** After `\begin{`: a matrix environment → pmatrix([a, b], [c, d]) (also b, v) or nested lists, or false. */
function matrixToLists(input) {
    const close = input.indexOf('}');
    const open = input.indexOf('{');
    if (close < 0 || (open >= 0 && open < close)) return false;
    const kind = input.slice(0, close);
    if (!kind.includes('matrix')) return false;

    const end = input.indexOf('\\end{' + kind + '}');
    const nested = input.indexOf('\\begin{' + kind + '}', close + 1);
    if (end < 0 || (nested !== -1 && nested < end)) return false;

    const rows = input.slice(close + 1, end).trim().split('\\\\')
        .map((row) => row.trim())
        .filter((row) => row.length)
        .map((row) => '[' + row.replace(/&/g, ', ') + ']');
    const rest = input.slice(end + 6 + kind.length);
    // ( ), [ ] and | | keep their brackets as a matrix operator; the others are lists of rows
    if (MATRIX_KINDS.has(kind)) return kind + '(' + rows.join(', ') + ')' + rest;
    return '[' + rows.join(', ') + ']' + rest;
}

/** Read `_x` or `_{...}` (and likewise `^`) at input[at]; returns [text, next index]. */
function readScript(input, at) {
    if (input[at + 1] !== '{') return [input[at + 1], at + 2];
    let depth = 1;
    let text = '';
    for (let i = at + 2; i < input.length; i++) {
        if (input[i] === '{') depth++;
        else if (input[i] === '}' && --depth === 0) return [text, i + 1];
        text += input[i];
    }
    return [text, input.length];
}

/** Read the optional _lower^upper of \int. */
function readBounds(input) {
    let lower = '';
    let upper = '';
    let next = 0;
    if (input[0] === '_') {
        [lower, next] = readScript(input, 0);
        if (input[next] === '^') [upper, next] = readScript(input, next);
    }
    return { lower, upper, next };
}

/** After `\int`: `_a^b f dx` → `int(f,x,a,b)`. */
function integral(input) {
    const { lower, upper, next } = readBounds(input);
    const tail = input.slice(next);
    const stripSpacing = (s) => s.replace(/\\,/g, '').replace(/\\!/g, '');

    let body;
    let variable = '';
    let rest = '';
    let d = tail.indexOf('\\mathrm{d}');
    if (d >= 0) {
        body = tail.slice(0, d);
        const named = /^\{([^{}]*)\}/.exec(tail.slice(d + 10));   // \mathrm{d}{x}
        variable = named ? named[1] : tail[d + 10];
        rest = tail.slice(d + 10 + (named ? named[0].length : 1));
    } else if ((d = differential(tail)) >= 0) {
        body = tail.slice(0, d);
        variable = tail[d + 1];
        rest = tail.slice(d + 2);
    } else {
        body = tail;
    }

    // ∫ dx/(1+x²) written \frac{dx}{1+x^2}: the dx sits in the numerator.
    if (!variable) {
        const m = /frac\{d([A-Za-z])\}/.exec(body);
        if (m) {
            variable = m[1];
            body = body.replace(m[0], 'frac{1}');
        }
    }

    // ∫_a^b f(x) with no dx: int(f, a, b) would read a as the variable when it is a letter, so
    // name the variable — the first lone letter of the body that isn't a function or a bound
    if (!variable && /^[A-Za-z]$/.test(lower)) {
        const lone = [...stripSpacing(body).matchAll(/(?<![A-Za-z\\])([A-Za-z])(?![A-Za-z(])/g)].map((m) => m[1]);
        variable = lone.find((v) => v !== lower && v !== upper) ?? 'x';
    }
    let out = 'int(' + (stripSpacing(body).trim() ? stripSpacing(body) : '1');   // ∫ dx is ∫ 1 dx, with or without a space
    if (variable) out += ',' + variable;
    if (lower || upper) out += ',' + lower + ',' + upper;
    return out + ')' + rest;
}

/**
 * Where the `dx` of an integral starts: the first `d` outside any brackets
 * that is followed by a single letter — `x^{2}dx`, `xdx`, `sinx\,dx`.
 */
function differential(tail) {
    let depth = 0;
    for (let i = 0; i < tail.length; i++) {
        if (OPEN.includes(tail[i])) depth++;
        else if (CLOSE.includes(tail[i])) depth--;
        else if (depth === 0 && tail[i] === 'd' && /[A-Za-z\u0370-\u03FF]/.test(tail[i + 1] ?? '')
            && !/[A-Za-z]/.test(tail[i + 2] ?? '')) return i;
    }
    return -1;
}

/** After `dd`: `x(f)` → `(f,x)`, or false if no variable letter follows. */
function ddxCall(input) {
    const variable = input[0];
    const isLetter = (variable >= 'A' && variable <= 'Z') || (variable >= 'a' && variable <= 'z')
        || (variable >= 'α' && variable <= 'ω');
    if (!isLetter) return false;
    const body = input.slice(2);
    let depth = 1;
    for (let i = 0; i < body.length; i++) {
        if (CLOSE.includes(body[i])) depth--;
        else if (OPEN.includes(body[i])) depth++;
        if (depth === 0) return '(' + body.slice(0, i) + ',' + variable + ')' + body.slice(i + 1);
    }
    return false;
}

/** After `\binom`: two bare digits get braces, `56` → `{5}{6}`. */
function braceBinomDigits(input) {
    if (input[0] === '{' || input.length < 2) return input;
    return '{' + input[0] + '}{' + input[1] + '}' + input.slice(2);
}

// ---- derivative notation ----------------------------------------------------

/**
 * (fg)′ → der((fg),x): a prime on a bracketed expression differentiates
 * it. A call takes its name along: sin(x)′ and f(x)′ are (sin x)′, (f(x))′.
 */
function primedGroups(text) {
    for (let i = text.indexOf(')′'); i >= 0; i = text.indexOf(')′', i + 1)) {
        let depth = 0;
        let start = -1;
        for (let j = i; j >= 0; j--) {
            if (text[j] === ')') depth++;
            else if (text[j] === '(' && --depth === 0) { start = j; break; }
        }
        if (start < 0) continue;
        while (start > 0 && /[A-Za-z\u0370-\u03FF′]/.test(text[start - 1])) start--;
        let n = 0;
        while (text[i + 1 + n] === '′') n++;
        text = text.slice(0, start) + der(text.slice(start, i + 1), 'x', n) + text.slice(i + 1 + n);
        i = start;
    }
    return text;
}

const VARIABLE = /[A-Za-z\u0370-\u03FF]/;

/** Read `{...}` at text[at]; returns [inside, index after] or null. */
function braced(text, at) {
    if (text[at] !== '{') return null;
    let depth = 0;
    for (let i = at; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return [text.slice(at + 1, i), i + 1];
    }
    return null;
}

/** `^{2}` or `^2` at text[at] → [2, index after]; nothing there → [1, at]. */
function order(text, at) {
    const m = /^\^(?:\{(\d+)\}|(\d))/.exec(text.slice(at));
    return m ? [Number(m[1] ?? m[2]), at + m[0].length] : [1, at];
}

/**
 * The parts of a Leibniz fraction: numerator `d`, `d^{n}`, `dy`, `d^{n}y`
 * and denominator `dx`, `dx^{n}` (\mathrm{d} counts as d). Returns
 * { n, of, by } — `of` is '' for the operator form d/dx — or null.
 */
function leibniz(numerator, denominator) {
    const num = numerator.replace(/\\mathrm\{d\}/g, 'd');
    const den = denominator.replace(/\\mathrm\{d\}/g, 'd');
    const top = /^d(?:\^\{?(\d+)\}?)?([A-Za-z\u0370-\u03FF]?)$/.exec(num);
    const bottom = /^d([A-Za-z\u0370-\u03FF])(?:\^\{?(\d+)\}?)?$/.exec(den);
    if (!top || !bottom) return null;
    return { n: Number(top[1] ?? 1), of: top[2], by: bottom[1] };
}

/**
 * What d/dx applies to, starting at text[at]: a bracketed group if one
 * follows, otherwise everything up to `=`, `,` or a closing bracket.
 * Returns [body, index after].
 */
function derivativeBody(text, at) {
    if (OPEN.includes(text[at])) {
        let depth = 0;
        for (let i = at; i < text.length; i++) {
            if (OPEN.includes(text[i])) depth++;
            else if (CLOSE.includes(text[i]) && --depth === 0) return [text.slice(at, i + 1), i + 1];
        }
        return [text.slice(at), text.length];
    }
    let depth = 0;
    for (let i = at; i < text.length; i++) {
        if (OPEN.includes(text[i])) depth++;
        else if (CLOSE.includes(text[i]) && --depth < 0) return [text.slice(at, i), i];
        else if (depth === 0 && (text[i] === '=' || text[i] === ',')) return [text.slice(at, i), i];
    }
    return [text.slice(at), text.length];
}

const der = (body, by, n) => `der(${body},${by}${n > 1 ? ',' + n : ''})`;

/**
 * Leibniz notation → der(...):
 *
 *   \frac{d}{dx} f, d/dx f       der(f,x)      f: a bracketed group, or the
 *   \frac{d^2}{dx^2} f            der(f,x,2)    rest up to = , or a bracket
 *   \frac{dy}{dx}, dy/dx          der(y,x)
 *   \frac{d^2y}{dx^2}             der(y,x,2)
 */
function derivatives(text) {
    for (let i = 0; i < text.length; i++) {
        const prevIsLetter = i > 0 && VARIABLE.test(text[i - 1]);
        let parts = null;
        let after = i;

        if (text.startsWith('frac{', i)) {
            const num = braced(text, i + 4);
            const den = num && braced(text, num[1]);
            parts = den && leibniz(num[0], den[0]);
            if (parts) after = den[1];
        } else if (text[i] === 'd' && !prevIsLetter) {
            // d/dx…, dy/dx…, d^{2}y/dx^{2}…: the variables are single letters,
            // which is how `d/dxx^2` (from "d/dx x^2") can be read at all.
            let [n, j] = order(text, i + 1);
            let of = '';
            if (VARIABLE.test(text[j] ?? '') && text[j + 1] === '/') of = text[j++];
            if (text[j] === '/' && text[j + 1] === 'd' && VARIABLE.test(text[j + 2] ?? '')) {
                const by = text[j + 2];
                const [, k] = order(text, j + 3);
                parts = { n, of, by };
                after = k;
            }
        }
        if (!parts) continue;

        let replacement;
        if (parts.of) {
            replacement = der(parts.of, parts.by, parts.n);
        } else {
            const [body, end] = derivativeBody(text, after);
            if (!body) continue;
            replacement = der(body, parts.by, parts.n);
            after = end;
        }
        text = text.slice(0, i) + replacement + text.slice(after);
        i += 3;   // past "der", so a body that is itself d/dx… is still rewritten
    }
    return text;
}
