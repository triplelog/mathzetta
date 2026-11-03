// The CAS (src/cas): exact answers, steps, customising, and property checks
// against MathZetta's evaluate (simplified = original, d/dx by finite differences,
// d/dx ∫ f = f, every solution satisfies its equation).

import { readFileSync } from 'node:fs';
import { suite, test, equal, assert, deepEqual, throws } from './harness.js';
import { parse as mz } from 'mathzetta';
import { evaluate } from 'mathzetta/evaluate';
import { createCAS, approximate } from '../src/cas/index.js';
import { bundle } from '../tools/bundle-rules.mjs';
import { parse } from '../src/index.js';

const cas = createCAS({ read: (t) => mz(t) });
const text = (r) => r.text;

const table = (name, fn, rows) => suite(name, () => {
  for (const [input, want, ...rest] of rows) test(`${input} → ${want}`, () => equal(fn(input, ...rest), want));
});

table('cas: the normal form (exact arithmetic, like terms)', (x) => text(cas.simplify(x, { steps: false })), [
  ['2x + 3x', '5x'],
  ['x x^2', 'x^3'],
  ['sqrt(72)', '6sqrt(2)'],
  ['sqrt(2) sqrt(3)', 'sqrt(6)'],
  ['sqrt(12) + sqrt(27)', '5sqrt(3)'],
  ['\\sqrt[3]{-8}', '-2'],
  ['8^(2/3)', '4'],
  ['1/sqrt(2)', 'sqrt(2)/2'],
  ['1/3 + 1/6', '1/2'],
  ['0.1 + 0.2', '3/10'],
  ['2^100', '1267650600228229401496703205376'],
  ['x/2 + x/3', '5x/6'],
  ['2(x + 1)', '2x + 2'],
  ['a - (a - b)', 'b'],
  ['(2x)^3', '8x^3'],
  ['e^x e^y', 'e^(x + y)'],
  ['|-2x|', '2|x|'],
  ['25!', '15511210043330985984000000'],
  ['log_2(8) + log_10(0.001)', '0'],
  ['log_8(4)', '2/3'],
]);

table('cas: simplify with rules', (x) => text(cas.simplify(x, { steps: false })), [
  ['sin(pi/6)', '1/2'],
  ['sin(7pi/6)', '-1/2'],
  ['cos(2pi/3)', '-1/2'],
  ['tan(5pi/4)', '1'],
  ['cos(-pi/3)', '1/2'],
  ['sin(-x)', '-sin(x)'],
  ['sin(x)^2 + cos(x)^2', '1'],
  ['3 sin(x)^2 + 3cos(x)^2 + 1', '4'],
  ['sin(x)^2 + cos(x)^2 + x', 'x + 1'],
  ['ln(e^(2x))', '2x'],
  ['e^(ln x)', 'x'],
  ['sqrt(x^2)', '|x|'],
  ['sin(x)/cos(x)', 'tan(x)'],
  ['arcsin(1/2) + arctan(1)', '5π/12'],
  ['|e - 3|', '-e + 3'],
  ['(x^2 - 1)/(x - 1)', 'x + 1'],
  ['(x + 1)^2 - x^2', '2x + 1'],
]);

table('cas: expand, factor, cancel', (x, how) => text(cas[how](x, { steps: false })), [
  ['(x + 1)^2', 'x^2 + 2x + 1', 'expand'],
  ['(a + b)^3', 'a^3 + 3a^2·b + 3a·b^2 + b^3', 'expand'],
  ['(sqrt(2) + 1)^2', '2sqrt(2) + 3', 'expand'],
  ['x^2 - 5x + 6', '(x - 2)·(x - 3)', 'factor'],
  ['x^2 - 1', '(x - 1)·(x + 1)', 'factor'],
  ['2x^2 + 4x + 2', '2·(x + 1)^2', 'factor'],
  ['6x^2 + 9x', '3x·(2x + 3)', 'factor'],
  ['x^4 - 1', '(x - 1)·(x + 1)·(x^2 + 1)', 'factor'],
  ['x^3 + 8', '(x + 2)·(x^2 - 2x + 4)', 'factor'],
  ['4x^2 - 9y^2', '(2x - 3y)·(2x + 3y)', 'factor'],
  ['2x^2 - x - 1', '(2x + 1)·(x - 1)', 'factor'],
  ['1 - x', '-(x - 1)', 'factor'],
  ['x^2 + 1', 'x^2 + 1', 'factor'],
  ['(x^2 - 1)/(2x - 2)', '(x + 1)/2', 'cancel'],
  ['1/x + 1/y', '(x + y)/(x·y)', 'cancel'],
  ['x/(x^2 + x)', '1/(x + 1)', 'cancel'],
]);

