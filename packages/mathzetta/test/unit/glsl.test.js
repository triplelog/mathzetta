/**
 * GLSL: toGLSL's floats, powers, names and conditions, and filterShader — channels, neighborhoods, pictures,
 * color spaces, the selection and its distance.
 */
import { suite, test, eq, throws } from '../harness.js';
import { GLSL_HELPERS, filterShader, filterVertexShader, toGLSL } from '../../src/all.js';

/** The text holds this part. */
const has = (text, part) => { if (!text.includes(part)) throw new Error(`missing ${JSON.stringify(part)}`); };

suite('GLSL: numbers, powers, functions, logic, vectors, helpers', () => {
    test('numbers are floats', () => {
        eq(toGLSL('1/2'), '1.0 / 2.0');
        eq(toGLSL('.5x + 3'), '0.5 * x + 3.0');
        eq(toGLSL('-3'), '-3.0');
    });
    test('powers avoid pow() where it is undefined or slow', () => {
        eq(toGLSL('(r-0.5)^2'), 'mz_sq(r - 0.5)');
        eq(toGLSL('x^3'), 'mz_cube(x)');
        eq(toGLSL('x^-1'), '1.0 / x');
        eq(toGLSL('x^-2'), '1.0 / mz_sq(x)');
        eq(toGLSL('e^x'), 'exp(x)');
        eq(toGLSL('2^x'), 'exp2(x)');
        eq(toGLSL('x^{1/2}'), 'sqrt(x)');
        eq(toGLSL('x^y'), 'pow(x, y)');
        eq(toGLSL('\\sqrt[3]{x}'), 'mz_cbrt(x)');
    });
    test('functions, constants and degrees', () => {
        eq(toGLSL('\\ln x + \\log_2 x'), 'log(x) + log2(x)');
        eq(toGLSL('sin(2\\pi x)'), 'sin(2.0 * 3.141592653589793 * x)');
        eq(toGLSL('30°'), 'radians(30.0)');
        eq(toGLSL('atan2(y, x)'), 'atan(y, x)');
        eq(toGLSL('a mod b'), 'mod(a, b)');
        eq(toGLSL('round(x)'), 'mz_round(x)');
        eq(toGLSL('round(x)', { version: 300 }), 'mz_round(x)', "GLSL's round() may take a half either way; mz_round takes it away from zero");
        eq(toGLSL('sinh(x)', { version: 300 }), 'sinh(x)');
    });
    test('logic and conditions', () => {
        eq(toGLSL('x < 0.5 ? 0 : 1'), '(x < 0.5 ? 0.0 : 1.0)');
        eq(toGLSL('a & b | c'), 'mz_either(mz_both(a, b), c)');   // numbers: && and || take bools only
        eq(toGLSL('x ∈ [0, 1]'), '(x >= 0.0 && x <= 1.0)');
        eq(toGLSL('x ∈ {1, 2}'), '(x == 1.0 || x == 2.0)');
    });
    test('tuples are vectors', () => {
        eq(toGLSL('(r, g, b)'), 'vec3(r, g, b)');
        eq(toGLSL('±x'), 'vec2(x, -x)');
    });
    test('the helpers define what the output calls', () => {
        for (const fn of ['mz_sq', 'mz_cube', 'mz_cbrt', 'mz_round', 'mz_sinh', 'mz_asinh', 'mz_factorial', 'mz_gcd', 'MZ_INFINITY']) {
            eq(GLSL_HELPERS.includes(fn), true, fn);
        }
        eq(GLSL_HELPERS.includes('vec3 mz_sq(vec3 x)'), true);
    });
});

suite('GLSL: names and sets', () => {
    test('subscripts and Greek letters are identifiers', () => {
        eq(toGLSL('x_1 + x_2'), 'x_1 + x_2');
        eq(toGLSL('x_i'), 'x_i');
        eq(toGLSL('\\theta + \\Delta x'), 'theta + delta_x');
    });
    test('number sets are tests on the float', () => {
        eq(toGLSL('x ∈ \\mathbb{Z}'), '(fract(x) == 0.0)');
        eq(toGLSL('x \\notin \\mathbb{N}'), '!(fract(x) == 0.0 && x > 0.0)');
    });
});

suite('GLSL: no text', () => {
    test('GLSL has no text: a quoted string is refused, not written into the shader', () => {
        throws(() => toGLSL('"abc" + x'), /No GLSL for text/);
        throws(() => toGLSL("'\n#pragma x\n'"), /No GLSL for text/);
    });
});

