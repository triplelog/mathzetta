// The differentiation ruleset, and the mode machinery that keeps it separate
// from simplification.

import { readFileSync } from 'node:fs';
import { suite, test, equal, assert, deepEqual, throws } from './harness.js';
import { RuleSet, simplify, findMatches, parse, parseYaml, getRelation } from '../src/index.js';

function load(...files) {
  const rules = [];
  for (const f of files) {
    rules.push(...parseYaml(readFileSync(new URL(`../rules/${f}`, import.meta.url), 'utf8')).rules);
  }
  return RuleSet.fromSpecs(rules);
}

const all = load('arithmetic.yaml', 'calculus.yaml');
const D = all.view('differentiate');
const S = all.view('simplify');

/** Differentiate to completion, then tidy up — the two modes in sequence. */
const work = (text) => {
  const d = simplify(parse(text), D, { order: 'pre', maxSteps: 80 });
  const s = simplify(d.expr, S, { maxSteps: 80 });
  return { d, s, out: s.expr.s };
};

suite('modes', () => {
  test('splits the loaded rules into two independent rulesets', () => {
    deepEqual(all.modes(), ['simplify', 'differentiate']);
    equal(D.size + S.size, all.size);
    assert(D.size >= 15, `only ${D.size} differentiation rules`);
    assert(S.rules.every((r) => r.mode === 'simplify'));
    assert(D.rules.every((r) => r.mode === 'differentiate'));
  });

  test('each mode gets its own key index and depth cap', () => {
    assert(D.index.size > 0 && S.index.size > 0);
    equal(D.maxDepth, 2);
    equal(S.maxDepth, 2);
  });

  test('modes do not leak into one another', () => {
    // Simplification alone cannot touch a derivative...
    equal(findMatches(parse('x 2 ^ x der'), S).length, 0);
    // ...and differentiation alone will not fold plain arithmetic.
    equal(findMatches(parse('2 3 +'), D).length, 0);
  });

  test('views are cached but rebuilt when the rules change', () => {
    const set = load('calculus.yaml');
    assert(set.view('differentiate') === set.view('differentiate'), 'cached');
    assert(findMatches(parse('x sin x cos * x der'), set.view('differentiate'))[0].rule.id === 'd-product');
    set.setEnabled('d-product', false);
    assert(findMatches(parse('x sin x cos * x der'), set.view('differentiate')).length === 0,
      'the rebuilt view drops the disabled rule');
  });

  test('rules default to simplify mode when none is given', () => {
    equal(RuleSet.fromSpecs([{ id: 'a', pattern: 'a b +', output: 'a' }]).rules[0].mode, 'simplify');
  });

  test('mode survives a YAML round-trip', () => {
    const again = RuleSet.fromYaml(all.toYaml());
    deepEqual(again.modes(), all.modes());
    equal(again.view('differentiate').size, D.size);
  });
});

suite('freeOf / dependsOn', () => {
  const rel = (name, a, b) => getRelation(name).fn(parse(a), parse(b));

  test('answer against whatever the variable slot bound to', () => {
    equal(rel('freeOf', '3 y *', 'x'), true);
    equal(rel('freeOf', '3 x *', 'x'), false);
    equal(rel('dependsOn', 'x 2 ^ 1 +', 'x'), true);
    equal(rel('dependsOn', 'y 2 ^ 1 +', 'x'), false);
  });

  test('a compound "variable" is neither free nor depended on', () => {
    equal(rel('freeOf', 'x', 'x 1 +'), false);
    equal(rel('dependsOn', 'x', 'x 1 +'), false);
  });
});