table('cas: derivatives', (x) => text(cas.diff(x, 'x', { steps: false })), [
  ['x^3', '3x^2'],
  ['x^2 sin(x)', 'x^2·cos(x) + 2x·sin(x)'],
  ['e^(2x)', '2e^(2x)'],
  ['ln(x^2 + 1)', '2x/(x^2 + 1)'],
  ['sqrt(x)', '1/(2sqrt(x))'],
  ['1/x', '-1/x^2'],
  ['(x + 1)/(x - 1)', '-2/(x - 1)^2'],
  ['a x^2 + b x', '2a·x + b'],
  ['x^x', 'x^x·(ln(x) + 1)'],
  ['\\sqrt[3]{x}', '1/(3x^(2/3))'],
  ['arctan(2x)', '2/(4x^2 + 1)'],
]);

table('cas: integrals', (x) => text(cas.integrate(x, 'x', { steps: false })), [
  ['x^2', 'x^3/3'],
  ['3x^2 + 2x + 1', 'x^3 + x^2 + x'],
  ['1/x', 'ln(|x|)'],
  ['cos(3x + 1)', 'sin(3x + 1)/3'],
  ['e^(2x)', 'e^(2x)/2'],
  ['x e^x', 'x·e^x - e^x'],
  ['x^2 e^x', 'x^2·e^x - 2x·e^x + 2e^x'],
  ['x sin(x)', '-x·cos(x) + sin(x)'],
  ['ln(x)', 'x·ln(x) - x'],
  ['x ln(x)', 'x^2·ln(x)/2 - x^2/4'],
  ['1/(x^2 + 1)', 'arctan(x)'],
  ['sqrt(x)', '2x^(3/2)/3'],
  ['tan(x)', '-ln(|cos(x)|)'],
  ['\\int_0^1 x^2 dx', '1/3'],
  ['\\int_0^{pi} sin(x) dx', '2'],
  ['\\int_1^e 1/x dx', '1'],
  ['\\int_0^1 x e^x dx', '1'],
]);

table('cas: solving', (x) => text(cas.solve(x, 'x', { steps: false })), [
  ['2x + 3 = 7', 'x = 2'],
  ['3x - 5 = x + 1', 'x = 3'],
  ['x/2 = 3', 'x = 6'],
  ['x^2 = 4', 'x = -2 or x = 2'],
  ['x^2 = 2', 'x = -sqrt(2) or x = sqrt(2)'],
  ['x^2 - 5x + 6 = 0', 'x = 2 or x = 3'],
  ['x^2 + x - 1 = 0', 'x = -sqrt(5)/2 - 1/2 or x = sqrt(5)/2 - 1/2'],
  ['x^2 + 1 = 0', 'no solution'],
  ['x^3 - 6x^2 + 11x - 6 = 0', 'x = 1 or x = 2 or x = 3'],
  ['x^4 - 5x^2 + 4 = 0', 'x = -2 or x = -1 or x = 1 or x = 2'],
  ['x^3 = -8', 'x = -2'],
  ['e^x = 5', 'x = ln(5)'],
  ['ln(x) = 2', 'x = e^2'],
  ['2^x = 8', 'x = 3'],
  ['sqrt(x) = 3', 'x = 9'],
  ['sqrt(x) = -1', 'no solution'],
  ['sqrt(x + 1) = x - 1', 'x = 3'],
  ['sqrt(x) + x = 6', 'x = 4'],
  ['|x - 1| = 3', 'x = -2 or x = 4'],
  ['|2x - 1| = x + 2', 'x = -1/3 or x = 3'],
  ['sin(x) = 1/2', 'x = π/6 or x = 5π/6'],
  ['1/x = 4', 'x = 1/4'],
  ['3/(x - 1) = 2', 'x = 5/2'],
  ['(x - 1)/(x + 2) = 0', 'x = 1'],
  ['x ln(x) = 0', 'x = 1'],
  ['e^(2x) - 3e^x + 2 = 0', 'x = 0 or x = ln(2)'],
  ['a x + b = 0', 'x = -b/a'],
  ['x = x + 1', 'no solution'],
  ['2(x + 1) = 2x + 2', 'true for every x'],
  ['x^5 + x + 1 = 0', 'no exact solution found for x'],
]);

