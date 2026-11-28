// @mathzetta/cas's declarations. index.d.ts ('@mathzetta/cas/engine'), cas/index.d.ts ('@mathzetta/cas') and yaml.d.ts
// ('@mathzetta/cas/yaml') pick from here.

// ---- expressions -----------------------------------------------------------------------------

/** A node: a number, a symbol or an operation. Frozen; `s` is its canonical postfix text. */
export type Expr = NumNode | SymNode | OpNode;
interface NodeBase { readonly token: string; readonly s: string; readonly args: readonly Expr[] }
export interface NumNode extends NodeBase { readonly type: 'num'; readonly value: number }
export interface SymNode extends NodeBase { readonly type: 'sym'; readonly value: null }
export interface OpNode extends NodeBase { readonly type: 'op'; readonly op: string; readonly value: null }
/** Postfix text ('x 2 ^'), postfix tokens (what MathZetta's parse() returns) or a node. */
export type ExprInput = string | string[] | Expr;

export const NUM: 'num';
export const SYM: 'sym';
export const OP: 'op';
export class ExprError extends Error {}

/** Canonical text for a numeric value, so 3.0 and 3 unify. */
export function numToken(value: number): string;
export function num(value: number): NumNode;
export function sym(token: string): SymNode;
/** A number written exactly, as a decimal token of any length; `value` is the nearest double. */
export function exactNum(token: string): NumNode;
/** A leaf from a raw token, numbers recognized. */
export function leaf(token: string): NumNode | SymNode;
export function op(symbol: string, args: Expr[]): OpNode;
export function isNum(node: Expr): node is NumNode;
export function isSym(node: Expr): node is SymNode;
export function isOp(node: Expr): node is OpNode;
export function isLeaf(node: Expr): node is NumNode | SymNode;
export function equal(a: Expr, b: Expr): boolean;
export function tokenize(text: string): string[];
/** Whitespace-separated postfix → a tree. */
export function parse(text: string): Expr;
/** Postfix tokens (MathZetta's parse()) → a tree; variadic operators take their count from the token before them. */
export function fromPostfix(tokens: string[]): Expr;
/** Canonical postfix text. */
export function format(node: Expr): string;
export function depth(node: Expr): number;
export function nodeCount(node: Expr): number;
export function leafTokens(node: Expr, out?: string[]): string[];
/** True when the subtree contains no symbols: a constant (2 3 +, 1 sin), whether or not it folds to a number. */
export function isNumeric(node: Expr): boolean;
/** Every node with its path, root first ('pre') or leaves first ('post'). */
export function walk(node: Expr, order?: 'pre' | 'post'): Array<{ node: Expr; path: number[] }>;
export function at(root: Expr, path: number[]): Expr;
/** Replace the node at `path`, rebuilding only the nodes along it. */
export function replaceAt(root: Expr, path: number[], next: Expr): Expr;

// ---- operators -------------------------------------------------------------------------------

export interface OperatorSpec {
    /** The token as it appears in expressions. */
    symbol: string;
    /** Operands popped from the stack; VARIADIC (-1) for a count-prefixed list. */
    arity: number;
    /** The operands may be swapped (arity 2 only). */
    commutative?: boolean;
    /** The exact numeric value, or null when there is none (1/3 stays 1/3). */
    fold?: (...args: number[]) => number | null;
    /** A human name, for interfaces. */
    label?: string;
}
export const VARIADIC: -1;
/** Prefix of user-defined function tokens: `\:f`. */
export const CUSTOM_PREFIX: string;
export function isCustomFunction(token: string): boolean;
export function defineOperator(spec: OperatorSpec): OperatorSpec;
export function getOperator(symbol: string): OperatorSpec | null;
export function isOperator(symbol: string): boolean;
export function operators(): OperatorSpec[];
export function clearOperators(): void;
/** Puts back the built-in operators (MathZetta's names and arities). */
export function defineDefaultOperators(): void;

// ---- structure keys --------------------------------------------------------------------------

export const SLOT: '_';
export interface Collapsing { key: string; slots: Expr[] }
/** Every way of collapsing a node into a key, including the fully collapsed '_'. */
export function collapsings(node: Expr, maxDepth: number): Collapsing[];
/** The collapsings usable for rule lookup (all but the fully collapsed one). */
export function keysAt(node: Expr, maxDepth: number): Collapsing[];
/** The full-depth skeleton of a tree: what a rule pattern is indexed under. */
export function shapeKey(node: Expr): string;
export function shapeLeaves(node: Expr, out?: Expr[]): Expr[];

