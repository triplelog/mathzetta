/**
 * Input → tree → HTML string, with no calculator: the drawing both builds share (html.js adds the
 * calculator for the full build; lite.js uses this as it is). No DOM needed, so this runs in Node too.
 */

import { parseTree, fromPostfix, walk } from './mathzetta.js';
import { layout } from './layout.js';
import { select, numberTree } from './select.js';

/**
 * Anything MathZetta reads → a tree with node ids. `{{...}}` blocks are filled by `options.blocks`
 * (with `options.scope`), else by whatever handler MathZetta has (the calculator once
 * 'mathzetta/calculate' is loaded), else drawn as a group.
 * @param {string|string[]|object} input expression text, standard postfix, or a tree
 * @param {object} [options] { blocks, scope }
 */
export function treeOf(input, options = {}) {
    const { blocks } = options;
    if (typeof input === 'string') return parseTree(input, blocks ? { blocks: (text) => blocks(text, options.scope) } : {});
    if (Array.isArray(input)) return fromPostfix(input);
    if (input && typeof input === 'object' && input.type) {
        if (input.id !== undefined) return input;
        // a tree made by hand: values as MathZetta writes them, text ({ type: 'number', value: 3 } is '3')
        const tree = structuredClone(input);
        walk(tree, (n) => { if (n.type !== 'op' && n.value !== undefined) n.value = String(n.value); });
        return numberTree(tree);
    }
    throw new Error('Inline Math needs an expression, standard postfix or a tree');
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
    const tree = treeOf(input, options);
    return layout(tree, layoutOptions(tree, options)).html;
}

/** Turn the friendly options (colors, highlight) into layout's attributes and style hooks. */
export function layoutOptions(tree, options) {
    const { colors, highlight, scope, blocks, ...rest } = options;
    const styles = new Map();
    for (const [target, colour] of pairs(colors)) {
        if (!isColour(colour)) continue;   // one CSS colour value, nothing more: no `;`, no url(…)
        for (const n of select(tree, target)) styles.set(n, `color:${colour}`);
    }
    const marked = new Set(highlight === undefined ? [] : select(tree, highlight));
    if (!styles.size && !marked.size) return rest;
    const prefix = rest.prefix || 'mv';
    return {
        ...rest,
        style: (n) => [styles.get(n), rest.style && rest.style(n)].filter(Boolean).join(';'),
        attributes: (n) => {
            const extra = { ...(rest.attributes ? rest.attributes(n) : {}) };
            if (marked.has(n)) extra.class = [extra.class, `${prefix}-hl`].filter(Boolean).join(' ');
            return extra;
        },
    };
}

/** { 'x^2': 'red', 3: 'blue' } or [[target, colour]] → [[target, colour]]; numeric keys become ids. */
/** A colour a style attribute can hold on its own: red, #06c, rgb(0 102 204 / 50%), var(--accent). */
function isColour(value) {
    return typeof value === 'string' && /^[#\w\s.,%()/+-]+$/.test(value) && !/url\s*\(|expression/i.test(value);
}

function pairs(colors) {
    if (!colors) return [];
    if (Array.isArray(colors)) return colors;
    return Object.entries(colors).map(([k, v]) => [/^\d+$/.test(k) ? Number(k) : k, v]);
}
