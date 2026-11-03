/** 'mathzetta/mathml' — MathML output; each node's element has id="mz-<index>". */

import { treeOf, isEmpty } from './input.js';
import { toMathml } from './render/mathml.js';

/** A copy of the tree without node ids: MathML to paste elsewhere, without id="mz-…". */
function withoutIds(node) {
    const { id, ...rest } = node;
    return rest.type === 'op' ? { ...rest, args: rest.args.map(withoutIds) } : rest;
}

/**
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {{ ids?: boolean }} [options] ids: false leaves out the id="mz-<index>" attributes
 */
export function toMathML(input, options = {}) {
    if (isEmpty(input)) return '<math><mi>empty</mi></math>';
    const tree = treeOf(input);
    return toMathml(options.ids === false ? withoutIds(tree) : tree);
}