suite('filter shaders', () => {
    const lacks = (text, part) => { if (text.includes(part)) throw new Error(`unexpected ${JSON.stringify(part)}`); };
    test('one expression sets the whole color', () => {
        const shader = filterShader('(1 - r, 1 - g, 1 - b)');
        has(shader, 'uniform sampler2D image;');
        has(shader, 'uniform float t;');
        has(shader, 'color = mz_rgba(vec3(1.0 - r, 1.0 - g, 1.0 - b));');
        has(shader, 'gl_FragColor = color;');
    });
    test('channels are set separately, the rest unchanged', () => {
        const shader = filterShader({ r: 'if x < 0.5 then 1 - r', b: 'g' });
        has(shader, 'mz_keep(color.r, color);\n    color.r = mz_ch_r((x < 0.5 ? 1.0 - r : mz_unchanged(1.0 - r)));');
        has(filterShader('if gray > 0.5 then (1, 0, 0)'), 'mz_rgba((gray > 0.5 ? vec3(1.0, 0.0, 0.0) : mz_unchanged(vec3(1.0, 0.0, 0.0))))');
        has(filterShader('unchanged * 0.5'), 'mz_rgba(unchanged * 0.5)');
        has(shader, 'color.b = mz_ch_b(g);');
        if (shader.includes('color.g =')) throw new Error('g should be untouched');
    });
    test('px, py and the other shader names are words, not products', () => {
        has(filterShader('pixel(px + 8 sin(py / 10 + t / 5), py)'), 'mz_rgba(pixel(px + 8.0 * sin(py / 10.0 + t / 5.0), py))');
        has(filterShader('gray > 0.5'), 'mz_rgba(gray > 0.5)');
        has(filterShader('luma(px, py)', { names: ['luma'] }), 'luma(px, py)');
    });
    test('GLSL ES 3.0 uses texture() and an out variable', () => {
        const shader = filterShader('gray', { version: 300 });
        has(shader, '#version 300 es');
        has(shader, 'texture(image');
        has(shader, 'fragColor = color;');
        has(filterVertexShader({ version: 300 }), 'in vec2 position;');
        has(filterVertexShader(), 'attribute vec2 position;');
    });
    test('neighborhood functions are added only when used', () => {
        const shader = filterShader('rgb + 1.5 (rgb - gaussian(2))');
        has(shader, 'vec3 gaussian(float sigma)');
        has(shader, 'mz_rgba(rgb + 1.5 * (rgb - gaussian(2.0)))');
        has(filterShader('if sobel() > 0.3 then 1 else 0'), '(sobel() > 0.3 ? 1.0 : 0.0)');
        has(filterShader('convolve(0, -1, 0, -1, 5, -1, 0, -1, 0)'), 'convolve(0.0, -1.0, 0.0, -1.0, 5.0, -1.0, 0.0, -1.0, 0.0)');
        has(filterShader({ r: 'gaussian(4)' }), 'color.r = mz_ch_r(gaussian(4.0));');     // a color gives that channel
        lacks(filterShader('gray'), 'mz_tap');
        lacks(filterShader('blurry'), 'mz_tap');
    });
    test('an empty spec is an error', () => {
        throws(() => filterShader({}), /give an expression, or an object with r, g, b/);
    });
});

const color = (shader) => shader.split('\n').find((l) => l.includes('color = mz_rgba(')).trim();

