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
 *
 * Once something listens for 'click', the drawing works from the keyboard too:
 * Tab to it, arrow keys walk its parts (Down into a part, Up out of it,
 * Left/Right between neighbours, Home or Escape back to the whole), Enter or
 * Space fires the click handlers for the current part, and each part is spoken.
 *
 * view.editable({ toText }) (toText from 'mathzetta/text') lets the reader change it: double-click
 * a part, or press F2 on the part the keyboard is on, and a text box opens over it; Enter puts
 * the new text in its place, Escape leaves it. { onEdit } hears each change.
 *
 * With { announce: true }, each set() after the first reads the new expression
 * to a screen reader through a polite live region placed after the element
 * (or pass your own live-region element as `announce`).
 */

import { toSpeechSegments, toAudioSpeech } from './mathzetta.js';
import { treeOf, layoutOptions } from './html.js';
import { layout } from './layout.js';
import { select, signature, pathOf, nodeAt } from './select.js';
import { openEditor, replaceAt } from './edit.js';

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
        this.clicks = [];        // the 'click' handlers, which Enter and Space call too
        this.active = null;      // the part the keyboard is on (null: the whole expression)
        this.live = liveRegionFor(element, options.announce, this.p);
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
        // an editor still open over the old expression would put its text at the old one's path
        if (this.editor) {
            const open = this.editor;
            this.editor = null;
            open.cancelEdit?.();
        }
        const before = shouldAnimate(animate) && this.tree ? this.snapshot() : null;
        const isStep = this.tree !== undefined;
        this.tree = treeOf(input, this.options);
        this.element.innerHTML = layout(this.tree, layoutOptions(this.tree, this.options)).html;
        this.root = this.element.firstElementChild;
        if (this.handlers.length) this.root.classList.add(`${this.p}-clickable`);
        if (this.editing) this.root.classList.add(`${this.p}-editable`);
        this.active = null;
        if (this.clicks.length || this.editing) this.focusable();
        if (before) this.morph(before, { duration, easing });
        if (isStep && this.live) this.announce(this.spoken());
        return this;
    }

    /** The expression as a listener hears it: its accessible name, else MathZetta's audio speech. */
    spoken() {
        const label = this.root && this.root.getAttribute && this.root.getAttribute('aria-label');
        if (label) return label;
        try { return toAudioSpeech(this.tree); } catch { return ''; }
    }

    /**
     * Say something through the view's live region ({ announce } must be set): the new step is
     * announced this way, and a page can add its own words ("Step 3: …"). The region is emptied
     * first, so the same words twice are still read.
     */
    announce(text) {
        return this.say(this.live, text);
    }

    say(live, text) {
        if (!live) return this;
        live.textContent = '';
        const put = () => { live.textContent = text; };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(put));
        else setTimeout(put, 50);
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
        const entry = [type, listener];
        this.handlers.push(entry);
        this.root.classList.add(`${this.p}-clickable`);
        if (type === 'click') { this.clicks.push(fn); this.keyboard(); }
        return () => {
            this.element.removeEventListener(type, listener);
            this.clicks = this.clicks.filter((f) => f !== fn);
            this.handlers = this.handlers.filter((h) => h !== entry);   // or every set() would mark it clickable again
            if (!this.handlers.length && this.root) this.root.classList.remove(`${this.p}-clickable`);
        };
    }

    /**
     * Stop listening: every handler from on(), the keys, double-click editing; any editor open is closed and
     * the live regions this view added are removed. The drawing stays. Call it before dropping a view whose
     * element lives on (a page that draws a new View into the same element).
     */
    destroy() {
        if (this.editor) { const open = this.editor; this.editor = null; open.cancelEdit?.(); }
        for (const [type, listener] of this.handlers) this.element.removeEventListener(type, listener);
        this.handlers = [];
        this.clicks = [];
        if (this.keyListener) this.element.removeEventListener('keydown', this.keyListener);
        if (this.editListener) this.element.removeEventListener('dblclick', this.editListener);
        this.keyListener = this.editListener = null;
        this.keysOn = this.editOn = false;
        for (const live of new Set([this.live, this.partsLive])) if (live && live.dataset?.mvMadeBy === 'view') live.remove();
        this.live = this.partsLive = null;
        return this;
    }

    // ---- editing a part in place ---------------------------------------------------

    /**
     * Let the reader edit the expression a part at a time (double-click, or F2 from the keyboard).
     * @param {object} how
     * @param {(node: object) => string} how.toText MathZetta's toText ('mathzetta/text')
     * @param {(change: { tree, text, path, part }) => void} [how.onEdit] after each change: the
     *   new expression (tree, and as text), where the edited part is and what was typed
     */
    editable({ toText, onEdit } = {}) {
        if (typeof toText !== 'function') throw new Error("editable needs { toText } (import { toText } from 'mathzetta/text')");
        this.editing = { toText, onEdit };
        if (this.root && this.root.classList) this.root.classList.add(`${this.p}-editable`);
        this.keyboard();
        if (!this.editOn && this.element.addEventListener) {
            this.editOn = true;
            this.editListener = (event) => {
                const element = event.target.closest?.('[data-node]');
                if (!element || !this.root.contains(element)) return;
                event.preventDefault();
                this.edit(select(this.tree, Number(element.dataset.node))[0]);
            };
            this.element.addEventListener('dblclick', this.editListener);
        }
        return this;
    }

    /** Open the text box over a part (a node, or any target select() takes). */
    edit(target = this.tree, { returnFocus = false } = {}) {
        if (!this.editing) throw new Error('call editable({ toText }) first');
        const node = typeof target === 'object' && target && target.type ? target : this.nodes(target)[0];
        if (!node) return null;
        const path = pathOf(this.tree, node.id) || [];
        const element = this.elementOf(node) || this.root;
        let label = 'Edit';
        try { label = `Edit ${toAudioSpeech(node)}`; } catch { /* the plain name will do */ }
        const back = () => { if (returnFocus && this.root.focus) this.root.focus(); };
        this.editor = openEditor(element, this.editing.toText(node), {
            label,
            prefix: this.p,
            parse: (text) => treeOf(text, this.options),
            commit: (part, typed) => {
                this.set(replaceAt(this.tree, path, part), { animate: true });
                const inPlace = nodeAt(this.tree, path);
                if (returnFocus && inPlace) this.focusPart(inPlace === this.tree ? null : inPlace);
                back();
                if (this.editing.onEdit) this.editing.onEdit({ tree: this.tree, text: this.editing.toText(this.tree), path, part: typed });
            },
            cancel: back,
        });
        return this.editor;
    }

    // ---- the keyboard: what a click does, without a pointer -----------------------

    /** Make the expression one tab stop, with the keys explained to a screen reader. */
    focusable() {
        if (!this.root || !this.root.setAttribute) return;
        this.root.setAttribute('tabindex', '0');
        // a focusable element needs a name: with { mathml: true } the drawing has none of its own (the MathML has it)
        if (!this.root.getAttribute('aria-label')) { this.root.setAttribute('role', 'math'); this.root.setAttribute('aria-label', this.spoken()); }
        this.root.setAttribute('aria-description', this.editing
            ? 'Arrow keys move between parts, F2 edits one.'
            : 'Arrow keys move between parts, Enter selects one.');
    }

    /** Listen for the keys once, on the element (it outlives every set()). */
    keyboard() {
        this.focusable();
        if (this.keysOn || !this.element.addEventListener) return;
        this.keysOn = true;
        this.partsLive = this.live || liveRegionFor(this.element, true, this.p);
        this.keyListener = (event) => this.key(event);
        this.element.addEventListener('keydown', this.keyListener);
    }

    key(event) {
        if (!this.root || !this.root.contains(event.target)) return;
        const at = this.active;
        let next;
        switch (event.key) {
            case 'ArrowDown': next = at ? this.partsOf(at)[0] : this.partsOf(this.tree)[0]; break;
            case 'ArrowUp': next = at ? this.outerOf(at) : undefined; break;
            case 'ArrowRight': next = at ? this.neighbour(at, 1) : this.partsOf(this.tree)[0]; break;
            case 'ArrowLeft': next = at ? this.neighbour(at, -1) : undefined; break;
            case 'Home': case 'Escape': next = null; break;
            case 'F2':
                if (!this.editing) return;
                event.preventDefault();
                this.edit(at || this.tree, { returnFocus: true });
                return;
            case 'Enter': case ' ': {
                event.preventDefault();
                const node = at || this.tree;
                const element = this.elementOf(node) || this.root;
                const info = { node, id: node.id, path: pathOf(this.tree, node.id), element, event };
                for (const fn of this.clicks) fn(info);
                return;
            }
            default: return;
        }
        event.preventDefault();
        if (next === undefined) return;     // nowhere to go: stay put
        this.focusPart(next);
    }

    /** Put the keyboard on a part (null: the whole expression) and say it. */
    focusPart(node) {
        const cls = `${this.p}-focus`;
        this.root.querySelectorAll(`.${cls}`).forEach((e) => e.classList.remove(cls));
        this.active = node;
        const element = node && this.elementOf(node);
        if (element) element.classList.add(cls);
        let words = '';
        try { words = node ? toAudioSpeech(node) : this.spoken(); } catch { words = ''; }
        this.say(this.partsLive, words);
        return this;
    }

    /** The parts directly inside a node that are drawn (an undrawn wrapper is looked through). */
    partsOf(node) {
        const out = [];
        const visit = (n) => { if (this.elementOf(n)) out.push(n); else if (n.type === 'op') n.args.forEach(visit); };
        if (node && node.type === 'op') node.args.forEach(visit);
        return out;
    }

    /** The drawn part a node sits in, or null for the whole expression. */
    outerOf(node) {
        const path = pathOf(this.tree, node.id);
        for (let k = path ? path.length - 1 : -1; k > 0; k--) {
            const up = nodeAt(this.tree, path.slice(0, k));
            if (up && this.elementOf(up)) return up;
        }
        return null;
    }

    /** The part beside this one (dir 1 next, -1 previous), or undefined at the end. */
    neighbour(node, dir) {
        const siblings = this.partsOf(this.outerOf(node) || this.tree);
        const i = siblings.indexOf(node);
        return i < 0 ? undefined : siblings[i + dir];
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

    /** Where each drawn part is now, grouped by what it looks like; each entry knows the old node it was. */
    snapshot() {
        const bySignature = new Map();
        const visit = (n) => {
            const e = this.elementOf(n);
            if (e) {
                const sig = signature(n);
                if (!bySignature.has(sig)) bySignature.set(sig, []);
                bySignature.get(sig).push({ rect: e.getBoundingClientRect(), node: n, sig });
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
        // a part that moves as a whole takes its old parts with it: they are no source for another (x² + x → x² − x:
        // the lone x comes from the old lone x, not from inside x²)
        const consume = (oldNode) => {
            if (oldNode.type !== 'op') return;
            for (const child of oldNode.args) {
                const list = before.get(signature(child));
                const at = list ? list.findIndex((entry) => entry.node === child) : -1;
                if (at > -1) list.splice(at, 1);
                consume(child);
            }
        };
        const visit = (n) => {
            const e = this.elementOf(n);
            const old = e && before.get(signature(n));
            if (old && old.length) {
                const { rect: from, node: was } = old.shift();
                consume(was);
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
 * The live region steps are announced through: the element given, or a visually hidden polite
 * region created right after the view's element (its contents are replaced by every set()).
 */
function liveRegionFor(element, announce, prefix) {
    if (!announce) return null;
    if (typeof announce === 'object' && announce.nodeType === 1) return announce;
    if (typeof document === 'undefined' || !element.insertAdjacentElement) return null;
    // one region per element: drawing a new view into the same element reuses the last one's
    const next = element.nextElementSibling;
    if (next && next.dataset?.mvMadeBy === 'view' && next.classList.contains(`${prefix}-sr-only`)) return next;
    const live = document.createElement('span');
    live.dataset.mvMadeBy = 'view';
    live.className = `${prefix}-sr-only`;
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    element.insertAdjacentElement('afterend', live);
    return live;
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
