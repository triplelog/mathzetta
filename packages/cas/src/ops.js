// Operator registry.
//
// Every token that appears in a postfix expression is either a registered
// operator (with a known arity) or an operand. Arity has to be known up front
// because postfix is otherwise ambiguous.
//
// The names and arities are MathZetta's (mathzetta/docs/postfix.md), so
// MathZetta's postfix is read and written as is: `der` for d/dx, `e u ^` for
// e^u, `neg` for unary minus. Variadic operators (max, sum, int, lim, …)
// follow a count token — `a b c 3 max` — and user-defined functions are
// `\:name` with a count: `x y 2 \:f` is f(x, y).
//
// `fold` is optional. It returns a number when the operation can be collapsed
// to an exact value, or null when it should be left alone. Returning null is
// how we keep 1/3 and sqrt(2) from turning into float soup.

const registry = new Map();

/** Arity of operators that take any number of operands (a count token precedes them). */
export const VARIADIC = -1;

/** Prefix of user-defined function tokens: `\:f`. */
export const CUSTOM_PREFIX = '\\:';
export const isCustomFunction = (token) =>
  typeof token === 'string' && token.startsWith(CUSTOM_PREFIX) && token.length > CUSTOM_PREFIX.length;

/**
 * @param {object} spec
 * @param {string} spec.symbol      token as it appears in expressions
 * @param {number} spec.arity       number of operands popped from the stack
 * @param {boolean} [spec.commutative]  args may be swapped (arity 2 only)
 * @param {(...args: number[]) => number|null} [spec.fold]
 * @param {string} [spec.label]     human name, used by the UIs
 */
export function defineOperator(spec) {
  if (!spec || !spec.symbol) throw new Error('operator needs a symbol');
  if (!Number.isInteger(spec.arity) || (spec.arity < 0 && spec.arity !== VARIADIC)) {
    throw new Error(`operator "${spec.symbol}" needs an integer arity >= 0, or VARIADIC`);
  }
  if (spec.commutative && spec.arity !== 2) {
    throw new Error(`only binary operators can be commutative ("${spec.symbol}")`);
  }
  const op = {
    symbol: spec.symbol,
    arity: spec.arity,
    commutative: !!spec.commutative,
    fold: typeof spec.fold === 'function' ? spec.fold : null,
    label: spec.label || spec.symbol,
  };
  registry.set(op.symbol, op);
  return op;
}

const CUSTOM = Object.freeze({ symbol: CUSTOM_PREFIX, arity: VARIADIC, commutative: false, fold: null, label: 'function' });

export function getOperator(symbol) {
  const found = registry.get(symbol);
  if (found) return found;
  return isCustomFunction(symbol) ? { ...CUSTOM, symbol, label: symbol.slice(CUSTOM_PREFIX.length) } : null;
}

export function isOperator(symbol) {
  return registry.has(symbol) || isCustomFunction(symbol);
}

export function operators() {
  return [...registry.values()];
}

export function clearOperators() {
  registry.clear();
}

const int = (n) => (Number.isFinite(n) && Number.isInteger(n) ? n : null);
const finite = (n) => (Number.isFinite(n) ? n : null);

