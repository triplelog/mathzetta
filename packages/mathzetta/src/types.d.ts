/**
 * Every declaration, in one place. The entry points (index.d.ts, latex.d.ts,
 * …) re-export the parts they provide.
 */

/** Standard postfix: operand and operator tokens. See docs/postfix.md. */
export type Postfix = string[];

export type Node =
    | { type: 'number'; value: string; id?: number }
    | { type: 'symbol'; value: string; id?: number }
    | { type: 'string'; value: string; id?: number }
    /** written: how a `*` was typed, · (\\cdot) or × (\\times); absent for other products. The postfix has only `*`. */
    | { type: 'op'; op: string; args: Node[]; id?: number; written?: 'dot' | 'cross' };

/** Anything the outputters accept. */
export type Input = string | Postfix | Node;

/** Fills a `{{...}}` block: the text inside → the text to read instead. */
export type BlockHandler = (expression: string, scope?: Record<string, unknown>) => string;

export interface ParseOptions {
    /** Return parseSteps() output instead of postfix. */
    keepIntermediateSteps?: boolean;
    /** On a malformed expression, return the raw postfix instead of throwing. */
    allowUnvalidated?: boolean;
    /** Multi-letter names to keep whole, e.g. ['cost', 'rate']; otherwise runs of letters may be read as products. */
    names?: string[];
    /** Names that are values, never functions: `k (x + 1)` is a product, not a call. */
    values?: string[];
    /**
     * How `{{...}}` blocks are filled; `null` leaves them as plain groups.
     * Default: the handler set by setBlockHandler() — calculateBlock once 'mathzetta/calculate' is loaded.
     */
    blocks?: BlockHandler | null;
    /** Variable values passed to `blocks`: parse('y = {{a/b}}', { scope: { a: 1, b: 3 } }). */
    scope?: Record<string, unknown>;
    /** The longest text read, in characters (default 5000); longer input is refused. */
    maxLength?: number;
}

export interface ParseSteps {
    original: string;
    /** 'latex' when the input contains a \command, else 'plain'; decides how runs of letters are read. */
    mode?: 'latex' | 'plain';
    cleaned?: string;
    cleanSteps?: [phase: string, text: string][];
    tokens?: string[];
    rawPostfix?: string[];
    postfix?: Postfix;
    /** How each product was typed, by postfix index: { 4: 'cross' } for a × b at index 4. Also on the tree's nodes. */
    written?: Record<number, 'dot' | 'cross'>;
    tree?: Node;
    error?: string;
}

export interface OperatorDefinition {
    prec: number;
    assoc: 'left' | 'right' | 'none';
    arity: number;
    fixity: 'infix' | 'prefix' | 'postfix' | 'none';
    group?: boolean;
}

// ---- core: 'mathzetta' ------------------------------------------------------------

export const version: string;
export const VARIADIC: -1;
export const CUSTOM_PREFIX: string;

export function parse(expression: string): Postfix;
export function parse(expression: string, options: ParseOptions & { keepIntermediateSteps: true }): ParseSteps;
export function parse(expression: string, options?: ParseOptions): Postfix;
export { parse as parseToPostfix };
export function parseSteps(expression: string, options?: ParseOptions): ParseSteps;
export function parseTree(expression: string, options?: ParseOptions): Node;
export function clean(expression: string, options?: Pick<ParseOptions, 'blocks' | 'scope'>): { cleaned: string; stringMap: Map<string, string>; steps: [string, string][] };
/** Set the default for `{{...}}` blocks; 'mathzetta/calculate' calls this with calculateBlock when loaded. */
export function setBlockHandler(handler: BlockHandler | null): void;

export function fromPostfix(postfix: Postfix): Node;
/** `written`, if given, is filled with { postfix index: 'dot' | 'cross' } for the nodes that carry it. */
export function toPostfix(tree: Node, written?: Record<number, 'dot' | 'cross'>): Postfix;
export function validatePostfix(postfix: Postfix): boolean;
/** A postfix array or a tree → the tree. */
export function asTree(input: Postfix | Node): Node;
/** Text, postfix or a tree → the tree (text is parsed with the options). */
export function treeOf(input: Input, parseOptions?: ParseOptions): Node;
/** Visit every node, parents before children. */
export function walk(node: Node, visit: (node: Node, parent: Node | null) => void): void;
/** The first single-letter variable in a tree, or ''. */
export function firstVariable(node: Node): string;
export function num(value: string | number): Node;
export function sym(value: string): Node;
export function op(name: string, args: Node[]): Node;
export function leaf(token: string): Node;