// ---- requirements ----------------------------------------------------------------------------

export class RequirementError extends Error {}
export interface Predicate { name: string; doc: string; fn: (node: Expr, ...args: unknown[]) => boolean }
/** A one-slot test for a rule's `when`: definePredicate('isTau', (node) => node.s === 'tau'). */
export function definePredicate(name: string, fn: (node: Expr, ...args: unknown[]) => boolean, doc?: string): void;
/** A test relating several slots, for a rule's `require`. */
export function defineRelation(name: string, fn: (...nodes: Expr[]) => boolean, doc?: string): void;
export function getPredicate(name: string): Predicate | null;
export function getRelation(name: string): Predicate | null;
export function predicateNames(): string[];
export function relationNames(): string[];
export function predicateList(): Predicate[];
export function relationList(): Predicate[];
/** "isZero" or ["contains", "x"] → { name, args }. */
export function normalizeCheck(entry: string | unknown[]): { name: string; args: unknown[] };

// ---- rules -----------------------------------------------------------------------------------

/** A rule as written in YAML. */
export interface RuleSpec {
    id: string;
    name?: string;
    /** Postfix; identifiers are slots, numbers are literals, `=pi` a literal symbol. */
    pattern: string;
    /** Postfix built from the slot names. */
    output: string;
    explain?: string;
    /** The pass it belongs to (default 'simplify'). */
    mode?: string;
    tags?: string[];
    priority?: number;
    /** Work the result out numerically where that is exact. */
    fold?: boolean;
    /** Also match the mirrored operand orders. */
    commutative?: boolean;
    enabled?: boolean;
    /** Per-slot predicates: { m: ['isNumber'] }. */
    when?: Record<string, Array<string | unknown[]>>;
    /** Relations between slots: [['sameAs', 'x', 'y']]. */
    require?: Array<unknown[]>;
}
/** A compiled rule. */
export interface Rule {
    id: string;
    name: string;
    pattern: string;
    output: string;
    explain: string;
    mode: string;
    tags: string[];
    priority: number;
    fold: boolean;
    commutative: boolean;
    enabled: boolean;
    slots: string[];
    depth: number;
    source: RuleSpec;
    [internal: string]: unknown;
}
export const MAX_VARIANTS: number;
export class RuleError extends Error { ruleId?: string }
export function compileRule(spec: RuleSpec): Rule;
export function ruleToSpec(rule: Rule): RuleSpec;
/** The slot names a compiled rule's output template uses (`rule.outputTemplate`). */
export function freeSymbols(template: unknown, out?: string[]): string[];

/** Rules indexed by structure key. */
export class RuleSet {
    constructor(rules?: Array<RuleSpec | Rule>);
    rules: Rule[];
    /** How many rules it holds. */
    readonly size: number;
    maxDepth: number;
    name: string;
    add(spec: RuleSpec | Rule): Rule;
    /** One mode's rules as a ruleset of their own, with their own index and depth cap. */
    view(mode: string): RuleSet;
    /** Modes present, simplify first. */
    modes(): string[];
    remove(id: string): boolean;
    /** False when there is no rule with that id. */
    setEnabled(id: string, enabled: boolean): boolean;
    reindex(): void;
    get(id: string): Rule | null;
    /** A bare list of rules, or { name, rules }; every compile error is collected (strict: throw them together). */
    static fromYaml(text: string, options?: { strict?: boolean }): RuleSet;
    static fromSpecs(doc: RuleSpec[] | { name?: string; rules: RuleSpec[] }, options?: { strict?: boolean }): RuleSet;
    toSpecs(): RuleSpec[];
    toYaml(): string;
    keyReport(): unknown;
}

// ---- matching and rewriting ------------------------------------------------------------------

