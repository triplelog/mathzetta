// What an outside review (2026-11) found, kept fixed: inputs that ran away, structure keys that
// collided, folds that weren't exact, and CAS answers that were wrong or unexplained.

import { readFileSync } from 'node:fs';
import { suite, test, equal, assert, deepEqual, throws } from './harness.js';
import { parse as mz } from 'mathzetta';
import { createCAS } from '../src/cas/index.js';
import { toText } from '../src/cas/text.js';
import {
  RuleSet, parse, fromPostfix, findMatches, simplify, simplifyText, foldNumeric, shapeKey, parseYaml, stringifyYaml,
} from '../src/index.js';

const cas = createCAS({ read: (t) => mz(t) });
const complex = createCAS({ read: (t) => mz(t), complex: true });
const arithmetic = RuleSet.fromYaml(readFileSync(new URL('../rules/arithmetic.yaml', import.meta.url), 'utf8')).view('simplify');

/** fn finishes within `ms` and gives back what it gives back (an answer, or a CasError, never a hang). */
const quick = (label, fn, ms = 2000) => {
  const t0 = Date.now();
  let out;
  try { out = fn(); } catch (error) { out = error; }
  assert(Date.now() - t0 < ms, `${label} took ${Date.now() - t0} ms`);
  assert(!(out instanceof RangeError) && !(out instanceof TypeError), `${label}: ${out?.message}`);
  return out;
};

suite('limits: no short input runs away', () => {
  test('a fraction of a power that would be enormous stays as written', () => {
    equal(quick('2^(99999999/100000000)', () => cas.simplify('2^(99999999/100000000)', { steps: false }).text), '2^(99999999/100000000)');
  });
  test('roots with a huge index: integer roots stop at 1, decimals go through logarithms', () => {
    equal(quick('root', () => cas.approximate('root(1000000000, 2)').text), '1.00000000069315');
    equal(quick('2^(1/1000000)', () => cas.approximate('2^(1/1000000)').text), '1.00000069314742');
  });
  test('polynomials past degree 256 are not expanded into a dense list', () => {
    quick('factor x^100000000 - 1', () => cas.factor('x^100000000 - 1', { steps: false }));
    quick('simplify (x^100000000 - 1)/(x - 1)', () => cas.simplify('(x^100000000 - 1)/(x - 1)', { steps: false }));
    equal(quick('solve', () => cas.solve('x^100000000 = 1', 'x', { steps: false }).text), 'x = -1 or x = 1');
  });
  test('a complex power is multiplied out only up to the 60th', () => {
    equal(quick('(1+i)^100000000', () => complex.simplify('(1+i)^100000000', { steps: false }).text), '(1 + i)^100000000');
    equal(complex.simplify('(1+i)^4', { steps: false }).text, '-4');
  });
  test('e to a huge power, a huge factorial, π to a huge power: a CasError, at once', () => {
    for (const input of ['e^(10^20)', '100000000!', 'pi^1000000000']) {
      const out = quick(input, () => cas.approximate(input));
      assert(out instanceof Error && /too large/.test(out.message), `${input}: ${out?.message ?? out?.text}`);
    }
    equal(quick('e^(-10^20)', () => cas.approximate('e^(-10^20)').text), '0');
  });
});

suite('engine: structure keys, exact folds, rewrites that change nothing', () => {
  test('a variadic operator\'s count is part of its key', () => {
    equal(shapeKey(fromPostfix('a b c d 3 max 2 max'.split(' '))), '_ _ _ _ 3 max 2 max');
    const rules = RuleSet.fromYaml('- id: nested\n  pattern: a b c d 3 max 2 max\n  output: a\n');
    deepEqual(findMatches('1 2 3 4 2 max 3 max', rules).map((m) => m.node.s), [], 'max(a, b, max(c, d)) is another shape');
    deepEqual(findMatches('1 2 3 4 3 max 2 max', rules).map((m) => m.node.s), ['1 2 3 4 3 max 2 max']);
  });
  test('an operator with no operands has a key, and a rule can match it', () => {
    equal(shapeKey(parse('random')), 'random');
    const rules = RuleSet.fromYaml("- id: r\n  pattern: random\n  output: '0'\n");
    deepEqual(findMatches('random 1 +', rules).map((m) => m.node.s), ['random']);
  });
  test('+, -, *, neg and whole powers fold exactly on the decimal tokens', () => {
    const fold = (t) => foldNumeric(parse(t)).s;
    equal(fold('0.1 0.2 +'), '0.3');
    equal(fold('3 40 ^'), '12157665459056928801');
    equal(fold('123456789012345678901 1 +'), '123456789012345678902');
    equal(fold('2 -1 ^'), '0.5');
    equal(fold('3 -1 ^'), '3 -1 ^', '1/3 has no exact decimal');
    equal(fold('2 0.5 ^'), '2 0.5 ^');
    equal(fold('2.5 4 *'), '10');
  });
  test('a fold: true rule that folds nothing is no rewrite: not offered, and no false "cycle"', () => {
    deepEqual(findMatches('1 3 /', arithmetic).map((m) => m.rule.id), []);
    equal(simplify(parse('1 3 /'), arithmetic).stopped, 'fixpoint');
    equal(simplifyText('0.1 0.2 +', arithmetic), '0.3');
  });
});