export function operator(token: string): OperatorDefinition | undefined;
export function isOperator(token: string): boolean;
export function operatorNames(): string[];
export function precedenceOf(token: string): number | undefined;
export function getOperatorPrecedence(token: string): number | undefined;
/** Does a child expression need brackets inside its parent? */
export function needsParens(parentOp: string, childOp: string | null, side?: 'left' | 'right'): boolean;
export function isCustomFunction(token: string): boolean;
export function isNumeric(text: string): boolean;
export function getSupportedOperations(): Record<string, string[]>;

// How a tree reads when written out — shared by every outputter, and by Inline Math.
export const GREEK: Record<string, string>;
export function bracketOp(node: Node): string | null;
export function needsBrackets(parent: Node, child: Node, side: 'left' | 'right'): boolean;
export function unaryNeedsBrackets(parentOp: string, child: Node): boolean;
export function isImplicitProduct(left: Node, right: Node, bracketed?: { left?: boolean; right?: boolean }): boolean;
export function bracketedSides(node: Node): { left: boolean; right: boolean };
export function isMinusOneTimes(node: Node): boolean;
export function startsWithSign(node: Node): boolean;
export function isVariable(node: Node): boolean;
export function firstLeaf(node: Node): string;
export function smallWhole(node: Node, limit: number): number;
export function customName(op: string): string;
export function derivativeOrder(node: Node): { n: number; body: Node; by: Node; /** The point of der(f, x = a), else null. */ at: Node | null; variable: boolean };
/** The matrix operators (pmatrix, bmatrix, vmatrix) and the brackets each is written with. */
export const MATRICES: { pmatrix: [string, string]; bmatrix: [string, string]; vmatrix: [string, string] };
/** A matrix's rows (arrays of entry nodes): a pmatrix/bmatrix/vmatrix node, or a list of equally long lists; else null. */
export function matrixRows(node: Node): Node[][] | null;

// ---- outputters ------------------------------------------------------------------

export function toLaTeX(input: Input, options?: { wrap?: (node: Node, latex: string) => string }): string;
/** ids: false leaves out the id="mz-<index>" attributes (MathML to paste elsewhere). */
export function toMathML(input: Input, options?: { ids?: boolean }): string;
export function toText(input: Input): string;

export interface SpeechOptions {
    /** Connecting words to change, e.g. { negative: 'minus' }; see SPEECH_WORDS. */
    words?: Partial<Record<string, string | ((...args: any[]) => string) | string[]>>;
    /** What functions are called, e.g. { ln: 'log' }; see SPEECH_NAMES. */
    names?: Record<string, string>;
    /** Whole phrases: operator or node type → (spokenOperands, node, speak) => phrase. */
    say?: Record<string, (parts: string[], node: Node, speak: (node: Node) => string) => string>;
}
/** The expression read aloud: "x squared plus 1". */
export function toSpeech(input: Input, options?: SpeechOptions): string;
/** The same phrase in pieces, each tagged with the node it belongs to. */
export function toSpeechSegments(input: Input, options?: SpeechOptions): { text: string; id?: number }[];
/** For a listener who cannot see the math (a screen reader, audio only): groups are opened with
 *  "the quantity" and closed with an end word — "the square root of the quantity x plus 1, end root, plus 2". */
export function toAudioSpeech(input: Input, options?: SpeechOptions): string;
/** toAudioSpeech() in pieces tagged with node ids. */
export function toAudioSpeechSegments(input: Input, options?: SpeechOptions): { text: string; id?: number }[];
export const SPEECH_WORDS: Record<string, unknown>;
export const SPEECH_NAMES: Record<string, string>;

export function toJavaScript(input: Input, language?: 'javascript' | 'python' | 'numpy' | 'sympy'): string;
/**
 * numpy: element-wise over arrays (np.where, np.maximum, np.logical_and …).
 * sympy: symbolic and exact (Rational, Eq, Piecewise, diff, integrate, limit, summation); not with numpy.
 */
