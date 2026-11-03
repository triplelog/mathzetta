/**
 * Tree → GLSL expression, for shaders: image filters, procedural
 * textures, anything that runs per pixel.
 *
 *   (r + g + b) / 3           (r + g + b) / 3.0
 *   (r - 0.5)^2 * 4           mz_sq(r - 0.5) * 4.0
 *   sin(2\pi x) / 2 + 0.5     sin(2.0 * 3.141592653589793 * x) / 2.0 + 0.5
 *   x < 0.5 ? 0 : 1           (x < 0.5 ? 0.0 : 1.0)
 *
 * GLSL is typed, so a few things differ from the JavaScript output:
 *
 *   - Every number is a float literal (2.0, not 2): `1/2` must not be
 *     integer division, and pow(x, 2) with an int wouldn't compile.
 *     Variables are assumed to be floats (or vectors — the arithmetic is
 *     the same, and the helpers have vec2/vec3/vec4 overloads).
 *   - x^2 is mz_sq(x) and x^3 mz_cube(x): GLSL's pow() is undefined for a
 *     negative base, which (r - 0.5)^2 hits all the time. Integer powers
 *     ±1..±4 are written as products; e^x is exp(x), 2^x is exp2(x);
 *     anything else is pow(base, exponent).
 *   - Things GLSL ES 1.0 (WebGL 1) lacks — round, sinh, asinh, factorial,
 *     gcd, cube roots, infinity — come from GLSL_HELPERS, a string of
 *     mz_* functions to paste above your main(). With { version: 300 }
 *     the native round/sinh/asinh are used instead.
 *   - Operators with no numeric meaning (der, int, lim, ∪, …) become calls
 *     to functions named for them, as in the JavaScript output; you supply
 *     them. Strings are written as they are and won't compile.
 *   - `°` is radians(): 30° → radians(30.0). mod is GLSL's mod(), which
 *     like the maths takes the sign of the divisor.
 */

import { needsParens, isCustomFunction, CUSTOM_PREFIX } from '../operators.js';
import { bracketOp, isMinusOneTimes, smallWhole, customName, expandChain, guardLength } from '../common.js';

/**
 * @param {object} node expression tree
 * @param {object} [options]
 * @param {100|300} [options.version] GLSL ES version to target; 100 (the default) works everywhere
 * @param {boolean} [options.filter] inside filterShader(): `unchanged` in a
 *   branch of `?:` becomes `mz_unchanged(other branch)`, which has the
 *   other branch's type — so `if c then 1` and `if c then (1, 0, 0)` both type-check
 * @returns {string} an expression
 */
export function toGlsl(node, options = {}) {
    const es3 = options.version === 300;
    const render = (n) => guardLength(n.type === 'op' ? operation(n, render, es3, options.filter) : leaf(n));
    return render(node);
}

const PI = '3.141592653589793';
const E = '2.718281828459045';

const CONSTANTS = {
    pi: PI, 'π': PI, e: E, tau: '6.283185307179586', 'τ': '6.283185307179586',
    '∞': 'MZ_INFINITY', '-∞': '(-MZ_INFINITY)', true: 'true', false: 'false',
};

/** A number token as a float literal: 2 → 2.0, .5 → 0.5, 1.333.. → 1.333. */
function float(text) {
    let v = text.replace(/\.+$/, '');
    if (v.startsWith('.')) v = '0' + v;
    if (v.startsWith('-.')) v = '-0' + v.slice(1);
    if (!v.includes('.')) v += '.0';
    return v;
}

function leaf(node) {
    const v = node.value;
    if (node.type === 'number') return float(v);
    if (node.type === 'string') return v;
    if (CONSTANTS[v] !== undefined) return CONSTANTS[v];
    if (v === '\\+' || v === '\\-') return v[1];
    return identifier(v);
}

/** f′ → f_prime, f⁻¹ → f_inverse, Δx → delta_x, θ → theta: names GLSL accepts. */
const GREEK_NAMES = {
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta',
    'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ρ': 'rho', 'σ': 'sigma',
    'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega', 'Δ': 'delta_', 'Σ': 'sigma', 'Ω': 'omega', 'Φ': 'phi', 'Θ': 'theta',
};
const identifier = (name) => name
    .replace(/′/g, '_prime').replace('⁻¹', '_inverse')
    .replace(/[^\x00-\x7F]/g, (ch) => GREEK_NAMES[ch] ?? `_u${ch.codePointAt(0).toString(16)}`)
    .replace(/[^A-Za-z0-9_]/g, '_');

/** Functions GLSL has under another name, or the same one. */
const BUILTIN = {
    sqrt: 'sqrt', abs: 'abs', floor: 'floor', ceil: 'ceil', ln: 'log',
    sin: 'sin', cos: 'cos', tan: 'tan', arcsin: 'asin', arccos: 'acos', arctan: 'atan', atan2: 'atan',
};

