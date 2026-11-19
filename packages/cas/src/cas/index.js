// @mathzetta/cas/cas — a small computer algebra system on @mathzetta/cas's rules.
//
//   import { createCAS } from '@mathzetta/cas';
//   const cas = createCAS();                       // the shipped rules (rules/calculus.yaml, rules/cas/*.yaml)
//   cas.simplify('x x + 2 *').text                  '4x'
//   cas.diff('x 3 ^', 'x').text                     '3x^2'
//   cas.solve('x 2 ^ 5 x * - 6 + 0 =', 'x').text    'x = 2 or x = 3'
//   cas.integrate('x x sin *', 'x').text            '-x·cos(x) + sin(x)'
//   cas.approximate('2 sqrt', { digits: 50 }).text  '1.4142135623730950488016887242096980785696718753769'
//
// Input is MathZetta's postfix (a string, its tokens, or a @mathzetta/cas node); pass
// `read: (text) => parse(text)` (MathZetta's parse) to give it ordinary maths.
// Everything is exact (fractions of any size, √2, π stay as they are); ask for
// a decimal with approximate() or { approximate: digits } on any call.
//
// What it knows about functions is rules — YAML anyone can read, change or add
// to: createCAS({ rules: [myYaml] }) adds rules, and replaces the shipped rule
// with the same id. See rules/cas/simplify.yaml for the format.
//
// Each call returns its steps; { steps: 'brief' | false | { show, hide, explain } }
// picks which (see steps.js). The guide: docs/cas.md.

import { parse, fromPostfix, op, sym, isOp, walk, nodeCount } from '../expr.js';
import { canon, display, normal, freeSymbols, add, neg, CasError, withComplex } from './form.js';
import { readRuleDocs, buildRuleSet, rewrite, codedStep } from './rules.js';
import { stepOptions, selectSteps, DETAIL } from './steps.js';
import { expand as expandForm, factorForm, drawFactored, cancel as cancelForm, together as togetherForm } from './poly.js';
import { solveEquation, solveLinearSystem, substitute as substituteNode } from './solve.js';
import { antiderivative, definite } from './integrate.js';
import { approximate as approximateNode, approximateParts } from './approx.js';
import { toText } from './text.js';
import { DEFAULT_RULES, COMPLEX_RULES } from './default-rules.js';

/** How the CAS's own steps are worded. Override any of them with a `messages:` section in a rule file. */
export const MESSAGES = {
  normal: 'Work out the numbers and collect like terms.',
  'simplify.cancel': 'Cancel the factors the top and bottom share.',
  'simplify.expand': 'Multiplying out gives something shorter.',
  'simplify.factor': 'Factoring gives something shorter.',
  expand: 'Multiply out the brackets.',
  factor: 'Write it as a product of factors.',
  'factor.common': 'Take out the common factor {common}.',
  'factor.polynomial': 'Factor what is left: {roots}.',
  'together': 'Write it as one fraction over a common denominator.',
  cancel: 'Cancel the factors the top and bottom share: {cancelled}.',
  'solve.move': 'Keep the terms with {v} on the left and move the others to the right.',
  'solve.divide': 'Divide both sides by {by}.',
  'solve.multiply': 'Multiply both sides by {by}.',
  'solve.one-side': 'Move everything to one side, so the equation reads … = 0.',
  'solve.factor': 'Factor the left side.',
  'solve.zero-product': 'A product is 0 exactly when one of its factors is 0.',
  'solve.split': 'There are two cases; solve each.',
  'solve.quadratic': 'The quadratic formula with a = {a}, b = {b}, c = {c}: {v} = (-b ± √(b² - 4ac)) / 2a, and b² - 4ac = {D}.',
  'solve.no-real': 'b² - 4ac = {D} is negative, so there are no real solutions.',
  'solve.quadratic-complex': 'The quadratic formula with a = {a}, b = {b}, c = {c}: {v} = (-b ± √(b² - 4ac)) / 2a. b² - 4ac = {D} is negative, so its square root is imaginary: √({D}) = {root}.',
  'solve.roots': '{v}^{n} = {r} has {n} solutions, spaced evenly round a circle: |{r}|^(1/{n})·(cos θ + i sin θ), with θ = (arg {r} + 2πk)/{n} for k = 0 … {last}.',
  'solve.clear-denominator': 'Multiply both sides by {den} (an answer that makes it 0 is not allowed).',
  'solve.substitute': 'Write {u} for {kernel}: this is a polynomial in {u}.',
  'solve.reject': '{value} is not a solution: {reason}.',
  'solve.always': 'This is true for every {v}.',
  'solve.never': 'This is never true, so there is no solution.',
  'solve.unsolved': 'There is no exact method here for solving for {v}; try { approximate: true }.',
  'solve.numeric': 'Found {count} solution(s) numerically.',
  'system.eliminate': 'Use one equation to remove {v} from the others.',
  'integrate.expand': 'Multiply out, then integrate term by term.',
  'integrate.substitute': 'Let {u} = {inside}, so d{u} = {a} d{v}.',
  'integrate.back': 'Put {inside} back for {u}.',
  'integrate.parts': 'By parts with u = {u} and dv = {dv} d{v}: ∫ u dv = u·v - ∫ v du, where v = {V} and du = {du} d{v}.',
  'integrate.constant': 'The number {c} comes out of the integral.',
  'integrate.divide': 'The top has at least the degree of the bottom: divide first.',
  'integrate.partial-fractions': 'Split the fraction into simple fractions, one for each factor below.',
  'integrate.evaluate': 'Evaluate {F} at {b} and at {a}, and subtract.',
  substitute: 'Put in the values.',
};

