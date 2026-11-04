// Expression nodes and postfix parsing.
//
// Nodes are immutable. Every node caches `s`, its canonical postfix string,
// which doubles as a structural identity: two subtrees are structurally equal
// exactly when their `s` matches. That makes same-slot checks, cycle detection
// and memo keys all string compares.

import { getOperator, isOperator, VARIADIC } from './ops.js';

export const NUM = 'num';
export const SYM = 'sym';
export const OP = 'op';

const NO_ARGS = Object.freeze([]);

export class ExprError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExprError';
  }
}

/** Canonical text for a numeric value, so `3.0` and `3` unify. */
export function numToken(v) {
  if (Object.is(v, -0)) return '0';
  return String(v);
}

export function num(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExprError(`not a finite number: ${value}`);
  }
  const s = numToken(value);
  return Object.freeze({ type: NUM, token: s, value, args: NO_ARGS, s });
}

export function sym(token) {
  if (typeof token !== 'string' || token === '') {
    throw new ExprError('symbol needs a non-empty token');
  }
  return Object.freeze({ type: SYM, token, value: null, args: NO_ARGS, s: token });
}

/**
 * A number written exactly, as a decimal token of any length ("123456789012345678901", "-0.125").
 * `value` is the nearest double; `token` (and so `s`) keeps every digit, so big exact
 * results (2^100) survive. Spellings are normalised: "3.0" and "3", "-0" and "0" are one token.
 */
export function exactNum(token) {
  const m = /^(-?)0*(\d+?)(?:\.(\d*?)0*)?$/.exec(String(token));
  if (!m) throw new ExprError(`not an exact decimal: ${token}`);
  const [, sign, whole, part = ''] = m;
  const body = part ? `${whole}.${part}` : whole;
  const s = /^0(\.0*)?$/.test(body) ? '0' : sign + body;
  return Object.freeze({ type: NUM, token: s, value: Number(s), args: NO_ARGS, s });
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Build a leaf from a raw token, classifying numbers automatically. */
export function leaf(token) {
  const t = String(token);
  if (DECIMAL.test(t)) return exactNum(t);
  if (t !== '' && !/\s/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return num(n);
  }
  return sym(t);
}

export function op(symbol, args) {
  const def = getOperator(symbol);
  if (!def) throw new ExprError(`unknown operator "${symbol}"`);
  if (def.arity !== VARIADIC && args.length !== def.arity) {
    throw new ExprError(`"${symbol}" takes ${def.arity} operand(s), got ${args.length}`);
  }
  const frozen = Object.freeze(args.slice());
  // A variadic operator writes its operand count before itself: `a b c 3 max`.
  const count = def.arity === VARIADIC ? ` ${frozen.length}` : '';
  const s = `${frozen.length ? frozen.map((a) => a.s).join(' ') : ''}${frozen.length ? '' : ''}${count} ${symbol}`.trimStart();
  return Object.freeze({ type: OP, op: symbol, token: symbol, value: null, args: frozen, s });
}

export const isNum = (n) => n.type === NUM;
export const isSym = (n) => n.type === SYM;
export const isOp = (n) => n.type === OP;
export const isLeaf = (n) => n.type !== OP;
export const equal = (a, b) => a.s === b.s;

export function tokenize(text) {
  const t = String(text).trim();
  return t === '' ? [] : t.split(/\s+/);
}

/**
 * Parse whitespace-separated postfix. Operands may be any token that is not a
 * registered operator, so `x`, `3`, `-2`, and `theta` all work.
 */
export function parse(text) {
  return fromPostfix(tokenize(text));
}

/**
 * Read postfix tokens — what MathZetta's parse() returns — into a tree.
 * Variadic operators take their operand count from the token before them.
 */
export function fromPostfix(tokens) {
  if (!Array.isArray(tokens)) throw new ExprError('fromPostfix needs an array of tokens');
  if (tokens.length === 0) throw new ExprError('empty expression');
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = String(tokens[i]);
    if (isOperator(tok)) {
      let arity = getOperator(tok).arity;
      if (arity === VARIADIC) {
        const counter = stack.pop();
        arity = counter && counter.type === NUM && Number.isInteger(counter.value) && counter.value >= 0 ? counter.value : -1;
        if (arity < 0) throw new ExprError(`"${tok}" at position ${i + 1} takes any number of operands, so a count must come before it`);
      }
      if (stack.length < arity) {
        throw new ExprError(`"${tok}" at position ${i + 1} needs ${arity} operand(s), only ${stack.length} on the stack`);
      }
      const args = stack.splice(stack.length - arity, arity);
      stack.push(op(tok, args));
    } else {
      stack.push(leaf(tok));
    }
  }
  if (stack.length !== 1) {
    // Almost always a token that was meant to be an operator but is not
    // registered, so it got read as an operand instead. Say which.
    const operands = [...new Set(tokens.filter((t) => !isOperator(t)))];
    throw new ExprError(
      `expression leaves ${stack.length} values on the stack; it should leave exactly 1. `
      + `Read as operands: ${operands.join(', ')} — is one of those meant to be an operator?`,
    );
  }
  return stack[0];
}

/** Canonical postfix text. */
export function format(node) {
  return node.s;
}

export function depth(node) {
  if (node.type !== OP) return 0;
  let d = 0;
  for (const a of node.args) d = Math.max(d, depth(a));
  return d + 1;
}

export function nodeCount(node) {
  if (node.type !== OP) return 1;
  let n = 1;
  for (const a of node.args) n += nodeCount(a);
  return n;
}

/** Every leaf token in the subtree, in left-to-right order (with repeats). */
export function leafTokens(node, out = []) {
  if (node.type !== OP) out.push(node.token);
  else for (const a of node.args) leafTokens(a, out);
  return out;
}

/** True when the subtree contains no symbols: a constant (2 3 +, 1 sin, random), whether or not it folds to a number. */
export function isNumeric(node) {
  if (node.type === NUM) return true;
  if (node.type === SYM) return false;
  return node.args.every(isNumeric);
}

/**
 * Visit every node. `order` is 'pre' (root first, outermost rewrites) or
 * 'post' (leaves first, innermost rewrites).
 */
export function walk(node, order = 'pre', path = [], out = []) {
  if (order === 'pre') out.push({ node, path });
  for (let i = 0; i < node.args.length; i++) {
    walk(node.args[i], order, path.concat(i), out);
  }
  if (order === 'post') out.push({ node, path });
  return out;
}

export function at(root, path) {
  let cur = root;
  for (const i of path) {
    if (!cur.args[i]) throw new ExprError(`bad path [${path.join(',')}]`);
    cur = cur.args[i];
  }
  return cur;
}

/** Structural replace; rebuilds only the nodes along `path`. */
export function replaceAt(root, path, next) {
  if (path.length === 0) return next;
  const [i, ...rest] = path;
  const args = root.args.slice();
  args[i] = replaceAt(args[i], rest, next);
  return op(root.op, args);
}