suite('cas: systems, substitution, equivalence', () => {
  test('a linear system', () => {
    const r = cas.solveSystem(['x + y = 3', 'x - y = 1'], ['x', 'y']);
    equal(r.text, 'x = 2, y = 1');
  });
  test('a system with symbols on the right', () => equal(cas.solveSystem(['x + y = a', 'x - y = b'], ['x', 'y']).text, 'x = a/2 + b/2, y = a/2 - b/2'));
  test('no solution / many', () => {
    equal(cas.solveSystem(['x + y = 1', 'x + y = 2'], ['x', 'y']).status, 'none');
    equal(cas.solveSystem(['x + y = 1', '2x + 2y = 2'], ['x', 'y']).status, 'many');
  });
  test('substitute', () => equal(cas.substitute('x^2 + y', { x: 3, y: 'z + 1' }).text, 'z + 10'));
  test('equivalent: exactly and numerically', () => {
    deepEqual(cas.equivalent('(x + 1)^2', 'x^2 + 2x + 1'), { equal: true, how: 'exact' });
    equal(cas.equivalent('sin(2x)', '2 sin(x) cos(x)').equal, true);
    equal(cas.equivalent('sin(2x)', '2 sin(x)').equal, false);
  });
  test('approximately: on a solve, and numeric roots when asked', () => {
    equal(cas.solve('x^2 = 2', 'x', { approximate: 10 }).text, 'x = -1.414213562 or x = 1.414213562');
    equal(cas.solve('x^5 + x + 1 = 0', 'x', { approximate: true }).text, 'x = -0.754877666246693');
  });
});

suite('cas: exact, or as many digits as asked', () => {
  const digits = (x, d) => approximate(parse(mz(x).join(' ')), { digits: d }).text;
  test('π to 60 digits', () => equal(digits('pi', 60), '3.14159265358979323846264338327950288419716939937510582097494'));
  test('√2 to 50', () => equal(digits('sqrt(2)', 50), '1.4142135623730950488016887242096980785696718753769'));
  test('e to 40', () => equal(digits('e', 40), '2.718281828459045235360287471352662497757'));
  test('e^(π√163) is nearly whole', () => equal(digits('e^(pi sqrt(163))', 30), '262537412640768743.999999999999'));
  test('the functions agree with doubles', () => {
    for (const x of ['sin(1)', 'cos(2.5)', 'tan(0.3)', 'ln(10)', 'e^-10', 'arctan(3)', 'arcsin(0.2)', 'arccos(-0.7)', 'sinh(1.5)', 'arctanh(0.5)', 'log_2(10)', '2^0.5', 'sin(100)']) {
      const got = Number(digits(x, 15));
      const want = evaluate(x);
      assert(Math.abs(got - want) <= 1e-14 * Math.max(1, Math.abs(want)), `${x}: ${got} vs ${want}`);
    }
  });
  test('exact stays exact', () => {
    equal(approximate(parse('1 4 /')).exact, true);
    equal(approximate(parse('1 3 /')).exact, false);
  });
  test('not real', () => throws(() => digits('ln(-1)', 10), 'not positive'));
  test('a result with unknowns keeps them', () => equal(cas.approximate('pi x', { digits: 6 }).text, '3.14159x'));
  test('on any call: { approximate }', () => equal(cas.integrate('\\int_0^1 e^x dx', null, { approximate: 8 }).text, '1.7182818'));
});