suite('filter pictures: alpha outside, built-in names', () => {
    test('a geometry read as the whole color keeps its alpha', () => {
        const shader = filterShader('zoom(0.5)');
        eq(color(shader), 'color = mz_rgba(mz_sample_image(mz_zoom(0.5)));');
        has(shader, 'vec4 mz_sample_image(vec2 p)');
        eq(color(filterShader('zoom(inset, 0.5)', { images: ['inset'] })), 'color = mz_rgba(mz_sample_inset(mz_zoom(0.5)));');
    });
    test('…but inside an expression it is a color, with alpha() saying where the picture is', () => {
        eq(color(filterShader('mix(rgb, zoom(0.5), 0.5)')), 'color = mz_rgba(mix(rgb, mz_at_image(mz_zoom(0.5)), 0.5));');
        eq(color(filterShader('mix(rgb, zoom(0.5), alpha(zoom(0.5)))')), 'color = mz_rgba(mix(rgb, mz_at_image(mz_zoom(0.5)), alpha(mz_sample_image(mz_zoom(0.5)))));');
        eq(color(filterShader('alpha(rotate(inset, 1))', { images: ['inset'] })), 'color = mz_rgba(alpha(mz_sample_inset(mz_rotate(1.0))));');
    });
    test('a bare picture as the whole color keeps its alpha; as a channel it does not', () => {
        eq(color(filterShader('inset', { images: ['inset'] })), 'color = mz_rgba(mz_px_inset);');
        has(filterShader({ r: 'inset' }, { images: ['inset'] }), 'color.r = mz_ch_r(inset);');
    });
    test("GLSL's own functions are calls, not letters", () => {
        eq(color(filterShader('fract(x * 4)')), 'color = mz_rgba(fract(x * 4.0));');
        eq(color(filterShader('step(0.5, gray)')), 'color = mz_rgba(step(0.5, gray));');
    });
});

suite('filter color spaces', () => {
    test('conversion functions are calls, included when used', () => {
        const shader = filterShader('fromhsv((fract(red(tohsv(rgb)) + 0.1), green(tohsv(rgb)), blue(tohsv(rgb))))');
        has(shader, 'vec3 tohsv(vec3 c)');
        has(shader, 'mz_rgba(fromhsv(fract(red(tohsv(rgb)) + 0.1), green(tohsv(rgb)), blue(tohsv(rgb))))');   // a bracketed group is the call's arguments
        has(shader, 'vec3 fromhsv(float x, float y, float z)');
        if (filterShader('gray').includes('vec3 tohsv')) throw new Error('color block included when unused');
    });
    test('in a space, pictures are converted as sampled and gray is still what is seen', () => {
        const shader = filterShader('mix(rgb, overlay, luma(mask))', { images: ['overlay', 'mask'], space: 'hsv' });
        has(shader, 'vec4 mz_sample_overlay(vec2 p) { vec4 v = mz_raw_overlay(p); v.rgb = tohsv(v.rgb); return v; }');
        has(shader, 'float gray = dot(fromhsv(rgb), vec3(0.299, 0.587, 0.114));');
        has(filterShader('source', { space: 'lab' }), 'vec4 mz_sample_source(vec2 p) { vec4 v = mz_raw_source(p); v.rgb = tolab(v.rgb); return v; }');
        throws(() => filterShader('gray', { space: 'cmyk' }), /Unknown color space "cmyk"/);
    });
});

suite('filter selection', () => {
    test('selected is the selection mask, declared only when used', () => {
        const shader = filterShader('mix(source, rgb, selected)');
        has(shader, 'uniform sampler2D mz_img_selection;');
        has(shader, 'float selected = mz_px_selection.r;');
        has(shader, 'mz_rgba(mix(source, rgb, selected))');
        if (filterShader('gray').includes('mz_img_selection')) throw new Error('declared when unused');
        has(filterShader('luma(selection(px + 2, py))'), 'luma(mz_sample_selection(px + 2.0, py))');   // a channel of a read keeps its alpha, as with zoom()
    });
    test('a selection is not converted into a color space', () => {
        const shader = filterShader('(r, g, selected)', { space: 'hsv' });
        has(shader, 'vec4 mz_sample_selection(vec2 p) { vec2 q = p + 0.5; return texture2D(mz_img_selection');
        if (shader.includes('mz_raw_selection')) throw new Error('selection converted');
    });
    test('away is the distance from the selection, from the picture mz_img_away, declared only when used', () => {
        const shader = filterShader('mix((1, 0.8, 0.3), rgb, smoothstep(0, 40, away))', { space: 'hsv' });
        has(shader, 'uniform sampler2D mz_img_away;');
        has(shader, 'float mz_away(vec4 v) { return v.r > 0.0 ? 255.0 * (1.0 - v.r) : 1020.0 * (1.0 - v.g); }');
        has(shader, 'float away = mz_away(mz_px_away);');
        has(shader, 'smoothstep(0.0, 40.0, away)');
        for (const no of ['mz_raw_away', 'mz_size_away', 'vec3 away']) if (shader.includes(no)) throw new Error(`${no} in the shader`);
        if (filterShader('gray').includes('mz_img_away')) throw new Error('declared when unused');
    });
});
