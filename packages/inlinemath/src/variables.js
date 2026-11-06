/**
 * Saved variables for '@mathzetta/inlinemath/markdown': `$A := 2+2$` saves A, and A in any maths
 * after it is drawn as 2 + 2 (and `{{A}}` is 4). A store holds them for a whole page, so every
 * part drawn with renderMarkdownInto sees the others' variables, and an input bound to a variable
 * (`$A := [[2+2]]$`, a textbox) redraws everything that uses it.
 *
 *   import { createVariables, variables } from '@mathzetta/inlinemath/markdown';
 *   variables.set('A', 'x^2');   // the page's store: A is x² everywhere
 *   variables.get('A');          // 'x^2'
 */

/**
 * Where a scope carries the saved variables' expressions, for {{…}} handlers that work with
 * expressions rather than values (casBlocks: {{diff(f, x)}} with f saved): name → MathZetta
 * postfix, every saved name inside already put in. A symbol, so the calculator never sees it.
 */
export const EXPRESSIONS = Symbol.for('inlinemath.expressions');

// ---- names ----------------------------------------------------------------------------------

const LEAF = new Set(['symbol', 'number']);

/** The variable a node names: A, α, A_1 (a symbol with a plain subscript) — else null. */
export function nameOf(node) {
    if (!node) return null;
    if (node.type === 'symbol') return node.value;
    if (node.type === 'op' && node.op === '_' && node.args.length === 2 && node.args[0].type === 'symbol' && LEAF.has(node.args[1].type)) {
        return `${node.args[0].value}_${node.args[1].value}`;
    }
    return null;
}

/** A tree with its ids (and where-it-came-from marks) dropped, so it can be numbered again inside another. */
export function bare(node) {
    const { id, from, ...rest } = node;
    if (rest.args) rest.args = rest.args.map(bare);
    return rest;
}

/** Ids dropped (to be numbered again), `from` marks kept. */
function renumber(node) {
    const { id, ...rest } = node;
    if (rest.args) rest.args = rest.args.map(renumber);
    return rest;
}

/**
 * The part of a substituted tree a variable stands for, written back in its own terms: the
 * variables inside it put back as their names. `named(name)` gives a name's own tree.
 */
export function unexpand(node, named) {
    const visit = (n, top) => {
        if (!top && n.from !== undefined) return named(n.from);
        const { id, from, ...rest } = n;
        if (rest.args) rest.args = rest.args.map((a) => visit(a, false));
        return rest;
    };
    return visit(node, true);
}

/**
 * Every saved name in a tree replaced by its own tree (which may use other saved names).
 * `lookup(name)` gives a saved name's tree, or null. A name inside its own definition is left as it is.
 * @returns {{ tree: object, changed: boolean }}
 */
export function substitute(tree, lookup) {
    let changed = false;
    const seen = new Set();
    const visit = (node) => {
        const name = nameOf(node);
        if (name !== null) {
            if (!seen.has(name)) {
                const value = lookup(name);
                if (value) {
                    changed = true;
                    seen.add(name);
                    const out = { ...visit(bare(value)), from: name };   // where it came from, for editing
                    seen.delete(name);
                    return out;
                }
            }
            return node;   // A_1 is one name: its A is not substituted
        }
        if (node.args) return { ...node, args: node.args.map(visit) };
        return node;
    };
    const out = visit(tree);
    return { tree: changed ? renumber(out) : tree, changed };
}

// ---- inputs ---------------------------------------------------------------------------------

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)';
const SLIDER = new RegExp(`^(${NUMBER})\\s*\\.\\.\\s*(${NUMBER})(?:\\s+step\\s+(${NUMBER}))?(?:\\s*=\\s*(${NUMBER}))?$`);

/**
 * What `[[…]]` asks for: `[[2+2]]` a textbox, `[[2+2 | x^2]]` a dropdown,
 * `[[1..10]]` a slider (`[[0..1 step 0.1 = 0.5]]` with a step and a starting value). Else null.
 */
