/**
 * 'inlinemath/lite-calc' — the lite build with MathZetta's calculator: `{{…}}` blocks are worked out
 * ('3+4={{3+4}}' draws 3 + 4 = 7). The same as `inlinemath/lite` plus `import 'mathzetta/calculate'`;
 * this entry exists for the bundles in dist/, which carry their own copy of MathZetta.
 */
import { calculateBlock } from './calculator.js';
import { toHTML as draw, treeOf as tree } from './draw.js';

export { layout, DEFAULTS } from './layout.js';
export { select, numberTree } from './select.js';
export { calculateBlock, calculate } from './calculator.js';

/** toHTML with `{{…}}` blocks calculated (`options.scope` gives their variables values). */
export const toHTML = (input, options = {}) => draw(input, { ...options, blocks: options.blocks ?? calculateBlock });
export const treeOf = (input, options = {}) => tree(input, { ...options, blocks: options.blocks ?? calculateBlock });