suite('cas: steps', () => {
  const steps = (s) => cas.diff('x^2 sin(3x)', 'x', { steps: s }).steps;
  test('every step chains: each starts where the last ended', () => {
    for (const option of [true, 'brief', 'full', { hide: ['split'] }, { show: ['chain'] }]) {
      const list = steps(option);
      for (let i = 1; i < list.length; i++) equal(list[i].from, list[i - 1].to, JSON.stringify(option));
      if (list.length) equal(list[list.length - 1].to, cas.diff('x^2 sin(3x)', 'x', { steps: false }).result.s);
    }
  });
  test('steps: false gives none', () => equal(steps(false).length, 0));
  test("brief hides the routine ones, and says what each shown one absorbed", () => {
    const full = steps(true);
    const brief = steps('brief');
    assert(brief.length < full.length, `${brief.length} vs ${full.length}`);
    assert(brief.some((s) => s.also?.length), 'a merged step lists what it absorbed');
  });
  test('explain: false, or a list', () => {
    assert(steps({ explain: false }).every((s) => s.explanation === undefined));
    const some = steps({ explain: ['chain'] });
    assert(some.some((s) => s.explanation) && some.some((s) => s.explanation === undefined));
  });
  test('explanations fill in the parts', () => {
    const r = cas.solve('3x = 6', 'x');
    equal(r.steps.at(-1).explanation, 'Divide both sides by 3.');
  });
  test('a step has a path into the expression before it (for Inline Math)', () => {
    const first = steps(true)[0];
    assert(Array.isArray(first.path), 'path');
  });
  test('a rejected answer says why', () => {
    const r = cas.solve('sqrt(x + 1) = x - 1', 'x');
    assert(r.steps.some((s) => s.id === 'solve.reject' && /0 is not a solution/.test(s.explanation)));
  });
  test('an unknown detail level is an error', () => throws(() => steps('short'), 'is not one of'));
});

suite('cas: your own rules', () => {
  const mine = `
operators:
  - { symbol: sinc, arity: 1 }
messages:
  solve.divide: "Share both sides between {by}."
rules:
  - id: d-sinc
    mode: differentiate
    pattern: u sinc v der
    output: u cos u / u sin u 2 ^ / - u v der *
  - { id: sinc-0, pattern: 0 sinc, output: "1" }
  - { id: sinc-definition, mode: define, pattern: u sinc, output: u sin u / }
  - { id: sin-pi-6, explain: "From the 30-60-90 triangle: sin 30° = 1/2." }
  - { id: sqrt-of-square, enabled: false }
`;
  // MathZetta reads an unknown function as \:sinc when told its name; the CAS maps it to the declared operator
  const custom = createCAS({ read: (t) => mz(t, { names: ['sinc'] }), rules: [mine] });
  test('a new function: its derivative, a value, a definition for approximating', () => {
    equal(custom.diff('sinc(2x)', 'x', { steps: false }).text, 'cos(2x)/x - sin(2x)/(2x^2)');
    equal(custom.simplify('sinc(0) + 1').text, '2');
    equal(custom.approximate('sinc(1)', { digits: 10 }).text, '0.8414709848');
  });
  test('a shipped rule reworded, by id alone', () => equal(custom.simplify('sin(pi/6)').steps[0].explanation, 'From the 30-60-90 triangle: sin 30° = 1/2.'));
  test('a shipped rule turned off', () => equal(custom.simplify('sqrt(x^2)').text, 'sqrt(x^2)'));
  test('a coded step reworded', () => equal(custom.solve('3x = 6', 'x').steps.at(-1).explanation, 'Share both sides between 3.'));
  test('the shipped CAS is untouched', () => equal(cas.simplify('sqrt(x^2)').text, '|x|'));
  test('a mode of your own', () => {
    const c = createCAS({ rules: ['rules:\n  - { id: swap, mode: mirror, pattern: a b +, output: b a - }\n'], defaults: false });
    // every result is in normal form: y - x is drawn -x + y
    equal(c.rewrite('x y +', 'mirror').text, '-x + y');
  });
  test('a bad rule file says what is wrong', () => throws(() => createCAS({ rules: ['rules:\n  - { id: bad, pattern: u v, output: u }\n'] }), 'rule "bad": bad pattern'));
  test('without defaults, nothing is known but arithmetic', () => equal(createCAS({ defaults: false }).simplify('2 3 + =pi sin +').text, 'sin(=pi) + 5'));
});

// ---- complex numbers ----------------------------------------------------------------------

const complexCas = createCAS({ complex: true, read: (t) => mz(t, { names: ['Re', 'Im', 'conj', 'arg'] }) });

