/**
 * Input → tree → HTML string. No DOM needed, so this runs in Node too. The full build: `{{...}}`
 * blocks are calculated (draw.js is the same without the calculator).
 */

import { calculateBlock } from './calculator.js';
import * as draw from './draw.js';

export { layoutOptions } from './draw.js';

/**
 * Anything MathZetta reads → a tree with node ids. `{{...}}` blocks in text
 * are calculated first: '3+4={{3+4}}' draws 3 + 4 = 7.
 * @param {string|string[]|object} input expression text, standard postfix, or a tree
 * @param {object} [options] { scope } variable values for `{{...}}` blocks;
 *   { blocks } another handler for them (casBlocks() from 'inlinemath/cas' simplifies, solves …)
 */
export function treeOf(input, options = {}) {
    return draw.treeOf(input, { ...options, blocks: options.blocks ?? calculateBlock });
}

/**
 * @param {string|string[]|object} input
 * @param {object} [options] layout options (see DEFAULTS in layout.js) plus:
 * @param {object|Array} [options.colors]    { 'x^2': 'red', 3: '#06c' } or [[target, colour], …]
 * @param {*} [options.highlight]            target(s) to mark with the mv-hl class
 * @param {object} [options.scope]           variable values for `{{...}}` blocks
 * @returns {string}
 */
export function toHTML(input, options = {}) {
    return draw.toHTML(input, { ...options, blocks: options.blocks ?? calculateBlock });
}