export interface Match {
    rule: Rule;
    /** Where it applies: child indices from the root. */
    path: number[];
    node: Expr;
    key: string;
    [internal: string]: unknown;
}
/** A match with what it would produce. */
export interface Candidate extends Match {
    after: Expr;
    explanation: string;
    /** The whole expression after the rewrite (built when first read). */
    readonly result: Expr;
}
/** A rule that applies at one node (matchNode, matchesAt): no path yet, nothing built. */
export interface NodeMatch {
    rule: Rule;
    key: string;
    /** The subtrees each slot bound to. */
    bound: Record<string, Expr>;
    [internal: string]: unknown;
}
export interface Applied {
    expr: Expr;
    before: Expr;
    after: Expr;
    rule: Rule;
    path: number[];
    explanation: string;
}
export interface Step {
    ruleId: string;
    ruleName: string;
    path: number[];
    from: string;
    to: string;
    before: string;
    after: string;
    explanation: string;
}
/** Every rule that applies at this exact node, best first. */
export function matchNode(node: Expr, ruleset: RuleSet): NodeMatch[];
/** Every match anywhere in the tree, by site ('post': innermost first; 'pre': outermost first). */
export function matchAll(root: Expr, ruleset: RuleSet, options?: { order?: 'pre' | 'post' }): Match[];
export function instantiate(template: Expr, bound: Record<string, Expr>): Expr;
/** Work out numeric subtrees where the answer is exact (1/3 and √2 stay). */
export function foldNumeric(node: Expr): Expr;
export function renderExplanation(rule: Rule, bound: Record<string, Expr>, result: Expr): string;
export function rewriteOf(match: Match): Expr;
export function applyMatch(root: Expr, match: Match): Applied;
/** Everything that could be applied now, with what each would produce. */
export function findMatches(expr: Expr | string, ruleset: RuleSet, options?: { order?: 'pre' | 'post' }): Candidate[];
export function matchesAt(node: Expr, ruleset: RuleSet): NodeMatch[];
/** Apply exactly one rule, or null when none applies. */
export function step(expr: Expr | string, ruleset: RuleSet, options?: { order?: 'pre' | 'post'; choose?: (matches: Match[]) => Match | undefined; avoid?: Set<string> }): Applied | null;
/** Rewrite until nothing applies (or a cycle, or maxSteps). */
export function simplify(expr: Expr | string, ruleset: RuleSet, options?: { maxSteps?: number; order?: 'pre' | 'post' }): { expr: Expr; start: Expr; steps: Step[]; stopped: 'fixpoint' | 'cycle' | 'maxSteps' };
/** Postfix in, postfix out. */
export function simplifyText(text: string, ruleset: RuleSet, options?: { maxSteps?: number; order?: 'pre' | 'post' }): string;

// ---- YAML (also '@mathzetta/cas/yaml') -------------------------------------------------------------

export class YamlError extends Error {}
export function parseYaml(text: string): unknown;
export function stringifyYaml(value: unknown): string;

// ---- the CAS ('@mathzetta/cas') ---------------------------------------------------------------

