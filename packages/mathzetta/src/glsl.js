/**
 * 'mathzetta/glsl' — a GLSL expression (floats throughout), and complete
 * fragment shaders that apply expressions to an image's pixels. The
 * shareable filter format and WebGL runner built on this live in the
 * qblur package.
 */

import { parseTree } from './parse/index.js';
import { treeOf, isEmpty } from './input.js';
import { toGlsl, FILTER_VALUES, FILTER_FUNCTIONS, filterShader as shader } from './render/glsl.js';

export {
    GLSL_HELPERS, filterVertexShader, FILTER_VALUES, FILTER_FUNCTIONS, FILTER_NAMES, NEIGHBORHOOD, GEOMETRY, PLACES, REACH,
    pictureCalls as filterPictureCalls,
    COLOR_SPACES, COLOR_FUNCTIONS, IMPLICIT_PICTURES,
} from './render/glsl.js';
// their names until 1.1, kept so code written for them still runs: the same arrays (deprecated)
export { NEIGHBORHOOD as NEIGHBOURHOOD, COLOR_SPACES as COLOUR_SPACES, COLOR_FUNCTIONS as COLOUR_FUNCTIONS } from './render/glsl.js';

/**
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {object} [options] { version: 100 | 300 }
 */
export function toGLSL(input, options = {}) {
    if (isEmpty(input)) return '0.0';
    return toGlsl(treeOf(input), options);
}

/**
 * A complete fragment shader applying expressions to every pixel
 * (`r g b a x y px py t`, `if … then … else`); see render/glsl.js.
 * @param {string|object} spec one expression, or { r, g, b, a, rgb, rgba }
 * @param {object} [options] { version, names, values, uniforms, blend, images }
 */
export function filterShader(spec, options = {}) {
    const imageNames = Array.isArray(options.images) ? options.images : Object.keys(options.images ?? {});
    const names = [...FILTER_FUNCTIONS, ...(options.names ?? []), ...imageNames];
    const values = [...FILTER_VALUES, ...(options.values ?? [])];
    return shader(spec, { ...options, parse: (text) => parseTree(text, { ...options, names, values }) });
}