suite('differentiation', () => {
  const cases = [
    // input                    after differentiating         after simplifying
    ['5 x der', '0', '0'],
    ['y x der', '0', '0'],
    ['x x der', '1', '1'],
    ['x 2 ^ x der', '2 x 1 ^ *', '2 x *'],
    ['x 3 ^ x der', '3 x 2 ^ *', '3 x 2 ^ *'],
    ['t 2 ^ t der', '2 t 1 ^ *', '2 t *'],
    ['x 2 ^ 3 x * + x der', '2 x 1 ^ * 3 1 * +', '2 x * 3 +'],
    ['y x * x der', 'y 1 *', 'y'],
    ['x y * x der', 'y 1 *', 'y'],
    ['x 2 / x der', '1 2 /', '1 2 /'],
    ['x sin x der', 'x cos 1 *', 'x cos'],
    ['x cos x der', 'x sin 1 * neg', 'x sin neg'],
    ['x sqrt x der', '1 2 x sqrt * /', '1 2 x sqrt * /'],
    ['e x ^ x der', 'e x ^ 1 *', 'e x ^'],
    ['2 x ^ x der', '2 x ^ 2 ln * 1 *', '2 x ^ 2 ln *'],
    ['x neg x der', '1 neg', '-1'],
    // the rest of the standard functions
    ['x csc x der', 'x csc x cot * 1 * neg', 'x csc x cot * neg'],
    ['x sec x der', 'x sec x tan * 1 *', 'x sec x tan *'],
    ['x cot x der', '1 x sin 2 ^ / neg', '1 x sin 2 ^ / neg'],
    ['x arcsin x der', '1 1 x 2 ^ - sqrt /', '1 1 x 2 ^ - sqrt /'],
    ['x arccos x der', '1 1 x 2 ^ - sqrt / neg', '1 1 x 2 ^ - sqrt / neg'],
    ['x arctan x der', '1 1 x 2 ^ + /', '1 1 x 2 ^ + /'],
    ['x sinh x der', 'x cosh 1 *', 'x cosh'],
    ['x cosh x der', 'x sinh 1 *', 'x sinh'],
    ['x tanh x der', '1 x cosh 2 ^ /', '1 x cosh 2 ^ /'],
    ['x arcsinh x der', '1 x 2 ^ 1 + sqrt /', '1 x 2 ^ 1 + sqrt /'],
    ['x arccosh x der', '1 x 2 ^ 1 - sqrt /', '1 x 2 ^ 1 - sqrt /'],
    ['x arctanh x der', '1 1 x 2 ^ - /', '1 1 x 2 ^ - /'],
    ['2 x log x der', '1 x 2 ln * /', '1 x 2 ln * /'],
    ['x abs x der', 'x x abs / 1 *', 'x x abs /'],
    ['3 x root x der', '1 3 3 x root 2 ^ * /', '1 3 3 x root 2 ^ * /'],
    // with the chain rule
    ['2 x * sec x der', '2 x * sec 2 x * tan * 2 1 * *', '2 x * sec 2 x * tan * 2 *'],
    ['x 2 ^ arctan x der', '2 x 1 ^ * 1 x 2 ^ 2 ^ + /', '2 x * 1 x 4 ^ + /'],
  ];

  for (const [input, differentiated, simplified] of cases) {
    test(`d(${input})`, () => {
      const { d, out } = work(input);
      equal(d.expr.s, differentiated, `differentiating stopped: ${d.stopped}`);
      equal(out, simplified, 'after simplifying');
    });
  }

  test('product rule turns one derivative into two smaller ones', () => {
    const first = simplify(parse('x 2 ^ x sin * x der'), D, { order: 'pre', maxSteps: 1 });
    equal(first.steps[0].ruleId, 'd-product');
    equal(first.expr.s, 'x 2 ^ x der x sin * x 2 ^ x sin x der * +');
    // One `der` before, two after — each wrapping something smaller.
    equal((parse('x 2 ^ x sin * x der').s.match(/ der\b/g) || []).length, 1);
    equal((first.expr.s.match(/ der\b/g) || []).length, 2);
  });

  test('a full product-rule derivation reads as four steps', () => {
    const { d, out } = work('x 2 ^ x sin * x der');
    deepEqual(d.steps.map((s) => s.ruleId), ['d-product', 'd-power-of-variable', 'd-sin', 'd-variable']);
    equal(out, '2 x * x sin * x 2 ^ x cos * +');
  });

  test('quotient rule', () => {
    equal(work('x 3 ^ x sin / x der').out, '3 x 2 ^ * x sin * x 3 ^ x cos * - x sin 2 ^ /');
  });

  test('chain rule through a log', () => {
    equal(work('x 2 ^ 1 + ln x der').out, '2 x * x 2 ^ 1 + /');
  });

  test('constant multiple outranks the product rule', () => {
    const m = findMatches(parse('3 x 2 ^ * x der'), D, { order: 'pre' });
    equal(m[0].rule.id, 'd-constant-multiple', `got ${m.map((x) => x.rule.id).join(', ')}`);
    equal(work('3 x 2 ^ * x der').out, '6 x *');
  });

  test('constant rule outranks the deeper structural rules', () => {
    // "_ _ D" is shallower than "_ _ ^ _ D", so only priority saves this.
    equal(findMatches(parse('2 3 ^ x der'), D, { order: 'pre' })[0].rule.id, 'd-constant');
    equal(work('2 3 ^ x der').out, '0');
  });

  test('power and exponential rules share a key and stay apart', () => {
    equal(findMatches(parse('x 2 ^ x der'), D)[0].rule.id, 'd-power-of-variable');
    equal(findMatches(parse('2 x ^ x der'), D)[0].rule.id, 'd-exponential-base');
    // Both base and exponent varying is beyond these rules; nothing fires.
    equal(findMatches(parse('x x ^ x der'), D).length, 0);
  });

  test('nested derivatives resolve inside out', () => {
    equal(work('x 3 ^ x der x der').out, '6 x *');
  });

  test('differentiating always terminates and removes every derivative', () => {
    const inputs = cases.map((c) => c[0]).concat([
      'x 2 ^ x sin * x der', 'x 3 ^ x sin / x der', 'x 2 ^ 1 + ln x der',
      'x sin x cos * x tan + x der', 'x 2 ^ 3 x * + 7 + x der', 'x 3 ^ x der x der',
    ]);
    for (const input of inputs) {
      const out = simplify(parse(input), D, { order: 'pre', maxSteps: 100 });
      equal(out.stopped, 'fixpoint', `${input} did not settle`);
      assert(!/ D\b/.test(out.expr.s), `${input} left a derivative: ${out.expr.s}`);
    }
  });

  test('innermost order reaches the same answer by a different route', () => {
    const pre = simplify(parse('x 2 ^ x sin * x der'), D, { order: 'pre', maxSteps: 80 });
    const post = simplify(parse('x 2 ^ x sin * x der'), D, { order: 'post', maxSteps: 80 });
    equal(post.expr.s, pre.expr.s);
  });

  test('every explanation fills in its placeholders', () => {
    const { d } = work('x 2 ^ x sin * x der');
    for (const s of d.steps) {
      assert(s.explanation && !s.explanation.includes('{'), `unfilled: ${s.explanation}`);
    }
  });
});

suite('the der operator', () => {
  test('parses as a normal binary operator', () => {
    const e = parse('x 2 ^ x der');
    equal(e.op, 'der');
    equal(e.args[0].s, 'x 2 ^');
    equal(e.args[1].s, 'x');
  });

  test('never folds, even when both operands are numbers', () => {
    equal(simplify(parse('2 3 der'), S).expr.s, '2 3 der');
  });

  test('still needs two operands', () => {
    throws(() => parse('x der'), '"der" at position 2 needs 2 operand');
  });
});