table('cas, complex: arithmetic and functions', (x) => text(complexCas.simplify(x, { steps: false })), [
  ['i^2', '-1'],
  ['i^-1', '-i'],
  ['i^101', 'i'],
  ['(2+3i)(1-i)', '5 + i'],
  ['(1+i)^10', '32i'],
  ['1/(1+i)', '1/2 - i/2'],
  ['(3+4i)/(1-2i)', '-1 + 2i'],
  ['(1+i)/(1-i)', 'i'],
  ['sqrt(-4)', '2i'],
  ['sqrt(-8)', '2sqrt(2)i'],
  ['sqrt(3+4i)', '2 + i'],
  ['sqrt(-3-4i)', '1 - 2i'],
  ['x + 2 + 3i', 'x + 2 + 3i'],
  ['\\operatorname{Re}(3+4i)', '3'],
  ['\\operatorname{Im}(3 - 4i)', '-4'],
  ['conj((1+i)^3)', '-2 - 2i'],
  ['|3+4i|', '5'],
  ['arg(1 + i)', 'π/4'],
  ['arg(-1 - i)', '-3π/4'],
  ['e^(i pi) + 1', '0'],
  ['e^(1 + i pi/2)', 'e·i'],   // ei would read as a name
  ['ln(-1)', 'πi'],
  ['ln(i)', 'πi/2'],
  ['i^i', 'e^(-π/2)'],
]);

table('cas, complex: solving', (x) => text(complexCas.solve(x, 'x', { steps: false })), [
  ['x^2 + 1 = 0', 'x = -i or x = i'],
  ['x^2 + 2x + 5 = 0', 'x = -1 - 2i or x = -1 + 2i'],
  ['x^4 = 16', 'x = -2 or x = 2 or x = -2i or x = 2i'],
  ['x^3 = 1', 'x = 1 or x = -1/2 - sqrt(3)i/2 or x = -1/2 + sqrt(3)i/2'],
  ['x^3 = -8', 'x = -2 or x = 1 - sqrt(3)i or x = 1 + sqrt(3)i'],
  ['x^2 + i = 0', 'x = -sqrt(2)/2 + sqrt(2)i/2 or x = sqrt(2)/2 - sqrt(2)i/2'],
  ['(1+i) x = 2', 'x = 1 - i'],
  ['e^x = -1', 'x = πi'],
  ['x^2 - 5x + 6 = 0', 'x = 2 or x = 3'],
]);

suite('cas, complex: approximation, and real mode untouched', () => {
  const digits = (x, d = 15) => complexCas.approximate(x, { digits: d }).text;
  test('complex decimals', () => {
    equal(digits('e^(i)', 20), '0.5403023058681397174 + 0.84147098480789650665i');
    equal(digits('(1+i)^0.5', 12), '1.09868411347 + 0.455089860562i');
    equal(digits('cos(1+i)'), '0.833730025131149 - 0.988897705762865i');
    equal(digits('1/(1+2i)'), '0.2 - 0.4i');
    equal(digits('i^i'), '0.207879576350762');
    equal(digits('e^(i pi)'), '-1');
  });
  test('{ approximate } on a solve, and numeric complex roots', () => {
    equal(complexCas.solve('x^3 = 2', 'x', { approximate: 6 }).text, 'x = 1.25992 or x = -0.629961 - 1.09112i or x = -0.629961 + 1.09112i');
    const r = complexCas.solve('x^5 + x + 1 = 0', 'x', { approximate: 8 });
    equal(r.solutions.length, 5);
  });
  test('without complex: true, i is an unknown and √-4 is not real', () => {
    equal(cas.simplify('i^2').text, 'i^2');
    equal(cas.simplify('sqrt(-4)').text, 'sqrt(-4)');
    equal(cas.solve('x^2 + 1 = 0', 'x').text, 'no solution');
  });
  test('every complex solution satisfies its equation', () => {
    for (const e of ['x^2 - 2x + 10 = 0', 'x^3 + 27 = 0', 'x^4 - 81 = 0', 'x^2 + (1 - i) x - i = 0', '2 x^2 + 3 = 0']) {
      const r = complexCas.solve(e, 'x', { steps: false });
      assert(r.solutions.length >= 2, `${e}: ${r.text}`);
      const [l, rhs] = e.split('=').map((t) => mz(t));
      for (const s of r.solutions) {
        const at = (side) => complexCas.approximate(complexCas.substitute(side, { x: s }, { steps: false }).result, { digits: 20 });
        const a = at(l);
        const b = at(rhs);
        assert(Math.hypot(a.re - b.re, a.im - b.im) < 1e-9, `${e}: x = ${complexCas.format(s)} gives ${a.text} and ${b.text}`);
      }
    }
  });
});

