/**
 * '@mathzetta/inlinemath/cas' — @mathzetta/cas in Inline Math: `{{…}}` blocks that simplify,
 * solve, differentiate …, and step lists drawn as math.
 *
 *   import { toHTML } from '@mathzetta/inlinemath';
 *   import { casBlocks, stepsHTML, mathCAS } from '@mathzetta/inlinemath/cas';
 *
 *   toHTML('f′(x) = {{diff(x^3 sin x, x)}}', { blocks: casBlocks() })
 *   toHTML('{{solve(x^2 - 5x + 6 = 0, x)}}', { blocks: casBlocks() })   // x = 2 or x = 3
 *   stepsHTML(mathCAS().diff('x^2 sin x', 'x', { steps: 'brief' }).steps)
 *
 * Block functions: simplify, expand, factor, cancel, diff(f, x[, n]) (or der, derivative,
 * differentiate), integrate(f, x[, a, b]) (or integral), solve(equation, x), approx(expr[, digits]);
 * d/dx … and ∫ … without limits go to the CAS too. In Markdown, saved variables ($_f := x^3$)
 * stand for their expressions: {{diff(f, x)}}. Everything else is MathZetta's calculator (calculateBlock), as without this.
 *
 * Needs @mathzetta/cas (a peer dependency, like mathzetta).
 */

import { createCAS, toText as plainText } from '@mathzetta/cas';
import { parse as parsePostfix } from '@mathzetta/cas/engine';
import { parse, operator } from './mathzetta.js';
import { calculateBlock } from './calculator.js';
// Only this entry needs MathZetta's text writer (so only pages using inlinemath/cas map 'mathzetta/text').
import { toText } from 'mathzetta/text';
import { toHTML } from './html.js';

const EXPRESSIONS = Symbol.for('inlinemath.expressions');   // as variables.js

const shared = new Map();

/** How the complex functions are written for MathZetta: Re z, Im z, z̄ (an overline), arg z. */
const DRAWN = { re: 'Re', im: 'Im', conj: 'overline' };
const COMPLEX_NAMES = ['Re', 'Im', 're', 'im', 'conj', 'arg'];

/**
 * A CAS node → MathZetta postfix tokens. Functions declared in a rule file
 * (sinc) are MathZetta's user functions: x sinc → x 1 \:sinc.
 */
export function tokensOf(node) {
  const out = [];
  const visit = (n) => {
    if (n.type !== 'op') { out.push(n.token); return; }
    n.args.forEach(visit);
    if (operator(n.op)) {
      if (operator(n.op).arity === -1) out.push(String(n.args.length));
      out.push(n.op);
    } else out.push(String(n.args.length), `\\:${DRAWN[n.op] ?? n.op}`);
  };
  visit(node);
  return out;
}

/**
 * A CAS that reads and writes MathZetta text. Options go to @mathzetta/cas's createCAS
 * (rules: your rule files; complex: true for i = √-1); `names` are functions of your
 * own, so `sinc(x)` is read as sinc and not as s·i·n·c(x). With complex, Re, Im,
 * conj and arg are read as functions too.
 */
export function mathCAS(options = {}) {
  const key = options.rules || options.names ? null : options.complex ? 'complex' : 'default';
  if (key && shared.has(key)) return shared.get(key);
  const names = [...(options.names ?? []), ...(options.complex ? COMPLEX_NAMES : [])];
  const cas = createCAS({
    ...options,
    read: (text) => parse(text, names.length ? { names } : {}),
    // explanations read "3x^2", "sin(3x)"; a block's answer is MathZetta text, so it is read back exactly
    format: plainText,
  });
  if (key) shared.set(key, cas);
  return cas;
}

const CALLS = new Set(['simplify', 'expand', 'factor', 'cancel', 'diff', 'integrate', 'solve', 'approx']);
// other names people write for them
const ALIASES = { integral: 'integrate', differentiate: 'diff', approximate: 'approx', simp: 'simplify' };

/**
 * A `{{…}}` handler: pass it as toHTML(input, { blocks: casBlocks() }).
 * @param {object} [options] { cas } a CAS of your own (mathCAS({ rules })); { steps } how much working each call
 *   keeps (the CAS's steps option: true, 'brief', false), read from the handler's `last` after a block
 */