export function toPython(input: Input, options?: { numpy?: boolean; sympy?: boolean }): string;

export interface PythonFunctionOptions {
    /** The function's name; default: the definition's (`f(x) = …`, `y = …`), else 'f'. */
    name?: string;
    /** Its parameters in order. Declared, they are all the formula may read (besides `globals`). */
    params?: string[];
    /** Other names it may read: module-level values in the program. */
    globals?: string[];
    /** Functions it may call besides math.*. */
    functions?: string[];
    /** Element-wise over numpy arrays; parameters become float arrays. */
    numpy?: boolean;
    /**
     * Symbolic and exact (SymPy): derivatives, integrals, limits and sums work. The variables they bind
     * become sympy.Symbol inside the function; a parameter of the same name is substituted after
     * (f(x) = d/dx x³: f(2) is 12, f(Symbol("x")) is 3x²). Not with numpy or columns.
     */
    sympy?: boolean;
    /** What 1/0, sqrt(-1) and overflow do: 'raise' (default), or 'nan' (numpy: inf/nan element by element). */
    errors?: 'raise' | 'nan';
    /** A table's header: the formula may use these columns by name (whole words, any case). */
    columns?: string[];
    /** The parameter holding the table, read as `data["HR"]` (default 'data'). */
    table?: string;
}
export interface PythonFunction {
    /** The `def`, ending in a newline. */
    code: string;
    name: string;
    params: string[];
    /** Lines such as 'import math'. */
    imports: string[];
    /** The formula text on one line (null for postfix or a tree). */
    formula: string | null;
    /** The formula as LaTeX, for labels. */
    latex: string | null;
    /** The formula with columns under their own names, to draw (Inline Math). */
    tree: Node;
}
export interface PythonSlot {
    name: string;
    params: string[];
    /** The parameter written `name: columns`, which holds a table, or null. */
    columns: string | null;
    /** The comment just above the slot. */
    doc: string;
    /** The default formula, or null. */
    formula: string | null;
    line: number;
    indent: string;
}
/** A formula as a Python `def`; throws on names it may not use, and on derivatives and limits. */
export function toPythonFunction(input: Input, options?: PythonFunctionOptions): PythonFunction;
/** Throws UnsafeCodeError unless the code is only numbers, "…" strings, operators, the allowed names and math.*. */
export function checkGeneratedPython(code: string, options?: { variables?: Iterable<string>; functions?: Iterable<string> }): string;
export interface PythonTemplate {
    slots: PythonSlot[];
    /** `# mathzetta-data: file.csv`, or null. */
    data: string | null;
    /** The first paragraph of the module docstring. */
    description: string;
    /** From `# mathzetta-options:`. */
    numpy?: boolean;
    sympy?: boolean;
    errors?: 'raise' | 'nan';
}
/** The `# mathzetta: name(a, b) = default` slots in a Python template, its data and options. */
export function readPythonTemplate(template: string): PythonTemplate;
export interface PreparedSlot extends Omit<PythonSlot, 'formula' | 'indent'> {
    default: string | null;
    formula: Input | null;
    error: string | null;
    code: string | null;
    latex: string | null;
    /** The formula with columns under their own names, to draw (Inline Math). */
    tree: Node | null;
}
/** What a form needs: every slot's result (never throws for a formula); the program when all are right. */
export function preparePythonTemplate(template: string, formulas?: Record<string, Input>, options?: Parameters<typeof fillPythonTemplate>[2]): {
    program: string | null; error: string | null; description: string; data: string | null; slots: PreparedSlot[];
};
/** The template with each slot replaced by its function (a formula from `formulas`, else the slot's default). */
export function fillPythonTemplate(template: string, formulas?: Record<string, Input>, options?: {
    globals?: string[]; functions?: string[]; numpy?: boolean; sympy?: boolean; errors?: 'raise' | 'nan';
    /** The table's header, for slots with a `: columns` parameter. */
    columns?: string[];
    /** Where the table is: the `# mathzetta-data:` line becomes DATA_FILE = "…". */
    data?: string;
}): string;
/** A variable's name in generated Python (keywords get a trailing underscore: lambda → lambda_). */
export function pythonName(name: string): string;