/** The calls that run in the CAS's number mode (complex or real). */
const CALLS = ['normal', 'rewrite', 'simplify', 'expand', 'factor', 'cancel', 'diff', 'differentiate', 'integrate', 'solve', 'solveSystem', 'substitute', 'approximate', 'equivalent'];

class CAS {
  constructor(set, messages, format, read, complex) {
    this.set = set;
    this.messages = messages;
    this.format = format;
    this.read = read;
    this.complex = complex;
    for (const name of CALLS) {
      const call = CAS.prototype[name];
      this[name] = (...args) => withComplex(complex, () => call.apply(this, args));
    }
  }

  /** A string (postfix, or what `read` reads), tokens or a node → a node. */
  node(input) {
    return this.atPoints(this.read_(input));
  }

  read_(input) {
    if (input && typeof input === 'object' && !Array.isArray(input) && input.type) return input;
    if (Array.isArray(input)) return fromPostfix(input);
    if (typeof input !== 'string') throw new CasError('expected an expression');
    if (this.read) {
      const r = this.read(input);
      return Array.isArray(r) ? fromPostfix(r) : typeof r === 'string' ? parse(r) : r;
    }
    return parse(input);
  }

  /**
   * A derivative at a point, der(f, x = a) (MathZetta's `f x a = der`), worked out as it is read: d/dx f,
   * then a put in for x. Every method then meets an ordinary expression (the derivative rules' variable is
   * a name, never a point).
   */
  atPoints(node) {
    if (!node || !isOp(node) || !node.s.includes('= der')) return node;
    const args = node.args.map((a) => this.atPoints(a));
    const [f, point] = args;
    if (node.op === 'der' && isOp(point) && point.op === '=' && point.args[0].type === 'sym') {
      const x = point.args[0].token;
      return this.substitute(this.diff(f, x).result, { [x]: point.args[1].s }).result;
    }
    return op(node.op, args);
  }

  /** A step of the CAS's own (not a rule's), worded by MESSAGES. */
  step(id, name, tags, from, to, values = {}) {
    return codedStep(id, name, tags, from, to, this.messages[id] ?? '', values, this.format);
  }

  result(node, raw, options, extra = {}) {
    let out = node;
    if (options.approximate && out) {
      const digits = typeof options.approximate === 'number' ? options.approximate : 15;
      out = approximateParts(out, { digits });
    }
    return { result: out, text: out ? this.format(out) : '', steps: selectSteps(raw, stepOptions(options.steps)), ...extra };
  }