suite('cas: the shipped rules bundle is current', () => {
  test('src/cas/default-rules.js matches rules/*.yaml (npm run build:rules)', () => {
    equal(readFileSync(new URL('../src/cas/default-rules.js', import.meta.url), 'utf8'), bundle());
  });
});

// ---- properties, against MathZetta's evaluate --------------------------------------------

const POINTS = [0.37, 0.81, 1.3, 2.2];
const near = (a, b) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const valueAt = (postfix, x) => evaluate(postfix.split(' '), { x, a: 1.7, b: -0.6, y: 0.9 });

suite('cas: properties', () => {
  const functions = ['x^3 - 2x', 'x^2 sin(x)', 'e^(2x) cos(x)', 'ln(x^2 + 1)', 'sqrt(x + 1)', '(x + 1)/(x - 3)', 'sin(x)^2', 'arctan(x/2)', 'x^x',
    'tan(x) + sec(x)', 'e^(-x^2)', '\\sqrt[3]{x^2 + 1}', '1/(x^2 + 2x + 2)', 'x ln(x)', 'arcsin(x/3)', 'cosh(x) sinh(x)', 'log_2(x + 3)', '|x - 1|'];
  test('simplify keeps the value', () => {
    for (const f of [...functions, '(x^2 - 1)/(x - 1)', 'sin(x)^2 + cos(x)^2 + x', '(x + 1)^3 - (x - 1)^3', 'sqrt(8x^2)/x']) {
      const r = cas.simplify(f, { steps: false }).result.s;
      const original = mz(f).join(' ');
      for (const x of POINTS) assert(near(valueAt(r, x), valueAt(original, x)), `${f} → ${cas.simplify(f).text} at ${x}`);
    }
  });
  test('derivatives match finite differences', () => {
    const h = 1e-5;
    for (const f of functions) {
      const d = cas.diff(f, 'x', { steps: false }).result.s;
      const original = mz(f).join(' ');
      for (const x of POINTS) {
        if (f === '|x - 1|' && Math.abs(x - 1) < 0.01) continue;
        const fd = (valueAt(original, x + h) - valueAt(original, x - h)) / (2 * h);
        assert(Math.abs(valueAt(d, x) - fd) < 1e-4 * Math.max(1, Math.abs(fd)), `d/dx ${f} = ${cas.diff(f, 'x').text} at ${x}: ${valueAt(d, x)} vs ${fd}`);
      }
    }
  });
  test('differentiating an antiderivative gives the integrand', () => {
    for (const f of ['x^4 - 3x + 2', 'sin(2x)', 'cos(x/3)', 'e^(3x - 1)', 'x^2 e^x', 'x cos(x)', '1/(2x + 1)', '(3x + 2)^4', 'x^2 ln(x)', 'sqrt(4x + 1)', '1/sqrt(x)', 'x arctan(x)', '5^x', 'sinh(2x)']) {
      const F = cas.integrate(f, 'x', { steps: false }).result;
      const back = cas.diff(F, 'x', { steps: false }).result.s;
      const original = mz(f).join(' ');
      for (const x of POINTS) assert(near(valueAt(back, x), valueAt(original, x)), `∫ ${f} = ${cas.format(F)}; its derivative at ${x}: ${valueAt(back, x)} vs ${valueAt(original, x)}`);
    }
  });
  test('every solution satisfies its equation', () => {
    for (const e of ['x^2 - 3x - 10 = 0', '2x^2 + 3x - 4 = 0', 'x^3 - 7x + 6 = 0', 'e^(x + 1) = 7', 'ln(2x - 1) = 1', 'sqrt(3x + 1) = x - 1', '5/(x + 1) = x - 3', 'cos(x) = 1/3', '10^x = 50', 'x^4 = 81']) {
      const r = cas.solve(e, 'x', { steps: false });
      assert(r.solutions.length > 0, `${e}: no solutions`);
      const [l, rhs] = e.split('=').map((s) => mz(s).join(' '));
      for (const s of r.solutions) {
        const x = approximate(s, { digits: 20 }).number;
        assert(near(valueAt(l, x), valueAt(rhs, x)), `${e}: x = ${cas.format(s)}`);
      }
    }
  });
});