export interface ExcelOptions {
    /** name → cell reference ('B2'), as a map or a function. */
    cells?: Record<string, string> | ((name: string) => string | undefined);
    /** name → range ('B2:B101') for one-argument sum, mean, max, min, median, stdev, count. */
    ranges?: Record<string, string> | ((name: string) => string | undefined);
    /** Start with = (default true). */
    equals?: boolean;
    /** The spreadsheet functions f(…) may be written as (a list, or a test); any other is refused. */
    functions?: string[] | ((name: string) => boolean);
}
/** A spreadsheet formula for Excel and Google Sheets; throws `No spreadsheet formula for …` (∞, derivatives, sums to n). */
export function toExcel(input: Input, options?: ExcelOptions): string;
/** The formula as stored in an .xlsx file: newer functions get Excel's _xlfn. prefix, and no leading =. */
export function forXlsxFile(formula: string): string;

export type SqlDialect = 'postgres' | 'sqlite';
export interface SqlOptions {
    /** The functions f(…) may be written as (a list, or a test); any other is refused. */
    functions?: string[] | ((name: string) => boolean);
    /** 'postgres' (default) or 'sqlite'. SQLite throws `No SQLite SQL for '…'` for what it can't run. */
    dialect?: SqlDialect;
    /** Write variables as "double-quoted" identifiers. */
    quoteIdentifiers?: boolean;
    /** Quote for string literals; default: as typed (postgres), `'` (sqlite). */
    stringQuote?: string;
    /** Names that are always columns, even if they look like constants (`e`, `pi`). */
    columns?: Iterable<string>;
}
export function toSQL(input: Input, options?: SqlOptions): string;

/** A GLSL expression (floats throughout); GLSL_HELPERS supplies the mz_* functions it may call. */
export function toGLSL(input: Input, options?: { version?: 100 | 300 }): string;
export const GLSL_HELPERS: string;
/** A complete fragment shader applying expressions to every pixel; the filter format on top of it is the qblur package. */
export function filterShader(spec: string | { r?: string; g?: string; b?: string; a?: string; rgb?: string; rgba?: string }, options?: { version?: 100 | 300; names?: string[]; values?: string[]; uniforms?: Record<string, string>; blend?: boolean; images?: string[] | Record<string, { place?: string }>; space?: string }): string;
/** Color spaces a filter can work in ('srgb', 'linear', 'hsv', 'hsl', 'lab', 'oklab', 'ycbcr'); to<space>(c) / from<space>(c) convert. */
export const COLOR_SPACES: string[];
export const COLOR_FUNCTIONS: string[];
/** @deprecated COLOR_SPACES (the same array), its name until 1.1. */
export const COLOUR_SPACES: string[];
/** @deprecated COLOR_FUNCTIONS (the same array), its name until 1.1. */
export const COLOUR_FUNCTIONS: string[];
/** Pictures every filter has without declaring them: 'source' (the frame a chain started from) and 'selection' (white = selected). */
export const IMPLICIT_PICTURES: string[];
export function filterVertexShader(options?: { version?: 100 | 300 }): string;
/** Names an expression in a filter can use: px, py, rgb, gray, unchanged, pixel(), blur(), … */
export const FILTER_VALUES: string[];
export const FILTER_FUNCTIONS: string[];
export const FILTER_NAMES: string[];
export const NEIGHBORHOOD: string[];
/** @deprecated NEIGHBORHOOD (the same array), its name until 1.1. */
export const NEIGHBOURHOOD: string[];
export const GEOMETRY: string[];
export const PLACES: string[];
export const REACH: { square: number; line: number };
/** A filter expression's tree with its picture reads made explicit (mask(px, py), luma(mask), zoom(…)); shared by the GPU and CPU filter runners. */
export function filterPictureCalls(node: Node, pictures: Set<string>, options?: { whole?: boolean }): Node;

// ---- evaluation ------------------------------------------------------------------

/** A value in double precision, computed without running generated code. */
export function evaluate(input: Input, scope?: Record<string, unknown>): number | boolean | string | unknown[];