  /** The variable: the one given, or the only unknown, or x. */
  variable(node, v) {
    if (v && !/^\\?[A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF′]*$/.test(v)) {
      throw new CasError(`"${v}" is not a variable name; for a derivative at a point write der(f, x = a)`);
    }
    if (v) return v;
    const free = [...freeSymbols(node)];
    return free.length === 1 ? free[0] : free.includes('x') ? 'x' : free[0] ?? 'x';
  }

  tidyStep(from, to) {
    return from.s === to.s ? [] : [this.step('normal', 'Work out and collect', ['tidy', 'arithmetic'], from, to)];
  }

  /** The normal form (numbers worked out, like terms collected), no rules. */
  normal(input) {
    return normal(this.node(input));
  }

  /** Rewrite with the rules of one mode ('simplify', 'differentiate', 'expand-log', or your own). */
  rewrite(input, mode, options = {}) {
    const start = this.node(input);
    const view = this.set.view(mode);
    if (!view.size) throw new CasError(`no rules in mode "${mode}" (modes: ${this.set.modes().join(', ')})`);
    const r = rewrite(start, view, { format: this.format, order: options.order, variable: options.variable });
    return this.result(r.node, [...this.tidyStep(start, normal(start)), ...r.steps], options);
  }

  simplify(input, options = {}) {
    const start = this.node(input);
    const raw = [...this.tidyStep(start, normal(start))];
    const base = rewrite(start, this.set.view('simplify'), { format: this.format });
    raw.push(...base.steps);
    let best = base.node;
    let extra = null;
    // other shapes, kept only when shorter: cancelled, multiplied out, factored
    const x = canon(best);
    const tries = [];
    // a plain number (1/2 - i/2, √2 + 1) is not factored or cancelled
    const plain = freeSymbols(best).size === 0;
    const c = plain ? null : cancelForm(x);
    if (c) tries.push({ node: drawFactored(c), id: 'simplify.cancel', name: 'Cancel' });
    const ex = rewrite(display(expandForm(x)), this.set.view('simplify'), { format: this.format });
    tries.push({ node: ex.node, id: 'simplify.expand', name: 'Multiply out' });
    if (x.k === 'add' && !plain) tries.push({ node: drawFactored(factorForm(x)), id: 'simplify.factor', name: 'Factor' });
    for (const t of tries) {
      if (nodeCount(t.node) < nodeCount(best)) {
        extra = this.step(t.id, t.name, ['shorter'], best, t.node);   // the one step that names the shorter form
        best = t.node;
      }
    }
    if (extra) raw.push(extra);
    return this.result(best, raw, options);
  }

  expand(input, options = {}) {
    const start = this.node(input);
    const out = display(expandForm(canon(start)));
    return this.result(out, start.s === out.s ? [] : [this.step('expand', 'Multiply out', ['expand'], start, out)], options);
  }

  factor(input, options = {}) {
    const start = this.node(input);
    const f = factorForm(canon(start));
    const out = drawFactored(f);
    const raw = [];
    const common = f.notes.find((n) => n.id === 'factor.common');
    if (out.s !== normal(start).s) {
      raw.push(this.step(common ? 'factor.common' : 'factor', 'Factor', ['factor'], start, out, common ? { common: display(common.values.common) } : {}));
    }
    return this.result(out, raw, options);
  }

  /** One fraction, with common factors cancelled: (x² - 1)/(x - 1) → x + 1. */
  cancel(input, options = {}) {
    const start = this.node(input);
    const x = canon(start);
    const c = cancelForm(x);
    if (!c) return this.result(normal(start), this.tidyStep(start, normal(start)), options);
    const out = drawFactored(c);
    const t = togetherForm(x);
    const one = op('/', [display(t.num), display(t.den)]);
    const raw = [];
    if (start.op !== '/' || one.s !== normal(start).s) raw.push(this.step('together', 'One fraction', ['together'], start, one));
    if (out.s !== one.s) raw.push(this.step('cancel', 'Cancel', ['cancel'], one, out, { cancelled: c.cancelled.length ? c.cancelled.map((b) => this.format(display(b))).join(', ') : 'numbers' }));
    return this.result(out, raw, options);
  }

