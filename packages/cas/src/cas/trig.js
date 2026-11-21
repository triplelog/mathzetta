// Trigonometric identities, as more shapes for simplify() to choose from (the shortest is kept):
//
//   1. everything in sin and cos: tan = sin/cos, sec = 1/cos, csc = 1/sin, cot = cos/sin, and the double angles
//      sin 2u = 2 sin u cos u, cos 2u = cos²u − sin²u
//   2. one fraction, with each sin u and cos u an unknown of a polynomial
//   3. sin² + cos² = 1: every sin² written as 1 − cos² (one shape), or every cos² as 1 − sin² (another)
//   4. cancel, put sin and cos back, and name what is left (sin/cos is tan, 1/cos² is sec² …)
//   5. and, from 3, the double angles taken the other way: 2 sin u cos u = sin 2u, cos² − sin² = cos 2u,
//      sin² = (1 − cos 2u)/2, cos² = (1 + cos 2u)/2, where that leaves no single sin or cos behind
//
// tan x cos x → sin x, sec²x − tan²x → 1, sin 2x/(2 sin x) → cos x, sin⁴x − cos⁴x → −cos 2x,
// sin x/(1 + cos x) + (1 + cos x)/sin x → 2 csc x.

import { op, sym, isOp, isNum, exactNum } from '../expr.js';
import { canon, display, normal, add, mul, termsOf, N, Q } from './form.js';
import { expand, coefficients, together, cancel, drawFactored } from './poly.js';
import { substitute } from './solve.js';
import { rewrite } from './rules.js';

const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);
const MAX_TERMS = 200;
const two = () => exactNum('2');

/** The other shapes of node that the identities give (display nodes), or [] when it has no trig in it. */
export function trigShapes(cas, node) {
  if (!hasTrig(node)) return [];
  let atoms;
  let x;
  try {
    const sc = toSinCos(node);
    atoms = new Map();   // argument (its .s) → { u, s, c }: the unknowns standing for sin u and cos u
    const named = replaceAtoms(sc, atoms);
    x = together(canon(named));
  } catch {
    return [];
  }
  const out = [];
  // three ways with sin² + cos² = 1: every sin² written in cos, every cos² in sin, or neither (so cos² − sin² can factor)
  for (const mode of ['sin', 'cos', 'none']) {
    try {
      const num = mode === 'none' ? expand(x.num) : reduce(x.num, atoms, mode);
      const den = mode === 'none' ? expand(x.den) : reduce(x.den, atoms, mode);
      if (!num || !den) continue;
      const shapes = [over(num, den)];
      const halved = [halfAngles(num, atoms), halfAngles(den, atoms)];
      if (halved[0] && halved[1]) shapes.push(over(halved[0], halved[1]));
      for (const shape of shapes) out.push(name(cas, back(shape, atoms)));
    } catch {
      /* this shape doesn't come out: the others still may */
    }
  }
  return out;
}

const hasTrig = (n) => isOp(n) && (TRIG.has(n.op) || n.args.some(hasTrig));

/** tan, sec, csc and cot as sin and cos; sin 2u and cos 2u as the base angle's. */
function toSinCos(n) {
  if (!isOp(n)) return n;
  const args = n.args.map(toSinCos);
  const [u] = args;
  const sin = (a) => op('sin', [a]);
  const cos = (a) => op('cos', [a]);
  const half = (a) => (isOp(a) && a.op === '*' && isNum(a.args[0]) && Number(a.args[0].value) === 2 ? (a.args.length === 2 ? a.args[1] : op('*', a.args.slice(1))) : null);
  switch (n.op) {
    case 'tan': return op('/', [sin(u), cos(u)]);
    case 'sec': return op('/', [exactNum('1'), cos(u)]);
    case 'csc': return op('/', [exactNum('1'), sin(u)]);
    case 'cot': return op('/', [cos(u), sin(u)]);
    case 'sin': { const h = half(u); return h ? op('*', [op('*', [two(), sin(h)]), cos(h)]) : sin(u); }
    case 'cos': { const h = half(u); return h ? op('-', [op('^', [cos(h), two()]), op('^', [sin(h), two()])]) : cos(u); }
    default: return op(n.op, args);
  }
}