export interface CalculateOptions {
    /** Write the answer as a decimal. */
    decimal?: boolean;
    /** Round the written answer to this many decimal places. */
    places?: number;
    /** Significant digits for answers that aren't exact (12). */
    digits?: number;
    /** Longest whole number written out in full (50). */
    maxDigits?: number;
    /**
     * Complex results of real functions: √−4 = 2i, ln(−1) = iπ. Default: on when the input mentions i (which is
     * the imaginary unit unless the scope gives it a value). Arithmetic with i is complex either way.
     */
    complex?: boolean;
}
export interface Calculation {
    /**
     * The answer as plain JS: numbers, booleans, strings, arrays; a complex number as { re, im }; a polynomial
     * (unknowns, only added, multiplied and raised to whole powers) as its text, 'x^2 + 2*x + 1'.
     */
    value: number | boolean | string | unknown[] | { re: number; im: number };
    /** The answer as MathZetta-readable text: '1/2', '2*sqrt(2)', '(5*pi)/6', '3 - 2*i', 'x^2 + 2*x + 1'. */
    text: string;
    /** False when part of it is a rounded double. */
    exact: boolean;
}
/** Calculate exactly where possible (fractions, surds, π, standard angles), numerically otherwise. */
export function calculate(input: Input, scope?: Record<string, unknown>, options?: CalculateOptions): Calculation;
/** The text of a `{{...}}` block → what replaces it in the input. */
export function calculateBlock(text: string, scope?: Record<string, unknown>): string;
/** The math has no answer: 1/0, √−1, a divergent integral. */
export class MathError extends Error {}
/** It can't be worked out: an unset variable, an integral without limits. */
export class UnknownError extends Error {}

// ---- formulas over table columns -------------------------------------------------

export interface FormulaResult {
    success: boolean;
    error?: string;
    jsFunction?: string;
    sqlExpression?: string;
    postfixArray?: string[];
    types?: string[];
    unknownStrings: string[];
    mathMLOriginal?: string;
    mathMLSubbed?: string;
}
export type Selections = Map<string, { type: 'column' | 'integer' | 'float' | 'string'; value: string }>;
export function strToFunction(header: string[], formula: string, unknownStringSelections?: Selections): FormulaResult;
export function strToSQL(header: string[], formula: string, unknownStringSelections?: Selections, options?: { dialect?: SqlDialect; functions?: string[] | ((name: string) => boolean) }): FormulaResult;
/** A spreadsheet formula over columns: excelFormula(cellOf) writes it with each column as cellOf(index) — once per row. */
export function strToExcel(header: string[], formula: string, unknownStringSelections?: Selections, options?: { ranges?: (column: number) => string; functions?: string[] | ((name: string) => boolean) }):
    { success: true; excelFormula: (cellOf: (column: number) => string, rangeOf?: (column: number) => string | undefined) => string; tree: Node; postfixArray: string[]; types: string[]; unknownStrings: string[] }
    | { success: false; error: string; unknownStrings: string[] };
/** Compiles strToFunction's code — only after checkGeneratedJs passes it; refused code gives a function returning 'Error: …'. */
export function createRowEvaluator(jsCode: string): (row: unknown[]) => unknown;
/**
 * The gate in front of new Function: throws UnsafeCodeError unless the code is made only of numbers, "…" strings,
 * operators, the allowed names (`variables`, plus Math/Number/Array members the generator uses) — no other globals,
 * no computed members, no template literals.
 */
export function checkGeneratedJs(code: string, options?: { variables?: RegExp | Iterable<string>; indexable?: RegExp; strings?: boolean; keywords?: boolean }): string;
export function isSafeGeneratedJs(code: string, options?: { variables?: RegExp | Iterable<string>; indexable?: RegExp; strings?: boolean; keywords?: boolean }): boolean;
export class UnsafeCodeError extends Error {}

// ---- 'mathzetta/all' --------------------------------------------------------------

export interface Unified {
    latex: string;
    mathml: string;
    speech: string;
    glsl: string;
    javascript: string;
    python: string;
    sql: string;
    exp: string;
    op: string;
    postfix: Postfix;
}
export function toUnified(input: Input): Unified;
export function convert(input: Input, format: 'javascript' | 'js' | 'python' | 'py' | 'latex' | 'tex' | 'mathml' | 'mml' | 'speech' | 'glsl' | 'sql' | 'excel' | 'sheets' | 'text'): string;
export function getMathMLIdMap(): Map<string, Unified>;
export function resetIdTracking(): void;
export const MathZetta: Record<string, unknown>;
export default function mathZetta(expression: string, format?: Parameters<typeof convert>[1]): string;