/** Which steps to keep: a detail level, false for none, or a selection by step id or tag. */
export type StepOption = boolean | 'full' | 'normal' | 'brief' | {
    detail?: 'full' | 'normal' | 'brief';
    show?: 'all' | string[];
    hide?: string[];
    /** Explanations for every step (true), none (false), or only these rule ids or tags. */
    explain?: boolean | string[];
};
export interface CASStep {
    /** The rule id, or the CAS's own step id ('solve.quadratic' …). */
    id: string;
    name: string;
    tags: string[];
    /** The whole expression before and after, as postfix. */
    from: string;
    to: string;
    /** Where the rewrite happened; null for a step that stands for several hidden ones. */
    path: number[] | null;
    before: string;
    after: string;
    /** Absent when `explain` leaves it out. */
    explanation?: string;
    /** The rules of the hidden steps this one stands for. */
    also?: string[];
}
/** Options every CAS call takes. */
export interface CallOptions {
    /** Which steps to return (default 'normal'). */
    steps?: StepOption;
    /** Also write the answer as a decimal: true (15 significant figures) or a number of figures. */
    approximate?: boolean | number;
}
export interface CASResult {
    /** The answer, or null when there is none. */
    result: Expr | null;
    /** The answer written out (CAS format option; MathZetta-style text by default). */
    text: string;
    steps: CASStep[];
}
export interface CASOptions {
    /** i is the imaginary unit: √-4 = 2i, Re, Im, conj, arg, Euler's formula. */
    complex?: boolean;
    /** Rule files (YAML text or parsed), added after the shipped ones; same id replaces. */
    rules?: Array<string | object>;
    /** Include the shipped rules (default true). */
    defaults?: boolean;
    /** How parts are written in explanations and `text`. */
    format?: (node: Expr) => string;
    /** How a string input is read (default: postfix). */
    read?: (text: string) => string[] | Expr;
}
export type IntegrateOptions = CallOptions & {
    from?: string | number;
    to?: string | number;
    /** true: + C (c or K when the integrand has a C); a string: that name. */
    constant?: boolean | string;
};
export interface CAS {
    /** A string (postfix, or what `read` reads), tokens or a node → a node. */
    node(input: ExprInput): Expr;
    /** The normal form: numbers worked out, like terms collected, no rules. */
    normal(input: ExprInput): Expr;
    /** Rewrite with one mode's rules ('simplify', 'differentiate', or your own). */
    rewrite(input: ExprInput, mode: string, options?: CallOptions): CASResult;
    simplify(input: ExprInput, options?: CallOptions): CASResult;
    expand(input: ExprInput, options?: CallOptions): CASResult;
    factor(input: ExprInput, options?: CallOptions): CASResult;
    /** One fraction, common factors canceled. */
    cancel(input: ExprInput, options?: CallOptions): CASResult;
    /** d/dv, `order` times. */
    diff(input: ExprInput, v?: string, options?: CallOptions & { order?: number }): CASResult;
    /** ∫ input dv; { from, to } for a definite integral, { constant: true } (or a name, 'k') to add + C. The options may come second. */
    integrate(input: ExprInput, v?: string, options?: IntegrateOptions): CASResult;
    integrate(input: ExprInput, options?: IntegrateOptions): CASResult;
    /** Solve an equation (or expression = 0) for v. */
    solve(input: ExprInput, v?: string, options?: CallOptions): CASResult & {
        solutions: Expr[];
        variable: string;
        /** True for every value of the variable (x = x). */
        always: boolean;
        /** Equations left that no exact method solves (try { approximate: true }). */
        unsolved: Expr[];
        /**
         * For an inequality (<, >, ≤, ≥, or a chain a < E < b): where it holds, by a sign chart. Each piece is an
         * interval, ends exact (null: −∞ or ∞), or a single point (lo = hi). null when it can't be charted (trig).
         */
        pieces?: { lo: Expr | null; hi: Expr | null; loClosed: boolean; hiClosed: boolean }[] | null;
        /** The same in interval notation: '(-∞, -2) ∪ (2, ∞)', '[-2, 2]', '{0}', '∅'. */
        intervals?: string;
    };
    /**
     * lim input as v → to: limit('\\lim_{x \\to 0} \\frac{\\sin x}{x}') (one-sided from x \\to 0^+), or limit('sin(x)/x', 'x', 0,
     * { side: 'left' | 'right' }). text: the value (a number, '∞', '-∞') or 'does not exist' (exists: false, with the reason).
     */
    limit(input: ExprInput, v?: string, to?: ExprInput | number, options?: CallOptions & { side?: 'left' | 'right' }): CASResult & {
        exists: boolean;
        /** The value is ∞ or -∞. */
        infinite?: boolean;
        /** Why there is no limit: the sides differ, or it keeps swinging. */
        reason?: string;
    };
    /** Linear equations in several unknowns. */
    /** `solution` is null unless there is exactly one. */
    solveSystem(equations: ExprInput[], vars?: string[], options?: CallOptions): { solution: Record<string, Expr> | null; status: 'none' | 'one' | 'many'; text: string; steps: CASStep[] };
    /** Put values in ({ x: 2 } or { x: 'y 1 +' }) and simplify. */
    substitute(input: ExprInput, values: Record<string, number | string | Expr>, options?: CallOptions): CASResult;
    /** A decimal to `digits` significant figures (default 15; any number). */
    /** `number` is null when unknowns are left (they stay, the constants around them become decimals). */
    approximate(input: ExprInput, options?: { digits?: number; scope?: Record<string, number | string | bigint> }): { result: Expr; text: string; number: number | null; exact: boolean; re?: number; im?: number };
    /** Are a and b the same? */
    equivalent(a: ExprInput, b: ExprInput): { equal: boolean; how: string };
    /** Mode names in its rules. */
    modes(): string[];
    [internal: string]: unknown;
}
export function createCAS(options?: CASOptions): CAS;
/** How the CAS's own steps are worded; a rule file's `messages:` section overrides them. */
export const MESSAGES: Record<string, string>;
/** Which step tags each detail level hides. */
export const DETAIL: { full: string[]; normal: string[]; brief: string[] };
export class CasError extends Error {}
/** A node as readable text ('3x^2·sin(x)'). */
export function toText(node: Expr): string;
/** A constant expression to `digits` significant figures; exact: no rounding happened. */
export function approximate(node: Expr, options?: { digits?: number; scope?: Record<string, number | string | bigint> }): { text: string; node: Expr; number: number; exact: boolean; re: number; im: number };
/** The shipped rule files, bundled (rules/calculus.yaml and rules/cas/*.yaml). */
export const DEFAULT_RULES: string[];
/** rules/cas/complex/*.yaml, added by createCAS({ complex: true }). */
export const COMPLEX_RULES: string[];
