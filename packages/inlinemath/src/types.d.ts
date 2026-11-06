// Inline Math's declarations. Each entry's .d.ts (index, lite, lite-calc, markdown, cas) picks from here.
import type { Input, Node, BlockHandler } from 'mathzetta';
import type { SpeechOptions } from 'mathzetta/speech';

export type { Input, Node, BlockHandler };

/**
 * A part of an expression: a node id (MathZetta's postfix index), an expression written like any
 * input ('x^2': every part that is x²), a path ({ path: [0, 1] }, as @mathzetta/cas reports it), a test,
 * or a list of any of these.
 */
export type Target = number | string | { path: number[] } | ((node: Node) => boolean) | Target[];

export interface LayoutOptions {
    /** CSS class prefix (default 'mv'). */
    prefix?: string;
    /** Big operators with limits above and below, full-size fractions (default true). */
    display?: boolean;
    /** 'auto': sin x, ln|x|, sin(x + 1); 'always': sin(x). */
    fnParens?: 'auto' | 'always';
    /** sin(x)^2 written sin²x (default true). */
    trigPowers?: boolean;
    /** 'arc': arcsin x; 'power': sin⁻¹x. */
    inverseTrig?: 'arc' | 'power';
    /** d/dx [x² + 1] ('[') or d/dx (x² + 1) ('('). */
    derivativeBrackets?: '[' | '(';
    /** x^{1/2} with a slash ('slash') or stacked ('stack'). */
    scriptFractions?: 'slash' | 'stack';
    /** c ? a : b drawn as a piecewise brace (default true). */
    cases?: boolean;
    /** The accessible name: true = the spoken form, a string, a function of the tree, or false for none. */
    label?: boolean | string | ((tree: Node) => string);
    /** MathZetta's toMathML (from 'mathzetta/mathml'): also write the expression as visually hidden MathML, which
     *  screen readers can step through and show in math braille; it takes the place of the label. Off by default. */
    mathml?: ((input: Node) => string) | null;
    /** Extra attributes for a node's element. */
    attributes?: ((node: Node) => Record<string, string>) | null;
    /** Inline style for a node's element. */
    style?: ((node: Node) => string) | null;
}

export interface DrawOptions extends LayoutOptions {
    /** Colours by target: { 'x^2': 'red', 3: '#06c' } or [[target, colour], …]. */
    colors?: Record<string | number, string> | Array<[Target, string]>;
    /** Parts to mark with the `<prefix>-hl` class. */
    highlight?: Target;
    /** Variable values for `{{…}}` blocks. */
    scope?: Record<string, unknown>;
    /** Another `{{…}}` handler (casBlocks() from '@mathzetta/inlinemath/cas'). */
    blocks?: BlockHandler;
}

/** Options for a live view: everything toHTML takes, plus how steps reach a screen reader. */
export interface ViewOptions extends DrawOptions {
    /** Read each new step (every set() after the first) to a screen reader: true places a polite live
     *  region after the element; or pass your own live-region element. Off by default. */
    announce?: boolean | Element;
}

export const DEFAULTS: Required<LayoutOptions>;

/** Anything MathZetta reads, as HTML (a string; works in Node). Needs inlinemath.css on the page. */
export function toHTML(input: Input, options?: DrawOptions): string;
/** Anything MathZetta reads → a tree with node ids (`{{…}}` filled as toHTML would). */
export function treeOf(input: Input, options?: DrawOptions): Node;
/** A tree → HTML, with its height and depth in em. */
export function layout(tree: Node, options?: LayoutOptions): { html: string; h: number; d: number };

/** The nodes a target picks out, in tree order. */
export function select(tree: Node, target: Target): Node[];
/** A subtree's postfix as one string: two parts look the same exactly when these match. */
export function signature(node: Node): string;
export function nodeAt(tree: Node, path: number[]): Node | null;
export function pathOf(tree: Node, id: number): number[] | null;
/** Gives a tree built by hand the ids MathZetta would. */
export function numberTree<T extends Node>(tree: T): T;
/** SVG paths of the glyphs Inline Math draws, ( ) { } √ ∫ ∑ ∏: each filled or stroked, in a unit box. */
export const PATHS: Record<string, { fill?: string; stroke?: string }>;

export interface ClickInfo { node: Node; id: number; path: number[] | null; element: Element; event: Event }