export function casBlocks(options = {}) {
  const cas = options.cas ?? mathCAS();
  const how = options.steps === undefined ? {} : { steps: options.steps };
  const handler = (text, scope) => {
    let tokens;
    try {
      tokens = cas.read(text);
    } catch {
      return calculateBlock(text, scope);
    }
    // saved variables ($_f := x^3$ in Markdown) stand for their expressions: {{diff(f, x)}}
    const saved = scope && scope[EXPRESSIONS];
    if (saved) tokens = tokens.flatMap((t) => (Object.hasOwn(saved, t) ? saved[t] : [t]));
    const head = tokens[tokens.length - 1];
    const name = head?.startsWith('\\:') ? (ALIASES[head.slice(2)] ?? head.slice(2)) : null;
    const symbolic = name && CALLS.has(name);
    // d/dx …, ∫ … dx and ∫ from a to b … dx (MathZetta writes the limits as int's 3rd and 4th operands)
    const calculus = head === 'der' || head === 'int';
    if (!symbolic && !calculus) return calculateBlock(text, scope);
    const node = cas.node(tokens);
    // the CAS works a derivative at a point out as it reads it (der(f, x = a)): what arrives is the answer's expression
    const worked = calculus && node.op !== head;
    const args = symbolic ? node.args : [node];
    const word = (n) => (n ? n.s : undefined);
    // d/dx exactly; at a point (x = a, as der(f, x = a) and diff(f, x = a) write it), then a put in for x
    const derivative = (f, by, order) => {
      if (!(by && by.op === '=')) return cas.diff(f, word(by), { ...how, order });
      const name = by.args[0].s;
      const d = cas.diff(f, name, { ...how, order });
      const at = cas.substitute(d.result, { [name]: by.args[1].s }, how);
      return { ...at, steps: [...(d.steps ?? []), ...(at.steps ?? [])] };
    };
    let r;
    try {
      switch (worked ? 'simplify-read' : symbolic ? name : head === 'der' ? 'derivative' : 'antiderivative') {
        case 'simplify-read': r = cas.simplify(node, how); break;
        case 'simplify': r = cas.simplify(args[0], how); break;
        case 'expand': r = cas.expand(args[0], how); break;
        case 'factor': r = cas.factor(args[0], how); break;
        case 'cancel': r = cas.cancel(args[0], how); break;
        case 'diff': r = derivative(args[0], args[1], args[2] ? Number(args[2].s) : 1); break;
        case 'integrate': r = cas.integrate(args[0], word(args[1]), { ...how, ...(args[3] ? { from: args[2].s, to: args[3].s } : {}) }); break;
        case 'solve': r = cas.solve(args[0], word(args[1]), how); break;
        case 'approx': r = cas.approximate(args[0], { ...how, digits: args[1] ? Number(args[1].s) : 15 }); break;
        case 'derivative': r = derivative(node.args[0], node.args[1], 1); break;
        default: r = cas.integrate(node, undefined, how); break;
      }
    } catch (error) {
      // no answer: leave it as written, as calculateBlock does
      return `(${text})`;
    }
    handler.last = r;
    if (!r.result) return `"${r.text}"`;
    const out = toText(tokensOf(r.result));
    return /^-?\d+(\.\d+)?$/.test(out) ? out : `(${out})`;
  };
  return handler;
}

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Steps (from any CAS call) as an ordered list: each step's expression before,
 * with the part a rule rewrote highlighted, the expression after, and the
 * explanation. Options go to toHTML for both drawings (size, colors …).
 * @returns {string} <ol class="mv-steps">…</ol>
 */
export function stepsHTML(steps, options = {}) {
  const items = steps.map((s) => {
    const from = tokensOf(parsePostfix(s.from));
    const before = toHTML(from, { ...options, highlight: s.path && s.path.length ? { path: s.path } : undefined });
    const after = s.to === s.from ? '' : `<span class="mv-step-arrow" aria-label="becomes">⟶</span>${toHTML(tokensOf(parsePostfix(s.to)), options)}`;
    const why = s.explanation ? `<p class="mv-step-why">${escape(s.explanation)}</p>` : '';
    return `<li class="mv-step" data-rule="${escape(s.id)}"><span class="mv-step-name">${escape(s.name)}</span>`
      + `<div class="mv-step-maths">${before}${after}</div>${why}</li>`;
  });
  return `<ol class="mv-steps">${items.join('')}</ol>`;
}
