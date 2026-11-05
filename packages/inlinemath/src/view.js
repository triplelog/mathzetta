/**
 * A live expression on the page: draw it, point at parts of it, react to
 * clicks, step it to the next expression with the unchanged parts gliding
 * into place.
 *
 *   const view = render(element, 'x^2 + 2x');
 *   view.highlight('2x');                     // or an id, path, key, test
 *   view.color('x^2', 'crimson');
 *   view.on('click', ({ node }) => …);
 *   view.set('2x + 2', { animate: true });    // next step (instant for readers who ask for reduced motion)
 *   view.segments()                           // [{ text, id }] spoken pieces
 */

import { toSpeechSegments } from './mathzetta.js';
import { treeOf, layoutOptions } from './html.js';
import { layout } from './layout.js';
import { select, signature, pathOf } from './select.js';

export class View {
    /**
     * @param {Element} element where to draw (its contents are replaced)
     * @param {string|string[]|object} input
     * @param {object} [options] as for toHTML
     */
    constructor(element, input, options = {}) {
        this.element = element;
        this.options = options;
        this.p = options.prefix || 'mv';
        this.handlers = [];
        this.set(input);
    }

    /**
     * Show a new expression. With { animate: true }, parts that appear in
     * both move from their old place to their new one, and new parts fade in —
     * unless the reader's system asks for reduced motion, when the new step
     * simply appears. { animate: 'always' } animates regardless (a page whose
     * point is the motion, started by the reader).
     */
    set(input, { animate = false, duration = 600, easing = 'ease-in-out' } = {}) {
        const before = shouldAnimate(animate) && this.tree ? this.snapshot() : null;
        this.tree = treeOf(input, this.options);
        this.element.innerHTML = layout(this.tree, layoutOptions(this.tree, this.options)).html;
        this.root = this.element.firstElementChild;
        if (this.handlers.length) this.root.classList.add(`${this.p}-clickable`);
        if (before) this.morph(before, { duration, easing });
        return this;
    }

    /** The nodes a target picks out (see select.js for the ways to write one). */
    nodes(target) {
        return select(this.tree, target);
    }

    /** The elements drawing those nodes. */
    elements(target) {
        return this.nodes(target).map((n) => this.elementOf(n)).filter(Boolean);
    }

    elementOf(node) {
        return node.id === undefined ? null : this.root.querySelector(`[data-node="${node.id}"]`);
    }

    /** Add a class (mv-hl by default) to the target's elements. */
    highlight(target, className = `${this.p}-hl`) {
        this.elements(target).forEach((e) => e.classList.add(className));
        return this;
    }

    /** Remove a highlight class, from the target or everywhere. */
    unhighlight(target = null, className = `${this.p}-hl`) {
        const list = target === null ? this.root.querySelectorAll(`.${className}`) : this.elements(target);
        list.forEach((e) => e.classList.remove(className));
        return this;
    }

    /** Colour parts; pass null to clear. */
    color(target, colour) {
        this.elements(target).forEach((e) => { e.style.color = colour || ''; });
        return this;
    }

    /**
     * React to events on parts of the expression. `fn` gets
     * { node, id, path, element, event } for the innermost node under the pointer.
     */
    on(type, fn) {
        const listener = (event) => {
            const element = event.target.closest?.('[data-node]');
            if (!element || !this.root.contains(element)) return;
            const id = Number(element.dataset.node);
            const node = select(this.tree, id)[0];
            fn({ node, id, path: pathOf(this.tree, id), element, event });
        };
        this.element.addEventListener(type, listener);
        this.handlers.push([type, listener]);
        this.root.classList.add(`${this.p}-clickable`);
        return () => this.element.removeEventListener(type, listener);
    }

    /** The expression read aloud in pieces, each tagged with the node it describes. */
    segments(options = {}) {
        return toSpeechSegments(this.tree, options);
    }

    /** Light up the node a spoken piece is about (for karaoke-style narration). */
    showSegment(segment, className = `${this.p}-hl`) {
        this.unhighlight(null, className);
        if (segment && segment.id !== undefined) this.highlight(segment.id, className);
        return this;
    }

    // ---- animation between steps --------------------------------------------

    /** Where each drawn part is now, grouped by what it looks like. */
    snapshot() {
        const bySignature = new Map();
        const visit = (n) => {
            const e = this.elementOf(n);
            if (e) {
                const sig = signature(n);
                if (!bySignature.has(sig)) bySignature.set(sig, []);
                bySignature.get(sig).push(e.getBoundingClientRect());
            }
            if (n.type === 'op') n.args.forEach(visit);
        };
        visit(this.tree);
        return bySignature;
    }

    /**
     * Move each part of the new expression that was also in the old one from
     * its old place (largest matching parts first), and fade in the rest.
     */
    morph(before, { duration, easing }) {
        if (typeof Element === 'undefined' || !Element.prototype.animate) return;
        const visit = (n) => {
            const e = this.elementOf(n);
            const old = e && before.get(signature(n));
            if (old && old.length) {
                const from = old.shift();
                const to = e.getBoundingClientRect();
                const dx = from.left - to.left;
                const dy = from.top - to.top;
                const sx = to.width ? from.width / to.width : 1;
                const sy = to.height ? from.height / to.height : 1;
                if (Math.abs(dx) + Math.abs(dy) > 0.5 || Math.abs(sx - 1) + Math.abs(sy - 1) > 0.01) {
                    e.animate([
                        { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
                        { transformOrigin: '0 0', transform: 'none' },
                    ], { duration, easing });
                }
                return;
            }
            if (n.type === 'op') n.args.forEach(visit);
            else if (e) e.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration, easing });
        };
        visit(this.tree);
    }
}

/**
 * Should a step animate? true honours prefers-reduced-motion (no motion for a reader who asked
 * for none), 'always' does not, false never animates.
 */
export function shouldAnimate(animate) {
    if (!animate) return false;
    if (animate === 'always') return true;
    return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Draw an expression into an element and return a View for it. */
export function render(element, input, options = {}) {
    return new View(element, input, options);
}