/** A live drawing: highlight, colour, listen, step with animation. */
export class View {
    constructor(element: Element, input: Input, options?: ViewOptions);
    readonly element: Element;
    readonly tree: Node;
    /** Show a new expression; with animate, matching parts glide over and new ones fade in. `true` is instant
     *  when the reader's system asks for reduced motion; `'always'` animates regardless. */
    set(input: Input, options?: { animate?: boolean | 'always'; duration?: number; easing?: string }): this;
    /** The expression as a listener hears it (its accessible name, else MathZetta's audio speech). */
    spoken(): string;
    /** Say something through the live region ({ announce } must be set); steps are announced this way. */
    announce(text: string): this;
    nodes(target: Target): Node[];
    elements(target: Target): Element[];
    elementOf(node: Node): Element | null;
    highlight(target: Target, className?: string): this;
    unhighlight(target?: Target | null, className?: string): this;
    color(target: Target, colour: string): this;
    /** Listen for an event on a part; returns a function that stops listening. */
    /** Listen for an event on the parts. A 'click' listener also makes the drawing work from the keyboard:
     *  one tab stop, arrow keys walk the parts (each spoken), Enter or Space calls the listener for the
     *  current part — `event` is then the KeyboardEvent. */
    on(type: string, fn: (info: ClickInfo) => void): () => void;
    /** The part the arrow keys are on (null: the whole expression). */
    readonly active: Node | null;
    /** Put the keyboard on a part (null: the whole expression) and say it. */
    focusPart(node: Node | null): this;
    /** The expression read aloud in pieces, each tagged with the node it describes. */
    segments(options?: SpeechOptions): { text: string; id?: number }[];
    showSegment(segment: { id?: number } | null, className?: string): this;
}
/** Draw into an element and return the live view. */
export function render(element: Element, input: Input, options?: ViewOptions): View;
/** Should a step animate: true honours prefers-reduced-motion, 'always' does not, false never. */
export function shouldAnimate(animate?: boolean | 'always'): boolean;

// ---- inlinemath/markdown --------------------------------------------------------------------

export interface MarkdownOptions {
    /** Options for each drawing (toHTML's). */
    math?: DrawOptions;
    /** The `{{…}}` handler (default the calculator; casBlocks() for the CAS). */
    blocks?: BlockHandler;
    /** Values for `{{…}}`. */
    scope?: Record<string, unknown>;
    /** Remember $r = 3$ for later `{{…}}` (default true). */
    define?: boolean;
    /** Let raw HTML through (default false: it is shown as text). */
    html?: boolean;
    /** Another Markdown renderer; the maths is taken out first and put back into its output. */
    render?: (markdown: string) => string;
    /** Which of '$$', '$', '\\[', '\\(' mark maths (default all). */
    delimiters?: string[];
    /**
     * The saved variables ($A := 2+2$) the maths may use. markdownToHTML: none by default;
     * renderMarkdownInto: the page's `variables` by default, false for none.
     */
    variables?: Variables | false | null;
}
/** What a saved variable is: its expression, or the input that sets it. */
export interface VariableDefinition {
    name: string;
    text: string;
    input: null | { kind: 'textbox'; default: string } | { kind: 'dropdown'; options: string[]; default: string } | { kind: 'slider'; min: number; max: number; step: number; default: string };
    key: string;
}
/** A page's saved variables: every part drawn with renderMarkdownInto sees the others'. */
export class Variables {
    /** A variable's expression now (what its input holds, for an input), or undefined. */
    get(name: string): string | undefined;
    /** Set a variable: what its input holds, or (with no input) a definition for the whole page. */
    set(name: string, text: string | number): this;
    /** Forget a variable set with set(), or everything. */
    clear(name?: string): this;
    /** The saved names. */
    names(): string[];
    /** Called whenever a variable changes; returns a function that stops it. */
    subscribe(fn: (owner: unknown, name?: string) => void): () => void;
    definitions(except?: unknown): Map<string, VariableDefinition>;
    textOf(def: VariableDefinition): string;
    own(owner: unknown, defs: Map<string, VariableDefinition> | null): void;
}
/** A store of its own, for parts of a page that shouldn't share variables. */
export function createVariables(): Variables;
/** The page's store, renderMarkdownInto's default. */
export const variables: Variables;
export function markdownToHTML(markdown: string, options?: MarkdownOptions): string;
export function renderMarkdownInto<E extends Element>(element: E, markdown: string, options?: MarkdownOptions): E;
export function extractMath(markdown: string, options?: { delimiters?: string[] }): { text: string; math: Array<{ source: string; display: boolean; raw: string }> };
export function renderMarkdown(markdown: string, options?: MarkdownOptions): string;

// ---- inlinemath/cas (needs @mathzetta/cas) --------------------------------------------------------

/** A step from the CAS (@mathzetta/cas's CASStep fits): path null for a step standing for hidden ones. */
export interface CASStep { id: string; name: string; from: string; to: string; path?: number[] | null; explanation?: string }
/** @mathzetta/cas reading and writing MathZetta text (its full API: @mathzetta/cas/docs/cas.md). */
export type CAS = Record<string, any>;
export function mathCAS(options?: { rules?: unknown[]; names?: string[]; complex?: boolean; [option: string]: unknown }): CAS;
/** A `{{…}}` handler: toHTML(input, { blocks: casBlocks() }). `last` holds the latest CAS result. */
export function casBlocks(options?: { cas?: CAS }): BlockHandler & { last?: unknown };
/** Steps as an ordered list, each rewrite highlighted, with its explanation. */
export function stepsHTML(steps: CASStep[], options?: DrawOptions): string;
/** A CAS node → MathZetta postfix tokens. */
export function tokensOf(node: unknown): string[];

// ---- the calculator (inlinemath/lite-calc re-exports it) -------------------------------------

export { calculateBlock, calculate } from 'mathzetta/calculate';