suite('cas: answers and explanations', () => {
  test('x² = 0 has the solution 0 (±0 is one answer)', () => {
    equal(cas.solve('x^2 = 0', 'x', { steps: false }).text, 'x = 0');
    equal(cas.solve('x x = 0', 'x', { steps: false }).text, 'x = 0');
    equal(cas.solve('(x - 1)^2 = 0', 'x', { steps: false }).text, 'x = 1');
  });
  test('a pole between the limits is found wherever it falls', () => {
    throws(() => cas.integrate('1/x', 'x', { from: -1, to: 2 }), 'no value at x = 0, between the limits');
    throws(() => cas.integrate('1/(x - 0.3)', 'x', { from: 0, to: 1 }), 'between the limits');
    throws(() => cas.integrate('tan(x)', 'x', { from: 0, to: 2 }), 'between the limits');
    throws(() => cas.integrate('1/x^2', 'x', { from: 0, to: 1 }), 'diverges');
    equal(cas.integrate('1/sqrt(x)', 'x', { from: 0, to: 1 }).text, '2', 'a pole at a limit can still converge');
    equal(cas.integrate('1/x^2', 'x', { from: 1, to: 3 }).text, '2/3');
  });
  test('limits can be numbers, text, tokens or nodes', () => {
    equal(cas.integrate('x', 'x', { from: parse('0'), to: parse('1') }).text, '1/2');
    equal(cas.integrate('x', 'x', { from: 0, to: '2' }).text, '2');
  });
  test('a second derivative is taken one derivative at a time', () => {
    const twice = cas.diff('x^3 sin(x)', 'x', { order: 2, steps: 'full' });
    const first = cas.diff('x^3 sin(x)', 'x', { steps: 'full' });
    const second = cas.diff(first.result, 'x', { steps: 'full' });
    equal(twice.text, second.text);
    equal(twice.steps.length, first.steps.length + second.steps.length);
  });
  test('factoring explains itself', () => {
    const steps = cas.factor('x^2 - 5x + 6').steps;
    assert(steps.length && steps.every((s) => s.explanation), JSON.stringify(steps.map((s) => s.explanation)));
  });
  test('approximate: digits apply to whole numbers too, exact means no rounding, list functions work on irrationals', () => {
    equal(cas.approximate('2^200', { digits: 10 }).text, '1.606938044e60');
    equal(cas.approximate('1/8', { digits: 3 }).exact, true);
    equal(cas.approximate('1/1024', { digits: 3 }).exact, false);
    equal(cas.approximate('max(pi, 3)').text, '3.14159265358979');
    equal(cas.approximate('pi mod 3').text, '0.141592653589793');
    equal(cas.approximate('round(pi, 2)').text, '3.14');
  });
  test('exactly 0 is 0, and tiny is tiny', () => {
    equal(cas.approximate('sin(pi)').text, '0');
    equal(cas.approximate('tan(pi/4) - 1').text, '0');
    equal(cas.approximate('1/10^50').text, '1e-50');
    equal(cas.approximate('e^(-100)').text, '3.72007597602084e-44');
  });
  test('cosh, arcsinh, arccosh and arctanh are undone when solving', () => {
    equal(cas.solve('cosh(x) = 2', 'x', { steps: false }).text, 'x = -arccosh(2) or x = arccosh(2)');
    equal(cas.solve('arcsinh(x) = 1', 'x', { steps: false }).text, 'x = sinh(1)');
    equal(cas.solve('arccosh(x) = 2', 'x', { steps: false }).text, 'x = cosh(2)');
    equal(cas.solve('arctanh(x) = 1/2', 'x', { steps: false }).text, 'x = tanh(1/2)');
    equal(cas.solve('cosh(x) = 1/2', 'x', { steps: false }).text, 'no solution');
  });
});

suite('yaml and text: round trips and readable output', () => {
  test('multiline text survives in lists, at the top level and in one-line lists', () => {
    for (const value of [['a\nb'], 'a\nb', { k: ['x\ny', 'z'] }, [{ id: 'r', explain: 'one\ntwo' }], { t: ['tab\there'] }, ['a, b', 'x]y', '{z}']]) {
      deepEqual(parseYaml(stringifyYaml(value)), value, JSON.stringify(value));
    }
    deepEqual(parseYaml('- |-\n  hand\n  written\n- plain\n'), ['hand\nwritten', 'plain']);
  });
  test('toText: no brackets an associative sum or product doesn\'t need; subscripts and groups as written', () => {
    const t = (p) => toText(parse(p));
    equal(t('a b c + +'), 'a + b + c');
    equal(t('a b c + -'), 'a - (b + c)');
    equal(t('a b neg +'), 'a + (-b)');
    equal(t('2 x y * *'), '2x·y');
    equal(t('x 1 _'), 'x_1');
    equal(t('1 2 2 []'), '[1, 2]');
    equal(t('0 1 2 (]'), '(0, 1]');
  });
});
