// Building the replacement expression for a match.

import { op, num, exactNum, replaceAt, isOp, isNum } from './expr.js';
import { getOperator } from './ops.js';

/** Fill an output template's slots with the matched subtrees. */
export function instantiate(template, bound) {
  switch (template.kind) {
    case 'slot': {
      const node = bound[template.name];
      if (!node) throw new Error(`output references unbound slot "${template.name}"`);
      return node;
    }
    case 'const':
      return template.node;
    case 'op':
      return op(template.op, template.args.map((a) => instantiate(a, bound)));
    default:
      throw new Error(`bad output template: ${JSON.stringify(template)}`);
  }
}

/**
 * Collapse numeric subtrees bottom-up. Operators whose `fold` returns null
 * (1/3, sqrt(2), sin(1)) are left exactly as they are.
 */
export function foldNumeric(node) {
  if (!isOp(node)) return node;
  const args = node.args.map(foldNumeric);
  const changed = args.some((a, i) => a !== node.args[i]);
  const next = changed ? op(node.op, args) : node;
  const def = getOperator(next.op);
  if (!def || !def.fold || !next.args.every(isNum)) return next;
  // +, -, *, neg and whole powers are worked out on the exact decimal tokens, so 0.1 + 0.2 is 0.3
  // and 3^40 keeps every digit; the operator's own fold (doubles) is for everything else.
  if (EXACT.has(next.op)) {
    const token = exactFold(next.op, next.args.map((a) => a.token));
    if (token !== undefined) return token === null ? next : exactNum(token);
  }
  const value = def.fold(...next.args.map((a) => a.value));
  return value === null || value === undefined || !Number.isFinite(value) ? next : num(value);
}

/** Fill `{slot}` and `{result}` placeholders in a rule's explanation text. */
export function renderExplanation(rule, bound, result) {
  if (!rule.explain) return '';
  return rule.explain.replace(/\{(\w+)\}/g, (whole, name) => {
    if (name === 'result') return result ? result.s : whole;
    const node = bound[name];
    return node ? node.s : whole;
  });
}

/** The expression this match produces, without touching the surrounding tree. */
export function rewriteOf(match) {
  const built = instantiate(match.rule.outputTemplate, match.bound);
  return match.rule.fold ? foldNumeric(built) : built;
}

/**
 * Apply a match found by matchAll (it carries a `path`).
 * @returns {{expr, before, after, rule, path, explanation}}
 */
export function applyMatch(root, match) {
  const after = rewriteOf(match);
  return {
    expr: replaceAt(root, match.path, after),
    before: match.node,
    after,
    rule: match.rule,
    path: match.path,
    explanation: renderExplanation(match.rule, match.bound, after),
  };
}

// ---- exact decimal folding ------------------------------------------------------------------

const EXACT = new Set(['+', '-', '*', 'neg', '^']);
const MAX_DIGITS = 2000;   // a folded number longer than this stays as it was written

/** '-1.25' → { n: -125n, scale: 2 }; undefined for anything that isn't a plain decimal. */
function decimal(token) {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(token);
  if (!m) return undefined;
  const frac = m[3] ?? '';
  let n = BigInt(m[2] + frac);
  let scale = frac.length - Number(m[4] ?? 0);
  if (scale < 0) { n *= 10n ** BigInt(-scale); scale = 0; }
  return { n: m[1] ? -n : n, scale };
}

/** { n, scale } → the shortest decimal token ('0.3', '-12', '1206'). */
function toToken({ n, scale }) {
  const negative = n < 0n;
  let digits = (negative ? -n : n).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '');
  }
  return digits === '0' ? '0' : (negative ? '-' : '') + digits;
}

const align = (a, b) => {
  const scale = Math.max(a.scale, b.scale);
  return [a.n * 10n ** BigInt(scale - a.scale), b.n * 10n ** BigInt(scale - b.scale), scale];
};

/** 1 / x as an exact decimal, or null when it doesn't terminate (a factor other than 2 and 5). */
function reciprocal({ n, scale }) {
  if (n === 0n) return null;
  let rest = n < 0n ? -n : n;
  let twos = 0, fives = 0;
  while (rest % 2n === 0n) { rest /= 2n; twos++; }
  while (rest % 5n === 0n) { rest /= 5n; fives++; }
  if (rest !== 1n) return null;
  const m = Math.max(twos, fives);
  const top = 10n ** BigInt(scale) * 2n ** BigInt(m - twos) * 5n ** BigInt(m - fives);
  return { n: n < 0n ? -top : top, scale: m };
}

/**
 * The exact result as a token; null when it would be too long to keep (or the power isn't a
 * whole number from 0 to 64), undefined when an operand isn't a plain decimal (the operator's
 * own fold decides then).
 */
function exactFold(symbol, tokens) {
  const [a, b] = tokens.map(decimal);
  if (!a || (tokens.length > 1 && !b)) return undefined;
  let out;
  switch (symbol) {
    case 'neg': out = { n: -a.n, scale: a.scale }; break;
    case '+': { const [x, y, scale] = align(a, b); out = { n: x + y, scale }; break; }
    case '-': { const [x, y, scale] = align(a, b); out = { n: x - y, scale }; break; }
    case '*': out = { n: a.n * b.n, scale: a.scale + b.scale }; break;
    case '^': {
      if (b.scale !== 0 || b.n > 64n || b.n < -64n) return null;   // 2^0.5 stays as written
      const e = b.n < 0n ? -b.n : b.n;
      if ((a.n < 0n ? -a.n : a.n).toString().length * Number(e) > MAX_DIGITS) return null;
      const power = { n: a.n ** e, scale: a.scale * Number(e) };
      out = b.n < 0n ? reciprocal(power) : power;   // 2^-1 = 0.5; 3^-1 has no exact decimal
      if (!out) return null;
      break;
    }
    default: return undefined;
  }
  const token = toToken(out);
  return token.length > MAX_DIGITS ? null : token;
}
