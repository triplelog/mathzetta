// Requirement vocabulary.
//
// Rules constrain their operands with named predicates, never with code, so a
// rule file is pure data and importing someone else's ruleset is safe.
//
//   when:
//     a: [isNumber, [contains, "x"]]
//   require:
//     - [sameAs, a, b]
//
// A predicate entry is either "name" or ["name", ...args]. Predicates take one
// bound operand; relations take several (slot names resolve to their bound
// subtrees, anything else is passed through as a literal string).
//
// Predicates are conservative: anything not *provably* true is false. `x` is
// not provably non-zero, so isNonZero(x) is false. Where a rule wants the
// looser reading there are explicitly named alternatives.

import { NUM, SYM, OP, isNumeric, leafTokens } from './expr.js';

const predicates = new Map();
const relations = new Map();

export class RequirementError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequirementError';
  }
}

export function definePredicate(name, fn, doc = '') {
  // `arity` counts the extra arguments after the operand, e.g. contains("x").
  predicates.set(name, { name, fn, doc, arity: Math.max(0, fn.length - 1) });
}

export function defineRelation(name, fn, doc = '') {
  relations.set(name, { name, fn, doc });
}

export function getPredicate(name) {
  return predicates.get(name) || null;
}

export function getRelation(name) {
  return relations.get(name) || null;
}

export const predicateNames = () => [...predicates.keys()].sort();
export const relationNames = () => [...relations.keys()].sort();
export const predicateList = () => [...predicates.values()];
export const relationList = () => [...relations.values()];

const isN = (n) => n.type === NUM;

/* -- shape ------------------------------------------------------------- */
definePredicate('always', () => true, 'matches anything');
definePredicate('never', () => false, 'matches nothing');
definePredicate('isLeaf', (n) => n.type !== OP, 'a bare operand, not an operation');
definePredicate('isCompound', (n) => n.type === OP, 'an operation, not a bare operand');
definePredicate('isSymbol', (n) => n.type === SYM, 'a non-numeric operand such as x');
definePredicate('isOperation', (n, symbol) => n.type === OP && n.op === symbol, 'is this specific operation');
definePredicate('notOperation', (n, symbol) => !(n.type === OP && n.op === symbol), 'is anything except this operation');

/* -- numbers ------------------------------------------------------------ */
definePredicate('isNumber', isN, 'a numeric literal');
definePredicate('isInteger', (n) => isN(n) && Number.isInteger(n.value), 'a whole number');
definePredicate('isPositive', (n) => isN(n) && n.value > 0, 'greater than zero');
definePredicate('isNegative', (n) => isN(n) && n.value < 0, 'less than zero');
definePredicate('isNonNegative', (n) => isN(n) && n.value >= 0, 'zero or greater');
definePredicate('isZero', (n) => isN(n) && n.value === 0, 'exactly 0');
definePredicate('isOne', (n) => isN(n) && n.value === 1, 'exactly 1');
definePredicate('isNonZero', (n) => isN(n) && n.value !== 0, 'a number that is provably not 0');
definePredicate('isNotZeroLiteral', (n) => !(isN(n) && n.value === 0), 'anything except a literal 0');
definePredicate('isPositiveInteger', (n) => isN(n) && Number.isInteger(n.value) && n.value > 0, 'a whole number above 0');
definePredicate('isNegativeInteger', (n) => isN(n) && Number.isInteger(n.value) && n.value < 0, 'a whole number below 0');
definePredicate('isEven', (n) => isN(n) && Number.isInteger(n.value) && n.value % 2 === 0, 'a whole even number');
definePredicate('isOdd', (n) => isN(n) && Number.isInteger(n.value) && Math.abs(n.value % 2) === 1, 'a whole odd number');
definePredicate('greaterThan', (n, x) => isN(n) && n.value > Number(x), 'above a given value');
definePredicate('lessThan', (n, x) => isN(n) && n.value < Number(x), 'below a given value');
definePredicate('isValue', (n, x) => isN(n) && n.value === Number(x), 'equals a given number');

/* -- content ------------------------------------------------------------ */
definePredicate('isNumeric', isNumeric, 'contains no symbols: a constant (it need not fold to a number: 1 sin)');
definePredicate('hasSymbol', (n) => !isNumeric(n), 'mentions a symbol somewhere, so it is not just a number');
definePredicate('isVar', (n, name) => n.type === SYM && n.token === String(name), 'is exactly this symbol');
definePredicate('contains', (n, token) => leafTokens(n).includes(String(token)), 'mentions this operand somewhere');
definePredicate('isFree', (n, token) => !leafTokens(n).includes(String(token)), 'never mentions this operand');
definePredicate('hasOperation', (n, symbol) => hasOp(n, String(symbol)), 'uses this operation somewhere inside');
definePredicate('equals', (n, text) => n.s === String(text), 'is exactly this postfix expression');

function hasOp(n, symbol) {
  if (n.type !== OP) return false;
  if (n.op === symbol) return true;
  return n.args.some((a) => hasOp(a, symbol));
}

/* -- relations ---------------------------------------------------------- */

// `isFree` above takes a literal token. Differentiation rules instead need
// "free of whatever the *other* slot bound to", since the variable being
// differentiated against is itself a slot. Hence these two.
const varToken = (n) => (n.type === OP ? null : n.token);

defineRelation('freeOf', (expr, v) => {
  const token = varToken(v);
  return token !== null && !leafTokens(expr).includes(token);
}, 'the first operand never mentions the second');

defineRelation('dependsOn', (expr, v) => {
  const token = varToken(v);
  return token !== null && leafTokens(expr).includes(token);
}, 'the first operand does mention the second');

defineRelation('sameAs', (...nodes) => nodes.every((n) => n.s === nodes[0].s), 'these operands are structurally identical');
defineRelation('differs', (...nodes) => new Set(nodes.map((n) => n.s)).size === nodes.length, 'these operands are all different');
defineRelation('sameValue', (...nodes) => nodes.every((n) => isN(n)) && nodes.every((n) => n.value === nodes[0].value), 'these operands are the same number');

/**
 * Normalise a YAML predicate entry into `{ name, args }`.
 * Accepts "isZero" or ["contains", "x"].
 */
export function normalizeCheck(entry) {
  if (typeof entry === 'string') return { name: entry, args: [] };
  if (Array.isArray(entry) && entry.length > 0 && typeof entry[0] === 'string') {
    return { name: entry[0], args: entry.slice(1) };
  }
  throw new RequirementError(`bad requirement: ${JSON.stringify(entry)}`);
}