export function defineDefaultOperators() {
  defineOperator({ symbol: '+', arity: 2, commutative: true, label: 'add', fold: (a, b) => finite(a + b) });
  defineOperator({ symbol: '-', arity: 2, label: 'subtract', fold: (a, b) => finite(a - b) });
  defineOperator({ symbol: '*', arity: 2, commutative: true, label: 'multiply', fold: (a, b) => finite(a * b) });
  // Only fold division when it stays exact, so 1/3 survives as a fraction.
  defineOperator({ symbol: '/', arity: 2, label: 'divide', fold: (a, b) => (b === 0 ? null : int(a / b)) });
  // Same idea for powers: keep 2^0.5 symbolic.
  defineOperator({
    symbol: '^',
    arity: 2,
    label: 'power',
    fold: (a, b) => (Number.isInteger(b) && Math.abs(b) <= 64 ? finite(a ** b) : null),
  });
  defineOperator({ symbol: 'neg', arity: 1, label: 'negate', fold: (a) => finite(-a) });
  defineOperator({ symbol: 'pm', arity: 1, label: 'plus or minus' });
  defineOperator({ symbol: '±', arity: 2, label: 'plus or minus' });
  defineOperator({ symbol: 'mod', arity: 2, label: 'modulo', fold: (a, b) => (b === 0 ? null : int(((a % b) + b) % b)) });
  defineOperator({ symbol: '!', arity: 1, label: 'factorial', fold: (n) => (Number.isInteger(n) && n >= 0 && n <= 18 ? [...Array(n).keys()].reduce((r, i) => r * (i + 1), 1) : null) });
  defineOperator({ symbol: '_', arity: 2, label: 'subscript' });
  // Differentiation is an operator in the expression language, not a function
  // the engine evaluates: `u v der` is d(u)/dv, and rules rewrite it away one
  // step at a time. It never folds. (Integrals and limits likewise.)
  defineOperator({ symbol: 'der', arity: 2, label: 'derivative' });
  defineOperator({ symbol: 'int', arity: VARIADIC, label: 'integral' });
  defineOperator({ symbol: 'lim', arity: VARIADIC, label: 'limit' });
  defineOperator({ symbol: '\\sumidx', arity: VARIADIC, label: 'sum over an index' });
  defineOperator({ symbol: '\\prodidx', arity: VARIADIC, label: 'product over an index' });
  defineOperator({ symbol: 'abs', arity: 1, label: 'absolute value', fold: (a) => finite(Math.abs(a)) });
  defineOperator({ symbol: 'floor', arity: 1, label: 'floor', fold: (a) => finite(Math.floor(a)) });
  defineOperator({ symbol: 'ceil', arity: 1, label: 'ceiling', fold: (a) => finite(Math.ceil(a)) });
  defineOperator({ symbol: 'round', arity: 2, label: 'round', fold: (x, d) => (Number.isInteger(d) ? finite(Math.round(x * 10 ** d) / 10 ** d) : null) });
  defineOperator({ symbol: 'fixed', arity: 2, label: 'fixed', fold: () => null });   // a text with d decimals: nothing to fold
  defineOperator({ symbol: 'sqrt', arity: 1, label: 'square root', fold: (a) => int(Math.sqrt(a)) });
  defineOperator({ symbol: 'root', arity: 2, label: 'nth root', fold: (n, x) => int(Math.round(x ** (1 / n)) ** n === x ? Math.round(x ** (1 / n)) : NaN) });
  // Transcendental results are irrational almost everywhere; never fold them.
  // There is no `exp`: e to a power is `e u ^`, as MathZetta writes it.
  for (const name of ['sin', 'cos', 'tan', 'csc', 'sec', 'cot', 'sinh', 'cosh', 'tanh',
    'arcsin', 'arccos', 'arctan', 'arcsinh', 'arccosh', 'arctanh', 'ln', 'loglog', 'logloglog', 'expm1']) {
    defineOperator({ symbol: name, arity: 1, label: name });
  }
  defineOperator({ symbol: 'log', arity: 2, label: 'log to a base' });
  defineOperator({ symbol: 'atan2', arity: 2, label: 'atan2' });
  defineOperator({ symbol: 'perm', arity: 2, label: 'permutations' });
  defineOperator({ symbol: 'comb', arity: 2, label: 'combinations' });
  defineOperator({ symbol: 'random', arity: 0, label: 'random' });
  for (const name of ['max', 'min', 'gcd', 'mean', 'sum', 'prod']) defineOperator({ symbol: name, arity: VARIADIC, label: name });
  // Groups: tuples, lists, sets, intervals.
  for (const name of ['()', '[]', '{}', '(]', '[)']) defineOperator({ symbol: name, arity: VARIADIC, label: 'group' });
  // Matrices: each operand a row ([] list); pmatrix ( ), bmatrix [ ], vmatrix | | (the determinant). Carried, not rewritten.
  for (const name of ['pmatrix', 'bmatrix', 'vmatrix']) defineOperator({ symbol: name, arity: VARIADIC, label: 'matrix' });
  // Comparisons, sets and logic are carried, not evaluated.
  for (const name of ['=', '===', '≠', '≠=', '<', '>', '≤', '≥', '∈', '∉', '∪', '∩', '≈', '≡', '→', 'pmod',
    '&', '|', '\\xor', '\\nand', '\\nor']) {
    defineOperator({ symbol: name, arity: 2, label: name });
  }
  defineOperator({ symbol: '\\not', arity: 1, label: 'not' });
  defineOperator({ symbol: '?:', arity: 3, label: 'if then else' });
}

defineDefaultOperators();