export function inputOf(text) {
    const m = /^\s*\[\[([\s\S]*)\]\]\s*$/.exec(text);
    // [[2, 1], [1, 3]] is a matrix (rows of a list), not an input
    if (!m || /\]\s*,\s*\[/.test(m[1])) return null;
    const inner = m[1].trim();
    const range = SLIDER.exec(inner);
    if (range) {
        const min = Number(range[1]);
        const max = Number(range[2]);
        if (!(max > min)) return null;
        const step = range[3] !== undefined ? Number(range[3]) : Number.isInteger(min) && Number.isInteger(max) ? 1 : (max - min) / 100;
        if (!(step > 0)) return null;
        const start = range[4] !== undefined ? Math.min(max, Math.max(min, Number(range[4]))) : min;
        return { kind: 'slider', min, max, step, default: String(start) };
    }
    if (inner.includes('|')) {
        const options = inner.split('|').map((o) => o.trim()).filter(Boolean);
        if (options.length) return { kind: 'dropdown', options, default: options[0] };
    }
    return { kind: 'textbox', default: inner };
}

// ---- the store ------------------------------------------------------------------------------

const PAGE = Symbol('set on the page');

/**
 * Where a page's variables live. A part of the page owns the definitions it makes (drawing it
 * again replaces them); `set` is how an input — or the page's own code — changes one.
 */
export class Variables {
    constructor() {
        this.owners = new Map();     // owner → Map(name → definition)
        this.chosen = new Map();     // name → { key, text }: what an input was set to
        this.listeners = new Set();
    }

    /** Every definition, in the order the parts were drawn; `except` leaves one part out. */
    definitions(except) {
        const all = new Map();
        for (const [owner, defs] of this.owners) {
            if (owner === except) continue;
            for (const [name, def] of defs) {
                all.delete(name);   // a later definition goes after the earlier ones
                all.set(name, def);
            }
        }
        return all;
    }

    /** The text a definition stands for now: its expression, or what its input is set to. */
    textOf(def) {
        const chosen = this.chosen.get(def.name);
        return chosen && chosen.key === def.key ? chosen.text : def.text;
    }

    /** A variable's expression now, or undefined. */
    get(name) {
        const def = this.definitions().get(name);
        return def ? this.textOf(def) : undefined;
    }

    /** The saved names. */
    names() {
        return [...this.definitions().keys()];
    }

    /** Set a variable: what its input holds, or (with no input) a definition for the whole page. */
    set(name, text) {
        text = String(text);
        const def = this.definitions().get(name);
        if (def && def.input) {
            const chosen = this.chosen.get(name);
            if (chosen && chosen.key === def.key && chosen.text === text) return this;
            this.chosen.set(name, { key: def.key, text });
        } else {
            const defs = new Map(this.owners.get(PAGE));
            defs.set(name, { name, text, key: `page:${text}`, input: null });
            this.owners.delete(PAGE);
            this.owners.set(PAGE, defs);
        }
        this.notify(null, name);
        return this;
    }

    /** Forget a variable set with `set`, or everything (no name). */
    clear(name) {
        if (name === undefined) {
            this.owners.clear();
            this.chosen.clear();
        } else {
            this.owners.get(PAGE)?.delete(name);
            this.chosen.delete(name);
        }
        this.notify(null, name);
        return this;
    }

    /** Called with (owner, name) when something changes; returns a function that stops it. */
    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /** A part's definitions (null: it has none any more). Tells the others only when they change. */
    own(owner, defs) {
        const before = this.owners.get(owner);
        const same = (a, b) => (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every(([k, d]) => b?.get(k)?.key === d.key);
        if (same(before, defs)) {
            if (defs) this.owners.set(owner, defs);
            return;
        }
        if (defs && defs.size) this.owners.set(owner, defs);
        else this.owners.delete(owner);
        this.notify(owner);
    }

    notify(owner, name) {
        for (const fn of [...this.listeners]) fn(owner, name);
    }
}

/** A store of its own, for parts of a page that shouldn't share variables. */
export function createVariables() {
    return new Variables();
}

/** The page's store: renderMarkdownInto uses it unless told otherwise. */
export const variables = createVariables();