/** Functions GLSL ES 3.0 has natively and 1.0 needs a helper for. */
const ES3_ONLY = { sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', arcsinh: 'asinh', arccosh: 'acosh', arctanh: 'atanh', round: 'round' };

const RECIPROCALS = { csc: 'sin', sec: 'cos', cot: 'tan' };

const COMPARISONS = { '=': '==', '===': '==', '≠': '!=', '≠=': '!=', '<': '<', '>': '>', '≤': '<=', '≥': '>=' };

/** Operators that come out already wrapped in brackets or as a call, so never need more. */
const SELF_BRACKETED = new Set(['&', '|', '\\xor', '\\nand', '\\nor', '?:', 'mean', 'log', '≈', '∈', '∉']);

/** The operator that decides brackets, where GLSL writes something differently from the maths. */
function glslBracketOp(node) {
    if (node.type !== 'op') return null;
    if (['!', 'perm'].includes(node.op)) return '*';
    if (['comb', 'csc', 'sec', 'cot'].includes(node.op)) return '/';
    if (node.op === '^') return powerBracketOp(node);
    if (SELF_BRACKETED.has(node.op)) return null;
    return bracketOp(node);
}

/** x^2 is a call; x^-1 is a division; the rest are calls too. */
function powerBracketOp(node) {
    const n = integerExponent(node.args[1]);
    return n !== null && n < 0 && n >= -4 ? '/' : null;
}

/** The exponent as a small integer, or null. */
function integerExponent(exp) {
    if (exp.type !== 'number' || !/^-?\d+$/.test(exp.value)) return null;
    return Number(exp.value);
}

function operation(node, render, es3, filter = false) {
    const chained = expandChain(node);   // 3 < x < 7 is (3 < x) and (x < 7)
    if (chained) return render(chained);
    const { op, args } = node;
    const [a, b] = args;
    const side = (child, s, parentOp = op) => (needsParens(parentOp, glslBracketOp(child), s) ? `(${render(child)})` : render(child));
    const list = () => args.map(render).join(', ');
    const binary = (symbol) => `${side(a, 'left')} ${symbol} ${side(b, 'right')}`;
    const unary = (child) => {
        const childOp = glslBracketOp(child);
        const prec = childOp ? needsParens('neg', childOp, 'right') : false;
        return prec || (child.type === 'op' && ['neg', 'pm'].includes(child.op)) ? `(${render(child)})` : render(child);
    };

    if (BUILTIN[op]) return `${BUILTIN[op]}(${list()})`;
    if (ES3_ONLY[op] && op !== 'round') return `${es3 ? ES3_ONLY[op] : 'mz_' + ES3_ONLY[op]}(${list()})`;
    if (RECIPROCALS[op]) return `1.0 / ${RECIPROCALS[op]}(${render(a)})`;
    if (COMPARISONS[op]) return binary(COMPARISONS[op]);
    if (isCustomFunction(op)) return `${identifier(customName(op))}(${list()})`;

    switch (op) {
        case '+': case '-': case '*': case '/':
            if (op === '*' && isMinusOneTimes(node)) return '-' + unary(b);
            if (op === '*' && b.type === 'symbol' && b.value === '°') return `radians(${render(a)})`;
            return binary(op);
        case 'mod':
            return `mod(${render(a)}, ${render(b)})`;
        case '^':
            return power(node, render, side);
        case 'neg':
            return '-' + unary(a);
        case 'pm':
            return `vec2(${render(a)}, -${unary(a)})`;
        case '±':
            return `vec2(${render(a)} + ${side(b, 'right', '+')}, ${render(a)} - ${side(b, 'right', '-')})`;
        case '!': {
            const n = smallWhole(a, 13);
            if (n <= 1) return '1.0';
            if (n) return Array.from({ length: n }, (_, i) => `${n - i}.0`).join(' * ');
            return `mz_factorial(${render(a)})`;
        }
        case 'perm': case 'comb': {
            const n = smallWhole(a, 21);
            const k = smallWhole(b, 21);
            if (n >= k) {
                if (k === 0) return '1.0';
                const top = Array.from({ length: k }, (_, i) => `${n - i}.0`).join(' * ');
                if (op === 'perm') return top;
                return `(${top}) / (${Array.from({ length: k }, (_, i) => `${i + 1}.0`).join(' * ')})`;
            }
            return `mz_${op}(${render(a)}, ${render(b)})`;
        }
        case 'root': {
            const n = integerExponent(a);
            if (n === 2) return `sqrt(${render(b)})`;
            if (n === 3) return `mz_cbrt(${render(b)})`;
            return `pow(${render(b)}, 1.0 / ${side(a, 'right', '/')})`;
        }
        case 'log': {
            if (a.type === 'symbol' && a.value === 'e') return `log(${render(b)})`;
            if (a.type === 'number' && a.value === '2') return `log2(${render(b)})`;
            return `(log(${render(b)}) / log(${render(a)}))`;
        }
        case 'loglog':
            return `log(log(${render(a)}))`;
        case 'logloglog':
            return `log(log(log(${render(a)})))`;
        case 'expm1':
            return `(exp(${render(a)}) - 1.0)`;
        case 'round': case 'fixed': {   // floats carry no digit count: fixed is round here
            const digits = integerExponent(b);
            const value = digits === 0 || digits === null ? render(a) : `${render(a)} * ${float(String(10 ** digits))}`;
            const rounded = es3 ? `round(${value})` : `mz_round(${value})`;
            return digits === 0 || digits === null ? rounded : `${rounded} / ${float(String(10 ** digits))}`;
        }
        case 'random':
            return 'mz_random()';
        case 'max': case 'min':
            return args.map(render).reduce((acc, x) => `${op}(${acc}, ${x})`);
        case 'gcd':
            return args.map(render).reduce((acc, x) => `mz_gcd(${acc}, ${x})`);
        case 'mean':
            return `((${args.map(render).join(' + ')}) / ${args.length}.0)`;
        case 'sum':
            return args.map((x, i) => side(x, i ? 'right' : 'left', '+')).join(' + ');
        case 'prod':
            return args.map((x, i) => side(x, i ? 'right' : 'left', '*')).join(' * ');
        case '&':
            return `(${render(a)} && ${render(b)})`;
        case '|':
            return `(${render(a)} || ${render(b)})`;
        case '\\xor':
            return `(${render(a)} ^^ ${render(b)})`;
        case '\\nand':
            return `!(${render(a)} && ${render(b)})`;
        case '\\nor':
            return `!(${render(a)} || ${render(b)})`;
        case '\\not':
            return '!' + unary(a);
        case '?:': {
            const isUnchanged = (n) => filter && n.type === 'symbol' && n.value === 'unchanged';
            const branch = (n, other) => (isUnchanged(n) && !isUnchanged(other) ? `mz_unchanged(${render(other)})` : render(n));
            return `(${render(a)} ? ${branch(b, args[2])} : ${branch(args[2], b)})`;
        }
        case '≈':
            return `(abs(${render(a)} - ${render(b)}) < 1e-5)`;
        case '≡':
            return binary('==');
        case 'pmod':
            return a.type === 'op' && ['≡', '='].includes(a.op)
                ? `(mod(${render(a.args[0])} - ${render(a.args[1])}, ${render(b)}) == 0.0)`
                : `mod(${render(a)}, ${render(b)})`;
        case '∈': case '∉':
            return membership(node, render);
        case '()': case '[]': case '{}': case '(]': case '[)':
            return args.length >= 2 && args.length <= 4 ? `vec${args.length}(${list()})` : `float[](${list()})`;
        case '∪':
            return `union_(${render(a)}, ${render(b)})`;
        case '∩':
            return `intersection(${render(a)}, ${render(b)})`;
        case '→':
            return `${render(a)}, ${render(b)}`;
        case '_':   // x_1 is the variable x_1; x_i indexes an array
            if (b.type === 'number' && /^\d+$/.test(b.value)) return `${render(a)}_${b.value}`;
            if (b.type === 'symbol') return `${render(a)}_${render(b)}`;
            return `${render(a)}[int(${render(b)})]`;
        case 'der':
            return `derivative(${render(a)}, ${render(b)})`;
        case 'int':
            return `integrate(${list()})`;
        case 'lim':
            return `limit(${list()})`;
        case '\\sumidx':
            return `summation(${list()})`;
        case '\\prodidx':
            return `product(${list()})`;
    }
    throw new Error(`No GLSL for '${op}'`);
}

/** `f(…)` as a whole, so it needs no brackets of its own (`sin(x) + 1` is not one call). */
function isOneCall(code) {
    const open = /^\w+\(/.exec(code)?.[0].length;
    if (!open) return false;
    let depth = 0;
    for (let i = open - 1; i < code.length; i++) {
        if (code[i] === '(') depth++;
        else if (code[i] === ')' && --depth === 0) return i === code.length - 1;
    }
    return false;
}

/** x^n: products for small whole powers, exp/exp2 for e and 2, pow() otherwise. */
function power(node, render, side) {
    const [base, exp] = node.args;
    const n = integerExponent(exp);
    const b = render(base);
    if (n === 0) return '1.0';
    if (n === 1) return b;
    if (n === 2) return `mz_sq(${b})`;
    if (n === 3) return `mz_cube(${b})`;
    if (n === 4) return `mz_sq(mz_sq(${b}))`;
    if (n !== null && n < 0 && n >= -4) {   // x^-1 is the base itself, which may need brackets: 1.0 / (3x² - 1)
        const positive = power({ args: [base, { type: 'number', value: String(-n) }] }, render, side);
        return `1.0 / ${n === -1 && base.type === 'op' && !isOneCall(positive) ? `(${positive})` : positive}`;
    }
    if (base.type === 'symbol' && base.value === 'e') return `exp(${render(exp)})`;
    if (base.type === 'number' && base.value === '2') return `exp2(${render(exp)})`;
    if (exp.type === 'op' && exp.op === '/' && exp.args[0].type === 'number' && exp.args[0].value === '1'
        && exp.args[1].type === 'number' && exp.args[1].value === '2') return `sqrt(${b})`;
    return `pow(${b}, ${render(exp)})`;
}

/** x ∈ ℝ, ℤ, ℕ: a test on the float itself. */
const NUMBER_SETS = {
    'ℝ': (v) => `(abs(${v}) < MZ_INFINITY)`,
    'ℤ': (v) => `(fract(${v}) == 0.0)`,
    'ℕ': (v) => `(fract(${v}) == 0.0 && ${v} > 0.0)`,
};

function membership(node, render) {
    const [x, set] = node.args;
    const v = render(x);
    const negate = node.op === '∉';
    if (set.type === 'symbol' && NUMBER_SETS[set.value]) {
        const test = NUMBER_SETS[set.value](v);
        return negate ? `!${test}` : test;
    }
    if (set.type === 'op' && ['()', '[]', '(]', '[)'].includes(set.op) && set.args.length === 2) {
        const [lo, hi] = set.args.map(render);
        const test = `(${v} ${set.op[0] === '[' ? '>=' : '>'} ${lo} && ${v} ${set.op[1] === ']' ? '<=' : '<'} ${hi})`;
        return negate ? `!${test}` : test;
    }
    if (set.type === 'op' && set.op === '{}') {
        const test = `(${set.args.map((item) => `${v} == ${render(item)}`).join(' || ')})`;
        return negate ? `!${test}` : test;
    }
    return `${negate ? '!' : ''}contains(${render(set)}, ${v})`;
}

/**
 * Helper functions the GLSL output may call. Paste this above main() in
 * any shader (GLSL ES 1.0 or 3.0); the compiler drops what isn't used.
 * mz_sq, mz_cube, mz_cbrt, mz_round and the hyperbolic functions have
 * vec2/vec3/vec4 overloads, so an expression over colours works too.
 */
export const GLSL_HELPERS = [
    '#define MZ_INFINITY (1.0 / 0.0)',
    ...['float', 'vec2', 'vec3', 'vec4'].flatMap((t) => [
        `${t} mz_sq(${t} x) { return x * x; }`,
        `${t} mz_cube(${t} x) { return x * x * x; }`,
        `${t} mz_cbrt(${t} x) { return sign(x) * pow(abs(x), ${t}(1.0 / 3.0)); }`,
        `${t} mz_round(${t} x) { return floor(x + 0.5); }`,
        `${t} mz_sinh(${t} x) { return (exp(x) - exp(-x)) / 2.0; }`,
        `${t} mz_cosh(${t} x) { return (exp(x) + exp(-x)) / 2.0; }`,
        `${t} mz_tanh(${t} x) { ${t} a = exp(2.0 * x); return (a - 1.0) / (a + 1.0); }`,
        `${t} mz_asinh(${t} x) { return log(x + sqrt(x * x + 1.0)); }`,
        `${t} mz_acosh(${t} x) { return log(x + sqrt(x * x - 1.0)); }`,
        `${t} mz_atanh(${t} x) { return 0.5 * log((1.0 + x) / (1.0 - x)); }`,
    ]),
    'float mz_factorial(float n) { float r = 1.0; for (int i = 2; i <= 170; i++) { if (float(i) > n) break; r *= float(i); } return r; }',
    'float mz_perm(float n, float k) { float r = 1.0; for (int i = 0; i < 170; i++) { if (float(i) >= k) break; r *= n - float(i); } return r; }',
    'float mz_comb(float n, float k) { return mz_perm(n, k) / mz_factorial(k); }',
    'float mz_gcd(float a, float b) { a = abs(a); b = abs(b); for (int i = 0; i < 64; i++) { if (b == 0.0) break; float t = mod(a, b); a = b; b = t; } return a; }',
    // A hash of gl_FragCoord would be better per pixel; this is only a placeholder that compiles.
    // random(): a new value per pixel and per call; filterShader() seeds it with t, so it changes every frame.
    'float mz_seed = 0.0;',
    'float mz_random() { mz_seed += 1.0; return fract(sin(dot(vec3(gl_FragCoord.xy, mz_seed), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }',
].join('\n');

/**
 * A complete fragment shader that applies expressions to every pixel of an
 * image — the fastest way to run a filter written in maths.
 *
 *   filterShader('(1 - r, 1 - g, 1 - b)')                  // invert
 *   filterShader({ r: 'g', g: 'r' })                       // swap channels; b, a unchanged
 *   filterShader('if gray > 0.5 then 1 else 0')            // threshold
 *   filterShader('pixel(px + 8 sin(py / 10 + t / 5), py)') // wave, animated by t
 *
 * `spec` is one expression for the whole colour — a number is grey, a
 * tuple (r, g, b) or (r, g, b, a) is the colour — or an object with any
 * of r, g, b, a, rgb, rgba, each an expression; channels not given are
 * left alone. In every expression these names are defined:
 *
 *   r g b a      the pixel's channels, 0–1        rgb     the same as a vec3
 *   gray         0.299 r + 0.587 g + 0.114 b      unchanged   the channel's own value
 *   x y          position across the image, 0–1, y downwards
 *   px py        the same in pixels               w h     width and height
 *   t            the frame index (uniform `t`: count it up each frame)
 *   pixel(px, py)                                   another pixel, as a vec4
 *   red(px, py) green(…) blue(…) alpha(…) luma(…)   one of its channels
 *   source       the picture a chain started from, as a vec3; source(px, py) any pixel of it
 *   selected     1 inside the user's selection, 0 outside (a mask picture `selection`, white = in;
 *                1 everywhere when none is given) — selection(px, py) reads it elsewhere
 *   <name>       another picture named in options.images, the same way (both vec3); red(name) … alpha(name) luma(name)
 *   zoom(s) zoom(s, cx, cy) shift(dx, dy) rotate(a) crop(x0, y0, x1, y1) tile(n) flipx() flipy()
 *                the picture read from somewhere else (GEOMETRY): put t in them and it moves;
 *                zoom(overlay, 2) does the same to another picture; width(overlay), height(overlay) its size.
 *                As the whole colour, a geometry read or a bare picture keeps its alpha — transparent
 *                outside the picture; inside a bigger expression it is a colour (black outside), and
 *                alpha(zoom(…)) says where the picture is.
 *   tohsv(c) fromhsv(c) tolinear(c) tohsl tolab tooklab toycbcr …   colour conversions (COLOUR_SPACES)
 *   blur(radius) gaussian(sigma) sharpen(amount)   the neighbourhood, as a vec3 like rgb
 *   dilate(radius) erode(radius) convolve(k × 9)    (NEIGHBOURHOOD below; blurx/blury and
 *   sobel() sobelx() sobely() laplacian() emboss()   gaussianx/gaussiany for one axis at a time)
 *
 * plus everything GLSL has (clamp, mix, smoothstep, fract, length, …) and
 * the mz_ helpers. A comparison used as a value is 1.0 or 0.0.
 *
 * Uniforms to set: `image` (sampler2D), `resolution` (vec2, pixels), `t`
 * (float). Upload the image with UNPACK_FLIP_Y_WEBGL so y runs downwards;
 * draw a full-screen triangle with filterVertexShader(). docs/filters.md
 * has a complete WebGL setup.
 *
 * Two-letter names like `px` would normally read as a product, so the
 * shader's own names (FILTER_NAMES) are protected before parsing; pass
 * `options.names` (functions) or `options.values` to protect your own.
 * Values declared in `options.uniforms` become uniforms the caller sets;
 * with `options.blend` the shader also takes `mz_opacity` and mixes its
 * result over the input by that much.
 *
 * @param {string|object} spec
 * @param {object} [options]
 * @param {100|300} [options.version] GLSL ES version; 300 for WebGL 2 only
 * @param {Record<string, string>} [options.uniforms] name → GLSL type, e.g. { cutoff: 'float', tint: 'vec3' }
 * @param {boolean} [options.blend] declare `uniform float mz_opacity` and end with `mix(input, result, mz_opacity)`
 * @param {string} [options.space] the colour space the frame holds for this pass (COLOUR_SPACES; 'srgb'
 *   normally): named pictures and `source` are converted to it as they are sampled, and `gray` is
 *   still the brightness as seen (converted back). qblur' `"space"` compiles the
 *   conversion of the frame itself into passes around this one.
 * @param {string[]|Record<string, {place?: string}>} [options.images] names of other pictures the
 *   expressions use, optionally with how each is placed (PLACES); each is a `uniform sampler2D
 *   mz_img_<name>` to bind, with `vec2 mz_size_<name>` (its pixels) and `vec4 mz_place_<name>`
 *   (zoom, x, y, angle) — and `mz_img_source` when `source` is used
 * @param {(expression: string) => object} [options.parse] how to turn each
 *   expression into a tree (the library's parse, normally)
 * @returns {string} fragment shader source
 */
/** Names every filter expression can use, protected so `px` is not `p * x`; values are never calls, so `gray (1 - r)` is a product. */
export const FILTER_VALUES = ['px', 'py', 'rgb', 'gray', 'unchanged', 'selected'];
/** Functions over the pixels around this one; the GLSL for them is added to a shader only when it uses one. */
export const NEIGHBOURHOOD = ['blur', 'blurx', 'blury', 'gaussian', 'gaussianx', 'gaussiany', 'sobel', 'sobelx', 'sobely',
    'laplacian', 'sharpen', 'emboss', 'dilate', 'erode', 'convolve'];
/** Where to read the picture from: coordinate transforms, animated by putting t in them. */
export const GEOMETRY = ['zoom', 'shift', 'rotate', 'crop', 'tile', 'flipx', 'flipy'];
/** GLSL's own functions that are not MathZetta operators: protected so `fract` is not read as \frac, `step` as s·t·e·p. */
export const GLSL_BUILTINS = ['fract', 'clamp', 'mix', 'smoothstep', 'step', 'distance', 'length', 'dot', 'normalize', 'cross', 'sign',
    'exp2', 'log2', 'inversesqrt', 'radians', 'degrees'];
/** Colour spaces a filter can work in; sRGB is what the frame holds. `to<space>(c)` and `from<space>(c)` convert a colour. */
export const COLOUR_SPACES = ['srgb', 'linear', 'hsv', 'hsl', 'lab', 'oklab', 'ycbcr'];
export const COLOUR_FUNCTIONS = COLOUR_SPACES.filter((s) => s !== 'srgb').flatMap((s) => [`to${s}`, `from${s}`]);
export const FILTER_FUNCTIONS = ['pixel', 'red', 'green', 'blue', 'alpha', 'luma', 'source', 'selection', 'width', 'height', ...NEIGHBOURHOOD, ...GEOMETRY, ...GLSL_BUILTINS, ...COLOUR_FUNCTIONS];
/** Pictures every filter has without declaring them: the frame a chain started from, and the user's selection (white = selected). */
export const IMPLICIT_PICTURES = ['source', 'selection'];

/**
 * The colour conversions, all vec3 → vec3 with sRGB (0–1) on the other
 * side, and every space's values kept in 0–1 so they survive an 8-bit
 * texture between passes: HSV/HSL hue 0–1; YCbCr chroma centred on 0.5;
 * Lab L/100 and a, b as 0.5 ± value/256; OKLab a, b as 0.5 + value.
 * src/cpu-helpers.js in qblur has the same formulas in JS.
 */
function colourGlsl() {
    return [
        '// ---- colour spaces: to<space>(c) and from<space>(c), sRGB on the other side ----',
        'vec3 tolinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }',
        'vec3 fromlinear(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }',
        'float mz_hue(vec3 c, float v, float d) { float h = v == c.r ? (c.g - c.b) / d : v == c.g ? 2.0 + (c.b - c.r) / d : 4.0 + (c.r - c.g) / d; return fract(h / 6.0); }',
        'vec3 tohsv(vec3 c) { float v = max(c.r, max(c.g, c.b)); float d = v - min(c.r, min(c.g, c.b)); return vec3(d > 0.0 ? mz_hue(c, v, d) : 0.0, v > 0.0 ? d / v : 0.0, v); }',
        'vec3 fromhsv(vec3 c) { vec3 k = abs(fract(c.x + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(k - 1.0, 0.0, 1.0), c.y); }',
        'vec3 tohsl(vec3 c) { float v = max(c.r, max(c.g, c.b)); float m = min(c.r, min(c.g, c.b)); float d = v - m; float l = (v + m) * 0.5; return vec3(d > 0.0 ? mz_hue(c, v, d) : 0.0, d > 0.0 ? d / (1.0 - abs(2.0 * l - 1.0)) : 0.0, l); }',
        'vec3 fromhsl(vec3 c) { float C = (1.0 - abs(2.0 * c.z - 1.0)) * c.y; vec3 k = abs(fract(c.x + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return (c.z - C * 0.5) + C * clamp(k - 1.0, 0.0, 1.0); }',
        'vec3 toycbcr(vec3 c) { float y = dot(c, vec3(0.299, 0.587, 0.114)); return vec3(y, 0.5 + (c.b - y) * 0.5643, 0.5 + (c.r - y) * 0.7132); }',
        'vec3 fromycbcr(vec3 c) { float cb = c.y - 0.5; float cr = c.z - 0.5; return vec3(c.x + 1.402 * cr, c.x - 0.344136 * cb - 0.714136 * cr, c.x + 1.772 * cb); }',
        'vec3 tolab(vec3 c) {',
        '    vec3 l = tolinear(c);',
        '    vec3 xyz = vec3(dot(l, vec3(0.4124564, 0.3575761, 0.1804375)), dot(l, vec3(0.2126729, 0.7151522, 0.0721750)), dot(l, vec3(0.0193339, 0.1191920, 0.9503041))) / vec3(0.95047, 1.0, 1.08883);',
        '    vec3 f = mix(7.787 * xyz + 16.0 / 116.0, mz_cbrt(xyz), step(0.008856, xyz));',
        '    return vec3((116.0 * f.y - 16.0) / 100.0, 0.5 + 500.0 * (f.x - f.y) / 256.0, 0.5 + 200.0 * (f.y - f.z) / 256.0);',
        '}',
        'vec3 fromlab(vec3 c) {',
        '    float fy = (c.x * 100.0 + 16.0) / 116.0;',
        '    vec3 f = vec3(fy + (c.y - 0.5) * 256.0 / 500.0, fy, fy - (c.z - 0.5) * 256.0 / 200.0);',
        '    vec3 xyz = mix((f - 16.0 / 116.0) / 7.787, f * f * f, step(0.206893, f)) * vec3(0.95047, 1.0, 1.08883);',
        '    vec3 l = vec3(dot(xyz, vec3(3.2404542, -1.5371385, -0.4985314)), dot(xyz, vec3(-0.9692660, 1.8760108, 0.0415560)), dot(xyz, vec3(0.0556434, -0.2040259, 1.0572252)));',
        '    return fromlinear(clamp(l, 0.0, 1.0));',
        '}',
        'vec3 tooklab(vec3 c) {',
        '    vec3 l = tolinear(c);',
        '    vec3 lms = mz_cbrt(vec3(dot(l, vec3(0.4122214708, 0.5363325363, 0.0514459929)), dot(l, vec3(0.2119034982, 0.6806995451, 0.1073969566)), dot(l, vec3(0.0883024619, 0.2817188376, 0.6299787005))));',
        '    return vec3(dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)), 0.5 + dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)), 0.5 + dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660)));',
        '}',
        'vec3 fromoklab(vec3 c) {',
        '    float A = c.y - 0.5; float B = c.z - 0.5;',
        '    vec3 lms = vec3(c.x + 0.3963377774 * A + 0.2158037573 * B, c.x - 0.1055613458 * A - 0.0638541728 * B, c.x - 0.0894841775 * A - 1.2914855480 * B);',
        '    lms = lms * lms * lms;',
        '    vec3 l = vec3(dot(lms, vec3(4.0767416621, -3.3077115913, 0.2309699292)), dot(lms, vec3(-1.2684380046, 2.6097574011, -0.3413193965)), dot(lms, vec3(-0.0041960863, -0.7034186147, 1.7076147010)));',
        '    return fromlinear(clamp(l, 0.0, 1.0));',
        '}',
        // fromhsv((h, s, v)) arrives as three arguments: a bracketed group becomes the call's arguments.
        ...COLOUR_FUNCTIONS.map((fn) => `vec3 ${fn}(float x, float y, float z) { return ${fn}(vec3(x, y, z)); }`),
    ];
}
/** How a named picture of another size is laid over the frame. */
export const PLACES = ['cover', 'fit', 'stretch', 'tile'];
const CHANNEL_FUNCTIONS = ['red', 'green', 'blue', 'alpha', 'luma'];

/**
 * `mask(px, py)` samples the picture called mask, and `luma(mask)` reads a channel of it at this pixel;
 * zoom(…) and the other geometry read the picture elsewhere. Shared with the CPU filter runner
 * (qblur), so both read pictures the same way.
 */
export function pictureCalls(node, pictures, { whole = false } = {}) {
    const out = pictureCall(node, pictures);
    if (!whole) return out;
    // The whole colour: a bare picture, or a geometry read, keeps its alpha — transparent outside the picture.
    if (out.type === 'symbol' && pictures.has(out.value)) return { ...out, value: `mz_px_${out.value}` };
    if (out.type === 'op' && out.op.startsWith(`${CUSTOM_PREFIX}mz_at_`)) return { ...out, op: out.op.replace('mz_at_', 'mz_sample_') };
    return out;
}

function pictureCall(node, pictures) {
    if (node.type !== 'op') return node;
    const args = node.args.map((arg) => pictureCall(arg, pictures));
    const name = node.op.startsWith(CUSTOM_PREFIX) ? node.op.slice(CUSTOM_PREFIX.length) : null;
    const picture = args.length && args[0].type === 'symbol' && pictures.has(args[0].value) ? args[0].value : null;
    if (name && pictures.has(name)) return { ...node, op: `${CUSTOM_PREFIX}mz_at_${name}`, args };
    if (name && CHANNEL_FUNCTIONS.includes(name) && args.length === 1 && picture) {
        return { ...node, args: [{ ...args[0], value: `mz_px_${picture}` }] };
    }
    if (name && CHANNEL_FUNCTIONS.includes(name) && args.length === 1 && args[0].type === 'op' && args[0].op.startsWith(`${CUSTOM_PREFIX}mz_at_`)) {
        return { ...node, args: [{ ...args[0], op: args[0].op.replace('mz_at_', 'mz_sample_') }] };   // alpha(zoom(2)): 0 outside the picture
    }
    if (name && GEOMETRY.includes(name)) {           // zoom(2) reads this picture elsewhere; zoom(overlay, 2) another
        const where = { type: 'op', op: `${CUSTOM_PREFIX}mz_${name}`, args: picture ? args.slice(1) : args };
        return { type: 'op', op: `${CUSTOM_PREFIX}mz_at_${picture ?? 'image'}`, args: [where] };
    }
    if ((name === 'width' || name === 'height') && args.length <= 1) {
        if (picture && picture !== 'source') return { type: 'op', op: `${CUSTOM_PREFIX}mz_${name}_${picture}`, args: [] };
        return { type: 'symbol', value: name === 'width' ? 'w' : 'h' };
    }
    return { ...node, args };
}
export const FILTER_NAMES = [...FILTER_VALUES, ...FILTER_FUNCTIONS];

/** How far the neighbourhood functions reach, in pixels: GLSL loops need fixed bounds. */
export const REACH = { square: 8, line: 24 };

/**
 * The neighbourhood functions. Colour-valued ones return a vec3 (like
 * `rgb`) and ignore alpha; the edge detectors work on brightness and
 * return a float. `gaussian(sigma)` samples a square of ±REACH.square
 * pixels, so for a wide blur chain `gaussianx(sigma)` then
 * `gaussiany(sigma)` (±REACH.line, and 2n taps instead of n²).
 */
function neighbourhoodGlsl(sample) {
    // GLSL loops need fixed bounds, so these run from -reach to +reach — but stop as soon as
    // they pass the radius actually asked for, so blur(2) costs 25 taps, not 289.
    const square = (limit, body) => `
    float mz_r = min(max(ceil(${limit}), 0.0), ${REACH.square}.0);
    for (int i = 0; i <= ${2 * REACH.square}; i++) {
        float fi = float(i) - mz_r;
        if (fi > mz_r) break;
        for (int j = 0; j <= ${2 * REACH.square}; j++) {
            float fj = float(j) - mz_r;
            if (fj > mz_r) break;
            ${body}
        }
    }`;
    const line = (axis, limit, body) => `
    float mz_r = min(max(ceil(${limit}), 0.0), ${REACH.line}.0);
    for (int i = 0; i <= ${2 * REACH.line}; i++) {
        float fi = float(i) - mz_r;
        if (fi > mz_r) break;
        float dx = ${axis === 'x' ? 'fi' : '0.0'}, dy = ${axis === 'y' ? 'fi' : '0.0'};
        ${body}
    }`;
    const blur1 = (axis) => `vec3 blur${axis}(float radius) {
    vec3 sum = vec3(0.0); float n = 0.0;${line(axis, 'radius', 'if (abs(fi) > radius) continue;\n        sum += mz_tap(dx, dy).rgb; n += 1.0;')}
    return sum / n;
}`;
    const gaussian1 = (axis) => `vec3 gaussian${axis}(float sigma) {
    if (sigma <= 0.0) return mz_tap(0.0, 0.0).rgb;
    vec3 sum = vec3(0.0); float total = 0.0;${line(axis, '3.0 * sigma', 'if (abs(fi) > 3.0 * sigma) continue;\n        float w = mz_gauss(fi * fi, sigma);\n        sum += w * mz_tap(dx, dy).rgb; total += w;')}
    return sum / total;
}`;
    return `// ---- neighbourhood: the pixels around this one (dy runs downwards, like py) ----
vec4 mz_tap(float dx, float dy) { return ${sample}(image, (gl_FragCoord.xy + vec2(dx, -dy)) / resolution); }
float mz_luma_at(float dx, float dy) { return dot(mz_tap(dx, dy).rgb, vec3(0.299, 0.587, 0.114)); }
float mz_gauss(float d2, float sigma) { return exp(-d2 / (2.0 * sigma * sigma)); }
vec3 blur(float radius) {
    vec3 sum = vec3(0.0); float n = 0.0;${square('radius', 'if (abs(fi) > radius || abs(fj) > radius) continue;\n            sum += mz_tap(fi, fj).rgb; n += 1.0;')}
    return sum / n;
}
${blur1('x')}
${blur1('y')}
vec3 gaussian(float sigma) {
    if (sigma <= 0.0) return mz_tap(0.0, 0.0).rgb;
    float limit = 3.0 * sigma;
    vec3 sum = vec3(0.0); float total = 0.0;${square('limit', 'if (abs(fi) > limit || abs(fj) > limit) continue;\n            float w = mz_gauss(fi * fi + fj * fj, sigma);\n            sum += w * mz_tap(fi, fj).rgb; total += w;')}
    return sum / total;
}
${gaussian1('x')}
${gaussian1('y')}
vec3 dilate(float radius) {
    vec3 best = vec3(0.0);${square('radius', 'if (abs(fi) > radius || abs(fj) > radius) continue;\n            best = max(best, mz_tap(fi, fj).rgb);')}
    return best;
}
vec3 erode(float radius) {
    vec3 best = vec3(1.0);${square('radius', 'if (abs(fi) > radius || abs(fj) > radius) continue;\n            best = min(best, mz_tap(fi, fj).rgb);')}
    return best;
}
float sobelx() {
    return (mz_luma_at(1.0, -1.0) + 2.0 * mz_luma_at(1.0, 0.0) + mz_luma_at(1.0, 1.0))
         - (mz_luma_at(-1.0, -1.0) + 2.0 * mz_luma_at(-1.0, 0.0) + mz_luma_at(-1.0, 1.0));
}
float sobely() {
    return (mz_luma_at(-1.0, 1.0) + 2.0 * mz_luma_at(0.0, 1.0) + mz_luma_at(1.0, 1.0))
         - (mz_luma_at(-1.0, -1.0) + 2.0 * mz_luma_at(0.0, -1.0) + mz_luma_at(1.0, -1.0));
}
float sobel() { return length(vec2(sobelx(), sobely())); }
float laplacian() { return 4.0 * mz_luma_at(0.0, 0.0) - mz_luma_at(-1.0, 0.0) - mz_luma_at(1.0, 0.0) - mz_luma_at(0.0, -1.0) - mz_luma_at(0.0, 1.0); }
float emboss() { return 0.5 + mz_luma_at(-1.0, -1.0) - mz_luma_at(1.0, 1.0); }
vec3 sharpen(float amount) {
    vec3 c = mz_tap(0.0, 0.0).rgb;
    return c + amount * (4.0 * c - mz_tap(-1.0, 0.0).rgb - mz_tap(1.0, 0.0).rgb - mz_tap(0.0, -1.0).rgb - mz_tap(0.0, 1.0).rgb);
}
vec3 convolve(float k00, float k01, float k02, float k10, float k11, float k12, float k20, float k21, float k22) {
    return k00 * mz_tap(-1.0, -1.0).rgb + k01 * mz_tap(0.0, -1.0).rgb + k02 * mz_tap(1.0, -1.0).rgb
         + k10 * mz_tap(-1.0, 0.0).rgb + k11 * mz_tap(0.0, 0.0).rgb + k12 * mz_tap(1.0, 0.0).rgb
         + k20 * mz_tap(-1.0, 1.0).rgb + k21 * mz_tap(0.0, 1.0).rgb + k22 * mz_tap(1.0, 1.0).rgb;
}`;
}

/** Neighbourhood calls allowed in one filter pass (see filterShader). */
export const MAX_NEIGHBOURHOOD = 24;

export function filterShader(spec, options = {}) {
    const es3 = options.version === 300;
    const parse = options.parse;
    if (!parse) throw new Error('filterShader needs options.parse (use the one from src/index.js)');
    const space = options.space && options.space !== 'srgb' ? options.space : null;
    if (space && !COLOUR_SPACES.includes(space)) throw new Error(`Unknown colour space "${space}": ${COLOUR_SPACES.join(', ')}`);
    const placements = Array.isArray(options.images) ? Object.fromEntries(options.images.map((n) => [n, {}])) : { ...(options.images ?? {}) };
    const images = Object.keys(placements);
    // names and types the caller passes go into the shader's text: GLSL identifiers and types only
    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
    for (const n of images) if (!ident.test(n)) throw new Error(`A picture's name must be a GLSL identifier, not ${JSON.stringify(n)}`);
    for (const [n, t] of Object.entries(options.uniforms ?? {})) {
        if (!ident.test(n) || !/^(?:float|int|bool|[biu]?vec[234]|mat[234]|sampler2D)$/.test(String(t))) throw new Error(`Uniform ${JSON.stringify(n)}: a GLSL name and type, not ${JSON.stringify(t)}`);
    }
    const pictures = new Set([...images, ...IMPLICIT_PICTURES]);
    // each neighbourhood call samples many pixels per pixel (gaussian(8): 17 × 17): past a budget a frame
    // could outlast the GPU's watchdog and lose the WebGL context
    let neighbourhood = 0;
    const budget = (tree) => {
        (function walk(n) {
            const name = n.type === 'op' ? n.op.replace(/^\\:/, '') : n.value;
            if (NEIGHBOURHOOD.includes(name) && ++neighbourhood > MAX_NEIGHBOURHOOD) {
                throw new Error(`At most ${MAX_NEIGHBOURHOOD} neighbourhood functions (blur, gaussian, sobel …) in a filter pass`);
            }
            if (n.type === 'op') n.args.forEach(walk);
        })(tree);
        return tree;
    };
    const expr = (text, whole = false) => toGlsl(pictureCalls(budget(parse(text)), pictures, { whole }), { version: options.version, filter: true });
    const channels = typeof spec === 'string' ? { rgba: spec } : spec;
    const lines = [];
    if (channels.rgba) lines.push(`    mz_keep(gray, color);`, `    color = mz_rgba(${expr(channels.rgba, true)});`);
    if (channels.rgb) lines.push(`    mz_keep(gray, color);`, `    color.rgb = mz_rgb(${expr(channels.rgb)});`);
    for (const ch of ['r', 'g', 'b', 'a']) if (channels[ch]) lines.push(`    mz_keep(color.${ch}, color);`, `    color.${ch} = mz_ch_${ch}(${expr(channels[ch])});`);
    if (!lines.length) throw new Error('filterShader: give an expression, or an object with r, g, b, a, rgb or rgba');

    const sample = es3 ? 'texture' : 'texture2D';
    const declared = Object.entries(options.uniforms ?? {}).map(([name, type]) => `uniform ${type} ${name};`);
    const usesNeighbourhood = new RegExp(`\\b(${NEIGHBOURHOOD.join('|')})\\(`).test(lines.join('\n'));
    if (!images.includes('source') && /\b(source|mz_at_source|mz_px_source|mz_sample_source)\b/.test(lines.join('\n'))) images.push('source');
    if (!images.includes('selection') && /\b(selected|selection|mz_at_selection|mz_px_selection|mz_sample_selection)\b/.test(lines.join('\n'))) images.push('selection');
    const uv = 'vec2((px + 0.5) / resolution.x, 1.0 - (py + 0.5) / resolution.y)';
    const usesGeometry = /\bmz_(zoom|shift|rotate|crop|tile|flipx|flipy|at_image|sample_image)\(/.test(lines.join('\n'));
    const usesColour = space || new RegExp(`\\b(${COLOUR_FUNCTIONS.join('|')})\\(`).test(lines.join('\n'));
    // A channel expression may come out as a number, a comparison, or a colour; a colour gives that channel.
    const channel = (ch) => [
        `float mz_ch_${ch}(float v) { return v; }`,
        `float mz_ch_${ch}(bool v) { return v ? 1.0 : 0.0; }`,
        `float mz_ch_${ch}(vec3 v) { return ${ch === 'a' ? '1.0' : `v.${ch}`}; }`,
        `float mz_ch_${ch}(vec4 v) { return v.${ch}; }`,
    ];
    return [
        es3 ? '#version 300 es' : '',
        'precision highp float;',
        'uniform sampler2D image;      // the frame',
        'uniform vec2 resolution;      // width, height in pixels',
        'uniform float t;              // frame index',
        options.blend ? 'uniform float mz_opacity;     // how much of the result shows over the input, 0–1' : '',
        ...declared,
        ...images.map((name) => `uniform sampler2D mz_img_${name};`),
        ...images.filter((name) => !IMPLICIT_PICTURES.includes(name)).flatMap((name) => [`uniform vec2 mz_size_${name};        // its own width and height`, `uniform vec4 mz_place_${name};       // zoom, x, y, angle`]),
        es3 ? 'out vec4 fragColor;' : '',
        GLSL_HELPERS,
        `vec4 pixel(float px, float py) { return ${sample}(image, vec2((px + 0.5) / resolution.x, 1.0 - (py + 0.5) / resolution.y)); }`,
        'float red(float px, float py) { return pixel(px, py).r; }',
        'float green(float px, float py) { return pixel(px, py).g; }',
        'float blue(float px, float py) { return pixel(px, py).b; }',
        'float alpha(float px, float py) { return pixel(px, py).a; }',
        'float luma(float px, float py) { return dot(pixel(px, py).rgb, vec3(0.299, 0.587, 0.114)); }',
        // The same channels of a colour: red(overlay), alpha(overlay), luma(rgb * 2)
        'float red(vec4 v) { return v.r; }', 'float red(vec3 v) { return v.r; }',
        'float green(vec4 v) { return v.g; }', 'float green(vec3 v) { return v.g; }',
        'float blue(vec4 v) { return v.b; }', 'float blue(vec3 v) { return v.b; }',
        'float alpha(vec4 v) { return v.a; }', 'float alpha(vec3 v) { return 1.0; }',
        'float luma(vec4 v) { return dot(v.rgb, vec3(0.299, 0.587, 0.114)); }', 'float luma(vec3 v) { return dot(v, vec3(0.299, 0.587, 0.114)); }',
        'vec2 mz_p() { return vec2(gl_FragCoord.x - 0.5, resolution.y - gl_FragCoord.y - 0.5); }   // (px, py)',
        ...(usesColour ? colourGlsl() : []),
        ...images.flatMap((name) => pictureGlsl(name, placements[name]?.place, sample, space)),
        ...(usesGeometry ? geometryGlsl(sample) : []),
        usesNeighbourhood ? neighbourhoodGlsl(sample) : '',
        // A colour expression may come out as a number, a comparison, or a vector; these accept any.
        ...channel('r'), ...channel('g'), ...channel('b'), ...channel('a'),
        'vec3 mz_rgb(float v) { return vec3(v); }',
        'vec3 mz_rgb(bool v) { return vec3(v ? 1.0 : 0.0); }',
        'vec3 mz_rgb(vec3 v) { return v; }',
        'vec3 mz_rgb(vec4 v) { return v.rgb; }',
        'vec4 mz_rgba(float v) { return vec4(vec3(v), 1.0); }',
        'vec4 mz_rgba(bool v) { return vec4(vec3(v ? 1.0 : 0.0), 1.0); }',
        'vec4 mz_rgba(vec3 v) { return vec4(v, 1.0); }',
        'vec4 mz_rgba(vec4 v) { return v; }',
        // `unchanged` is what the expression replaces: a float to use directly, and in
        // `if … then …` without an else, whatever type the other branch has.
        'float unchanged = 0.0;',
        'vec3 mz_unchanged_3 = vec3(0.0);',
        'vec4 mz_unchanged_4 = vec4(0.0);',
        'void mz_keep(float value, vec4 all) { unchanged = value; mz_unchanged_3 = all.rgb; mz_unchanged_4 = all; }',
        'float mz_unchanged(float like) { return unchanged; }',
        'bool mz_unchanged(bool like) { return unchanged > 0.5; }',
        'vec3 mz_unchanged(vec3 like) { return mz_unchanged_3; }',
        'vec4 mz_unchanged(vec4 like) { return mz_unchanged_4; }',
        'void main() {',
        '    float w = resolution.x;',
        '    float h = resolution.y;',
        '    float px = gl_FragCoord.x - 0.5;',
        '    float py = h - gl_FragCoord.y - 0.5;',
        '    float x = gl_FragCoord.x / w;',
        '    float y = 1.0 - gl_FragCoord.y / h;',
        `    vec4 c = ${sample}(image, gl_FragCoord.xy / resolution);`,
        '    float r = c.r, g = c.g, b = c.b, a = c.a;',
        '    vec3 rgb = c.rgb;',
        `    float gray = dot(${space ? `from${space}(rgb)` : 'rgb'}, vec3(0.299, 0.587, 0.114));   // the brightness as seen`,
        '    vec4 color = c;',
        '    mz_seed = t;',
        ...images.flatMap((name) => [`    vec4 mz_px_${name} = mz_sample_${name}(mz_p());`, `    vec3 ${name} = mz_px_${name}.rgb;`]),
        images.includes('selection') ? '    float selected = mz_px_selection.r;      // 1 inside the selection, 0 outside; 1 everywhere without one' : '',
        ...lines,
        options.blend ? '    color = mix(c, color, mz_opacity);' : '',
        `    ${es3 ? 'fragColor' : 'gl_FragColor'} = color;`,
        '}',
    ].filter((line) => line !== '').join('\n');
}

/**
 * Reading a named picture: `mz_sample_<name>(p)` is its colour and alpha
 * at frame pixel p, placed over the frame by its own size (`cover` fills
 * keeping the aspect ratio, `fit` shows all of it, `stretch` ignores the
 * ratio, `tile` repeats it at its own size), then zoomed about and
 * centred at (x, y) and turned by angle — transparent outside. The
 * picture a chain started from (`source`) is the frame's size already.
 */
function pictureGlsl(name, place, sample, space = null) {
    // In a colour space, a picture is converted as it is read, so the expression sees one space everywhere (a selection is a mask, not a colour).
    const converted = space && name !== 'selection';
    const convert = converted ? [`vec4 mz_sample_${name}(vec2 p) { vec4 v = mz_raw_${name}(p); v.rgb = to${space}(v.rgb); return v; }`] : [];
    const raw = converted ? `mz_raw_${name}` : `mz_sample_${name}`;
    if (IMPLICIT_PICTURES.includes(name)) {                         // the frame's size: no placement
        return [
            `vec4 ${raw}(vec2 p) { vec2 q = p + 0.5; return ${sample}(mz_img_${name}, vec2(q.x / resolution.x, 1.0 - q.y / resolution.y)); }`,
            ...convert,
            `vec3 mz_at_${name}(vec2 p) { return mz_sample_${name}(p).rgb; }`,
            `vec3 mz_at_${name}(float px, float py) { return mz_at_${name}(vec2(px, py)); }`,
        ];
    }
    const scale = {
        cover: 'vec2(max(resolution.x / size.x, resolution.y / size.y))',
        fit: 'vec2(min(resolution.x / size.x, resolution.y / size.y))',
        stretch: 'resolution / size',
        tile: 'vec2(1.0)',
    }[place ?? 'cover'];
    const outside = place === 'tile' ? 'q = mod(q, size);' : 'if (q.x < 0.0 || q.y < 0.0 || q.x > size.x || q.y > size.y) return vec4(0.0);';
    return [
        `vec4 ${raw}(vec2 p) {`,
        `    vec2 size = mz_size_${name};`,
        `    vec2 scale = ${scale} * mz_place_${name}.x;`,
        `    vec2 d = p + 0.5 - mz_place_${name}.yz * resolution;`,
        `    float co = cos(mz_place_${name}.w), si = sin(mz_place_${name}.w);`,
        '    d = vec2(co * d.x + si * d.y, co * d.y - si * d.x);',
        '    vec2 q = d / scale + size * 0.5;',
        `    ${outside}`,
        `    return ${sample}(mz_img_${name}, vec2(q.x / size.x, 1.0 - q.y / size.y));`,
        '}',
        ...convert,
        `vec3 mz_at_${name}(vec2 p) { return mz_sample_${name}(p).rgb; }`,
        `vec3 mz_at_${name}(float px, float py) { return mz_at_${name}(vec2(px, py)); }`,
        `float mz_width_${name}() { return mz_size_${name}.x; }`,
        `float mz_height_${name}() { return mz_size_${name}.y; }`,
    ];
}

/** Where to read the picture from, for this pixel: each transform is about the frame; a positive angle turns clockwise. */
function geometryGlsl(sample) {
    return [
        '// ---- geometry: where to read the picture from, for this pixel ----',
        'vec2 mz_zoom(float s, float cx, float cy) { vec2 c = vec2(cx, cy) * resolution - 0.5; return c + (mz_p() - c) / s; }',
        'vec2 mz_zoom(float s) { return mz_zoom(s, 0.5, 0.5); }',
        'vec2 mz_shift(float dx, float dy) { return mod(mz_p() - vec2(dx, dy) + 0.5, resolution) - 0.5; }   // wraps around',
        'vec2 mz_rotate(float a, float cx, float cy) { vec2 c = vec2(cx, cy) * resolution - 0.5; vec2 d = mz_p() - c; float co = cos(a), si = sin(a); return c + vec2(co * d.x + si * d.y, co * d.y - si * d.x); }',
        'vec2 mz_rotate(float a) { return mz_rotate(a, 0.5, 0.5); }',
        'vec2 mz_crop(float x0, float y0, float x1, float y1) { vec2 f = (mz_p() + 0.5) / resolution; return (vec2(x0, y0) + vec2(x1 - x0, y1 - y0) * f) * resolution - 0.5; }',
        'vec2 mz_tile(float nx, float ny) { return mod((mz_p() + 0.5) * vec2(nx, ny), resolution) - 0.5; }',
        'vec2 mz_tile(float n) { return mz_tile(n, n); }',
        'vec2 mz_flipx() { vec2 p = mz_p(); return vec2(resolution.x - 1.0 - p.x, p.y); }',
        'vec2 mz_flipy() { vec2 p = mz_p(); return vec2(p.x, resolution.y - 1.0 - p.y); }',
        `vec4 mz_sample_image(vec2 p) { vec2 q = p + 0.5; if (q.x < 0.0 || q.y < 0.0 || q.x > resolution.x || q.y > resolution.y) return vec4(0.0); return ${sample}(image, vec2(q.x / resolution.x, 1.0 - q.y / resolution.y)); }`,
        'vec3 mz_at_image(vec2 p) { return mz_sample_image(p).rgb; }',
    ];
}

/** The vertex shader to pair with filterShader(): draws the triangle the caller supplies. */
export function filterVertexShader(options = {}) {
    return options.version === 300
        ? '#version 300 es\nin vec2 position;\nvoid main() { gl_Position = vec4(position, 0.0, 1.0); }'
        : 'attribute vec2 position;\nvoid main() { gl_Position = vec4(position, 0.0, 1.0); }';
}

// Lookup tables are keyed by what people type: with no prototype, `constructor` or `toString`
// finds nothing rather than Object's own (tested in test/unit/parse.test.js).
for (const table of [CONSTANTS, GREEK_NAMES, BUILTIN, ES3_ONLY, RECIPROCALS, COMPARISONS, NUMBER_SETS, REACH]) Object.setPrototypeOf(table, null);