  /** d/dv, order times. */
  diff(input, v, options = {}) {
    const start = this.node(input);
    const variable = this.variable(start, v);
    // one derivative at a time, tidied before the next: the outer derivative's rules then see a
    // finished expression (d/dx x is 1 before the product rule meets it)
    let node = start;
    const raw = [];
    for (let i = 0; i < (options.order ?? 1); i++) {
      const r = rewrite(op('der', [node, sym(variable)]), this.set.view('differentiate'), { format: this.format, order: 'pre' });
      const tidy = rewrite(r.node, this.set.view('simplify'), { format: this.format });
      raw.push(...r.steps, ...tidy.steps);
      node = tidy.node;
    }
    return this.result(node, raw, options, { variable });
  }

  /** The derivative node alone (for by-parts and other internal use). */
  differentiate(node, v) {
    const r = rewrite(op('der', [node, sym(v)]), this.set.view('differentiate'), { format: this.format, order: 'pre' });
    return rewrite(r.node, this.set.view('simplify'), { format: this.format }).node;
  }

  /**
   * ∫ input dv; { from, to } for a definite integral, { constant: 'C' } to add + C.
   * An `int` node (∫ x² dx as MathZetta writes it, with or without limits) is read as such.
   */
  integrate(input, v, options = {}) {
    let start = this.node(input);
    // a limit is a number, postfix text, tokens or a node
    const limit = (x) => (x === undefined ? null : this.node(typeof x === 'number' ? String(x) : x));
    let from = limit(options.from);
    let to = limit(options.to);
    if (isOp(start) && start.op === 'int') {
      const [f, w, a, b] = start.args;
      v = w.token;
      if (a && b) { from = a; to = b; }
      start = f;
    }
    const variable = this.variable(start, v);
    const F = antiderivative(this, start, variable);
    const tidy = rewrite(F.node, this.set.view('simplify'), { format: this.format });
    const raw = [...F.steps, ...tidy.steps];
    if (from && to) {
      const d = definite(this, tidy.node, variable, from, to, start);
      raw.push(d.step);
      const value = rewrite(d.value, this.set.view('simplify'), { format: this.format });
      raw.push(...value.steps);
      return this.result(value.node, raw, options, { antiderivative: tidy.node, variable });
    }
    let out = tidy.node;
    if (options.constant) out = op('+', [out, sym(String(options.constant))]);
    return this.result(out, raw, options, { variable });
  }

  /**
   * Solve an equation (or expression = 0) for v.
   * @returns {{ solutions: node[], result: node|null, text, steps, unsolved }}
   *   result: x = 2 (or x = 2 or x = 3), null when there are none
   */
  solve(input, v, options = {}) {
    const start = this.node(input);
    const variable = this.variable(start, v);
    const s = solveEquation(this, start, variable, options);
    let solutions = s.solutions;
    if (options.approximate) {
      const digits = typeof options.approximate === 'number' ? options.approximate : 15;
      solutions = solutions.map((n) => approximateParts(n, { digits }));
    }
    const eqs = solutions.map((n) => op('=', [sym(variable), n]));
    const result = eqs.length ? eqs.reduce((acc, e) => (acc ? op('|', [acc, e]) : e), null) : null;
    return {
      solutions, result, variable,
      text: s.always ? `true for every ${variable}` : result ? this.format(result) : s.unsolved.length ? `no exact solution found for ${variable}` : 'no solution',
      unsolved: s.unsolved.filter((e) => !e.always), always: s.always,
      steps: selectSteps(s.steps, stepOptions(options.steps)),
    };
  }