/** sin u → $sN, cos u → $cN: unknowns of a polynomial, one pair for each argument. */
function replaceAtoms(n, atoms) {
  if (!isOp(n)) return n;
  if ((n.op === 'sin' || n.op === 'cos') && !hasTrig(n.args[0])) {
    const u = n.args[0];
    if (!atoms.has(u.s)) atoms.set(u.s, { u, s: `$s${atoms.size}`, c: `$c${atoms.size}` });
    const a = atoms.get(u.s);
    return sym(n.op === 'sin' ? a.s : a.c);
  }
  return op(n.op, n.args.map((m) => replaceAtoms(m, atoms)));
}

/** sin² + cos² = 1 in a polynomial: each sinᵏ with k ≥ 2 as sinᵏ⁻²(1 − cos²) (mode 'sin'), or each cosᵏ (mode 'cos'). */
function reduce(p, atoms, mode) {
  let x = expand(p);
  for (const { s, c } of atoms.values()) {
    const [high, other] = mode === 'sin' ? [s, c] : [c, s];
    const cs = coefficients(x, high);
    if (!cs) return null;
    const terms = [];
    for (const [d, coef] of cs) {
      const k = Math.floor(d / 2);
      const parts = [coef];
      if (d % 2) parts.push(canon(sym(high)));
      if (k) parts.push(canon(op('^', [op('-', [exactNum('1'), op('^', [sym(other), two()])]), exactNum(String(k))])));
      terms.push(mul(parts));
    }
    x = expand(add(terms));
    if (termsOf(x).length > MAX_TERMS) return null;
  }
  return x;
}

/**
 * The double angles the other way, in a polynomial of degree 2 or less in each sin u, cos u (and no single one):
 * sin u cos u = sin 2u / 2, sin²u = (1 − cos 2u)/2, cos²u = (1 + cos 2u)/2. null when it doesn't apply.
 */
function halfAngles(p, atoms) {
  let x = expand(p);
  for (const { u, s, c } of atoms.values()) {
    const S = op('sin', [op('*', [two(), u])]);
    const C = op('cos', [op('*', [two(), u])]);
    const terms = [];
    for (const t of termsOf(x)) {
      const node = display(t);
      const ds = degreeIn(node, s);
      const dc = degreeIn(node, c);
      if (ds + dc === 0) { terms.push(t); continue; }
      if (ds + dc !== 2) return null;   // a single sin or cos (or a higher power): not this shape
      const rest = substitute(substitute(node, s, exactNum('1')), c, exactNum('1'));
      const replaced = ds === 1 ? op('/', [S, two()]) : ds === 2 ? op('/', [op('-', [exactNum('1'), C]), two()]) : op('/', [op('+', [exactNum('1'), C]), two()]);
      terms.push(canon(op('*', [rest, replaced])));
    }
    x = expand(add(terms));
  }
  return x;
}

function degreeIn(node, v) {
  const cs = coefficients(canon(node), v);
  return cs ? Math.max(0, ...cs.keys()) : 0;
}

/** num/den, common factors canceled. */
function over(num, den) {
  const whole = canon(op('/', [display(num), display(den)]));
  const c = cancel(whole);
  return c ? drawFactored(c) : display(whole);
}

/** The unknowns back to sin u and cos u. */
function back(node, atoms) {
  let n = node;
  for (const { u, s, c } of atoms.values()) n = substitute(substitute(n, s, op('sin', [u])), c, op('cos', [u]));
  return normal(n);
}

/** What is left named: sin/cos is tan (the simplify rules), 1/cosⁿ is secⁿ, 1/sinⁿ is cscⁿ; then the simplify rules. */
function name(cas, node) {
  const rename = (n) => {
    if (!isOp(n)) return n;
    const args = n.args.map(rename);
    if (n.op === '/' && isNum(args[0])) {
      const below = args[1];
      const [base, power] = isOp(below) && below.op === '^' && isNum(below.args[1]) ? [below.args[0], below.args[1]] : [below, null];
      const partner = isOp(base) && { cos: 'sec', sin: 'csc' }[base.op];
      if (partner) {
        const named = op(partner, base.args);
        const powered = power ? op('^', [named, power]) : named;
        return Number(args[0].value) === 1 ? powered : op('*', [args[0], powered]);
      }
    }
    return op(n.op, args);
  };
  const named = rewrite(normal(rename(node)), cas.set.view('simplify'), { format: cas.format }).node;
  // fractions over one denominator, as one fraction where that is shorter: 1/(x² + 1) − x²/(x² + 1) is (1 − x²)/(x² + 1)
  try {
    const { num, den } = together(canon(named));
    const one = normal(op('/', [display(num), display(den)]));
    return one.s.split(' ').length < named.s.split(' ').length ? one : named;
  } catch {
    return named;
  }
}

export { N, Q };
