/**
 * Editing a part of a drawn expression in place: a text box opens over the part, holding the
 * part as text; Enter puts what was typed back into the expression, Escape (or leaving it with
 * something that doesn't read) changes nothing. Used by View.editable() and by the Markdown
 * pages' textbox variables.
 *
 * The part is written as text by MathZetta's toText, which the caller passes in (import it
 * from 'mathzetta/text'): Inline Math's core imports only 'mathzetta', 'mathzetta/speech' and
 * 'mathzetta/calculate', so a buildless page's import map stays the same.
 */

import { bare } from './select.js';

/** A copy of `tree` (ids dropped) with the node at `path` replaced by `part`. */
export function replaceAt(tree, path, part) {
    const visit = (n, k) => (k === path.length
        ? part
        : { ...n, args: n.args.map((a, j) => (j === path[k] ? visit(a, k + 1) : a)) });
    return bare(visit(tree, 0));
}

/**
 * Open a text box over `element` holding `text`.
 * @param {Element} element the drawn part
 * @param {string} text what the box starts with
 * @param {object} how
 * @param {(text: string) => object} how.parse the typed text → a tree (throws if it doesn't read)
 * @param {(tree: object, text: string) => void} how.commit called with the new part
 * @param {() => void} [how.cancel] called when nothing changed
 * @param {string} [how.label] the box's accessible name
 * @param {string} [how.prefix] the drawing's class prefix (mv): the box is `${prefix}-edit`
 * @returns {HTMLInputElement|null} the box; its cancelEdit() closes it without a change
 */
export function openEditor(element, text, { parse, commit, cancel, label = 'Edit', prefix = 'mv' }) {
    const doc = element.ownerDocument;
    if (!doc || !doc.body) return null;
    const view = doc.defaultView;
    const r = element.getBoundingClientRect();
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = `${prefix}-edit`;
    input.value = text;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', label);
    const fit = () => { input.style.width = `${Math.max(4, input.value.length + 2)}ch`; };
    const font = view.getComputedStyle(element);
    Object.assign(input.style, {
        position: 'absolute',
        left: `${r.left + view.scrollX}px`,
        top: `${r.top + view.scrollY + r.height / 2}px`,
        minWidth: `${Math.max(r.width, 32)}px`,
        fontSize: font.fontSize,
    });
    fit();
    doc.body.appendChild(input);
    view.getSelection?.()?.removeAllRanges();   // the double-click selected a word of the page
    input.focus();
    input.select();

    let done = false;
    const close = () => {
        done = true;
        input.remove();
    };
    // closed from outside (the view drew something else): nothing is committed
    input.cancelEdit = () => {
        if (done) return;
        close();
        if (cancel) cancel();
    };
    const finish = (keep) => {
        if (done) return true;
        if (!keep || input.value === text) {
            close();
            if (cancel) cancel();
            return true;
        }
        let tree;
        try {
            tree = parse(input.value);
        } catch (error) {
            input.setAttribute('aria-invalid', 'true');
            input.title = error.message;
            return false;
        }
        close();
        commit(tree, input.value);
        return true;
    };
    input.addEventListener('keydown', (event) => {
        event.stopPropagation();   // the view's arrow keys are not for the box
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('input', () => {
        fit();
        input.removeAttribute('aria-invalid');
        input.removeAttribute('title');
    });
    input.addEventListener('blur', () => { if (!finish(true)) finish(false); });
    return input;
}