  /** Linear equations in several unknowns. */
  solveSystem(equations, vars, options = {}) {
    const nodes = equations.map((e) => this.node(e));
    const unknowns = vars ?? [...new Set(nodes.flatMap((n) => [...freeSymbols(n)]))].sort();
    const s = solveLinearSystem(this, nodes, unknowns);
    const solution = s.solution ? Object.fromEntries([...s.solution].map(([k, n]) => [k, n])) : null;
    const text = s.status === 'one' ? unknowns.map((k) => `${k} = ${this.format(solution[k])}`).join(', ') : s.status === 'none' ? 'no solution' : 'infinitely many solutions';
    return { solution, status: s.status, text, steps: selectSteps(s.steps, stepOptions(options.steps)) };
  }

  /** Put values in ({ x: 2 } or { x: 'y 1 +' }) and simplify. */
  substitute(input, values, options = {}) {
    const start = this.node(input);
    let node = start;
    for (const [k, v] of Object.entries(values)) node = substituteNode(node, k, typeof v === 'number' ? this.node(String(v)) : this.node(v));
    const r = this.simplify(node, options);
    const raw = [this.step('substitute', 'Substitute', ['substitute'], start, node)];
    return { ...r, steps: [...selectSteps(raw, stepOptions(options.steps)), ...r.steps] };
  }

  /** Functions defined by rules (mode: define, e.g. sinc u → sin u / u) written out, so they have values. */
  defined(node) {
    const view = this.set.view('define');
    return view.size ? rewrite(node, view, { format: this.format }).node : node;
  }

  /** A decimal to `digits` significant figures (default 15; any number of digits). */
  approximate(input, options = {}) {
    const node = this.defined(this.node(input));
    if (freeSymbols(node).size && !options.scope) {
      const out = approximateParts(normal(node), options);
      return { result: out, text: this.format(out), number: null, exact: false };
    }
    const r = approximateNode(node, options);
    return { result: r.node, text: r.text, number: r.number, re: r.re, im: r.im, exact: r.exact };
  }

  /** Are a and b the same? { equal, how: 'exact' | 'numeric' }. */
  equivalent(a, b) {
    const A = this.node(a);
    const B = this.node(b);
    const difference = this.defined(op('-', [A, B]));
    const s = this.simplify(difference, { steps: false }).result;
    if (s.type === 'num' && s.token === '0') return { equal: true, how: 'exact' };
    const vars = [...freeSymbols(difference)];
    if (!vars.length) {
      try { return { equal: Math.abs(approximateNode(difference, { digits: 30 }).number) < 1e-25, how: 'numeric' }; } catch { return { equal: false, how: 'numeric' }; }
    }
    const points = [0.31, 1.7, 2.9, -0.83, 0.57];
    let tested = 0;
    for (let i = 0; i < points.length; i++) {
      const scope = Object.fromEntries(vars.map((v, j) => [v, String(points[(i + j) % points.length] + j / 7)]));
      let d;
      try { d = approximateNode(difference, { digits: 30, scope }).number; } catch { continue; }
      tested++;
      if (Math.abs(d) > 1e-20) return { equal: false, how: 'numeric' };
    }
    return { equal: tested > 0, how: 'numeric' };
  }

  /** Mode names in the rule set. */
  modes() {
    return this.set.modes();
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.complex] i is the imaginary unit: √-4 = 2i, x² + 1 = 0 has solutions,
 *   Re, Im, conj, arg, Euler's formula (unknowns still count as real)
 * @param {Array<string|object>} [options.rules] rule files (YAML text or parsed) added after the shipped ones
 * @param {boolean} [options.defaults] include the shipped rules (default true)
 * @param {(node) => string} [options.format] how parts are written in explanations and `text`
 * @param {(text: string) => string[]|object} [options.read] how a string input is read (default: postfix)
 */
export function createCAS(options = {}) {
  const shipped = options.defaults === false ? [] : [...DEFAULT_RULES, ...(options.complex ? COMPLEX_RULES : [])];
  const { specs, messages } = readRuleDocs([...shipped, ...(options.rules ?? [])]);
  const set = withComplex(options.complex, () => buildRuleSet(specs));
  return new CAS(set, { ...MESSAGES, ...messages }, options.format ?? toText, options.read ?? null, Boolean(options.complex));
}

export { CasError, DETAIL, toText, DEFAULT_RULES, COMPLEX_RULES };
export { approximateNode as approximate };
