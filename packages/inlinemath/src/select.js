/**
 * Picking out parts of an expression.
 *
 * A target can be written several ways; select() turns any of them into
 * the matching tree nodes:
 *
 *   4                 the node with id 4 (MathZetta's postfix index)
 *   'x^2'             every part that is x² — written like any other input
 *   { path: [0, 1] }  child 1 of child 0 of the root — the same paths @mathzetta/cas reports
 *   (node) => bool    any test
 *   [ …targets ]      all of them
 *
 * Matching by expression compares postfix, so 'x^2 + 1' finds x² + 1 only
 * where it is a part of the tree on its own: in 3 + x² + 1, which reads
 * (3 + x²) + 1, it is not.
 */

import { parseTree, toPostfix, walk, operator, VARIADIC } from './mathzetta.js';

/** A subtree's postfix as one string: two parts look the same exactly when these match. */
export const signature = (node) => toPostfix(node).join(' ');

/**
 * @param {object} tree
 * @param {*} target see above
 * @returns {object[]} nodes, in tree order, without repeats
 */
export function select(tree, target) {
    const found = new Set();
    collect(tree, target, found);
    const out = [];
    walk(tree, (n) => { if (found.has(n)) out.push(n); });
    return out;
}

function collect(tree, target, found) {
    if (target === null || target === undefined) return;
    if (Array.isArray(target)) {
        target.forEach((t) => collect(tree, t, found));
        return;
    }
    if (typeof target === 'number') {
        walk(tree, (n) => { if (n.id === target) found.add(n); });
        return;
    }
    if (typeof target === 'function') {
        walk(tree, (n, parent) => { if (target(n, parent)) found.add(n); });
        return;
    }
    if (typeof target === 'string') {
        const sig = signature(parseTree(target));
        walk(tree, (n) => { if (signature(n) === sig) found.add(n); });
        return;
    }
    if (target.path) {
        const n = nodeAt(tree, target.path);
        if (n) found.add(n);
        return;
    }
    if (target.type) {
        const sig = signature(target);
        walk(tree, (n) => { if (n === target || signature(n) === sig) found.add(n); });
    }
}

/** The node at a path of child indices, or null. */
export function nodeAt(tree, path) {
    let n = tree;
    for (const i of path) {
        if (n.type !== 'op' || !n.args[i]) return null;
        n = n.args[i];
    }
    return n;
}

/** The path of child indices to the node with this id, or null. */
export function pathOf(tree, id) {
    const path = [];
    const visit = (n) => {
        if (n.id === id) return true;
        if (n.type !== 'op') return false;
        for (let i = 0; i < n.args.length; i++) {
            path.push(i);
            if (visit(n.args[i])) return true;
            path.pop();
        }
        return false;
    };
    return visit(tree) ? path : null;
}

/**
 * Give every node of a hand-built tree the id MathZetta would: its index
 * in the postfix (variadic operators count their argument-count token).
 * Changes the tree in place and returns it.
 */
export function numberTree(tree) {
    let i = 0;
    const visit = (n) => {
        if (n.type === 'op') {
            n.args.forEach(visit);
            if (operator(n.op)?.arity === VARIADIC) i++;
        }
        n.id = i++;
    };
    visit(tree);
    return tree;
}
