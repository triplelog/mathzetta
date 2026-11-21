#!/usr/bin/env node
// The CAS against SymPy: for each case, the CAS's answer and SymPy's own answer
// (from MathZetta's SymPy output of the input) are compared in Python:
//   simplify, expand, factor, cancel   simplify(ours - theirs) == 0
//   diff                               simplify(ours - diff(f)) == 0
//   integrate                          diff(ours) - f simplifies to 0 (any constant is fine)
//   solve                              the same set of real solutions as solveset
//
//   npm run check:sympy        (needs python3 with sympy; prints each disagreement)
import { spawnSync } from 'node:child_process';
import { parse } from 'mathzetta';
import { toPython } from 'mathzetta/python';
import { createCAS } from '../src/cas/index.js';

const cas = createCAS({ read: (t) => parse(t) });
const complexCas = createCAS({ complex: true, read: (t) => parse(t, { names: ['Re', 'Im', 'conj', 'arg'] }) });

const CASES = {
  simplify: ['tan(x) cos(x)', 'sec(x)^2 - tan(x)^2', '1 + tan(x)^2', '2 sin(x) cos(x)', 'cos(x)^2 - sin(x)^2', 'sin(2x)/(2 sin(x))', 'sin(x)^2/(1 - cos(x))',
    'sin(x)/(1 + cos(x)) + (1 + cos(x))/sin(x)', 'sin(x)^4 - cos(x)^4', 'cos(2x)/(cos(x) - sin(x))', 'sin(x + pi/2)', 'cos(pi - x)', 'tan(x + pi)', 'sin(pi/12)', 'cos(5pi/12)',
    'cos(pi/8)', 'sin(arccos(x))', 'sin(arctan(x))', 'sin(2 arcsin(x))', 'cos(2 arctan(x))', 'sin(x) cos(y) + cos(x) sin(y)', 'sin(2x) cos(x) + cos(2x) sin(x)',
    '2x + 3x', 'sqrt(72)', 'sin(pi/6) + cos(pi/3)', 'sin(7pi/6)', 'tan(5pi/4)', 'sin(x)^2 + cos(x)^2 + 1', 'ln(e^(2x))', '(x^2 - 1)/(x - 1)',
    '(x + 1)^2 - x^2', 'log_2(8) + log_8(4)', 'sqrt(2) sqrt(6)', '1/3 + 1/6 - 0.25', 'e^x e^(2x)', 'arcsin(1/2) + arccos(1/2)', '(x^3 - 8)/(x - 2)', '2^(1/2) * 2^(2/3)'],
  expand: ['(x + 1)^3', '(x - y)(x + y)', '(2x - 3)^4', '(a + b + c)^2', '(x + 1)(x^2 - x + 1)'],
  factor: ['x^2 - 5x + 6', 'x^3 - x', '6x^2 + 9x', 'x^4 - 16', '2x^2 - x - 1', 'x^3 + 27', '4x^2 - 9y^2', 'x^3 - 6x^2 + 11x - 6'],
  cancel: ['(x^2 - 1)/(2x - 2)', '1/x + 1/y', '(x^2 + 2x + 1)/(x^2 - 1)', 'x/(x^2 + x)'],
  diff: ['x^3', 'x^2 sin(x)', 'e^(2x) cos(3x)', 'ln(x^2 + 1)', 'sqrt(x)', '(x + 1)/(x - 1)', 'sin(x)^2', 'arctan(2x)', 'x^x', 'tan(x)',
    'sec(x)', '\\sqrt[3]{x}', 'log_2(x)', 'arcsin(x)', 'cosh(x^2)', 'e^(-x^2/2)', 'x/(x^2 + 1)', 'ln(sin(x))', '|x|', '2^x'],
  integrate: ['x e^(x^2)', 'ln(x)/x', 'x/(x^2 + 1)', 'sin(x) cos(x)', 'x^2 cos(x^3)', 'cos(x)^3', 'sin(x)^5', 'sec(x)', 'csc(x)', 'sec(x)^3',
    'e^x sin(x)', 'e^(2x) cos(3x)', 'sin(3x) cos(2x)', 'sqrt(4 - x^2)', '1/sqrt(4 - x^2)', '1/(x^2 + 4)', '(x + 3)/(x^2 + 2x + 5)',
    '1/(x (x^2 + 1))', '1/(3x^2 + 2)', 'arctan(x)', 'arcsin(x)',
    'x^2', '3x^2 + 2x + 1', '1/x', 'cos(3x + 1)', 'e^(2x)', 'x e^x', 'x^2 e^x', 'x sin(x)', 'ln(x)', 'x ln(x)', '1/(x^2 + 1)', 'sqrt(x)', 'tan(x)',
    '1/(x^2 - 1)', 'x^2/(x^2 + 1)', '(x^3 + 1)/(x - 1)', 'x arctan(x)', '(2x + 1)^5', '1/(2x + 1)', 'sin(x)^2 + cos(x)^2', 'x cos(2x)', '5^x', '1/sqrt(1 - x^2)', 'sinh(x)'],
  // f @ point, with + or - for one side; ∞ as oo
  limit: ['sin(x)/x @ 0', '(x^2 - 1)/(x - 1) @ 1', '(1 + 1/x)^x @ oo', '(1 - cos(x))/x^2 @ 0', '(3x^2 + 1)/(2x^2 - x) @ oo', 'x^3/(x^2 + 1) @ -oo',
    '1/x @ 0', '1/x @ 0 +', '1/x @ 0 -', 'x e^(-x) @ oo', 'e^x/x^2 @ oo', 'x ln(x) @ 0 +', 'x^x @ 0 +', 'ln(x)/x @ oo', 'sqrt(x^2 + x) - x @ oo',
    '(e^x - 1)/x @ 0', 'arctan(x) @ oo', 'tan(3x)/x @ 0', 'sin(5x)/sin(2x) @ 0', '(sqrt(x + 1) - 2)/(x - 3) @ 3', '1/x - 1/sin(x) @ 0',
    '(1 + 2/x)^(3x) @ oo', '|x|/x @ 0', 'x sin(1/x) @ 0', '(2x + sin(x))/x @ oo', 'x^2/(1 - cos(x)) @ 0', '(x - 4)/(sqrt(x) - 2) @ 4', 'tan(x) @ pi/2 -'],
  solve: ['2x + 3 = 7', 'x^2 = 4', 'x^2 - 5x + 6 = 0', 'x^2 + x - 1 = 0', 'x^2 + 1 = 0', 'x^3 - 6x^2 + 11x - 6 = 0', 'e^x = 5', 'ln(x) = 2', 'sqrt(x + 1) = x - 1',
    '|x - 1| = 3', '2^x = 8', '1/x = 4', '3/(x - 1) = 2', 'x ln(x) = 0', 'e^(2x) - 3e^x + 2 = 0', 'x^4 - 5x^2 + 4 = 0', 'sqrt(2x + 3) = x', 'x^3 = -8', '(x - 1)/(x + 2) = 0'],
};

// complex mode (i is the imaginary unit; unknowns real)
const COMPLEX_CASES = {
  simplify: ['(2+3i)(1-i)', '(1+i)^10', '1/(1+i)', '(3+4i)/(1-2i)', 'sqrt(-8)', 'e^(i pi/3)', 'e^(i pi) + 1', 'ln(-2)', 'sqrt(3+4i)', 'sqrt(i)', '|3+4i|', 'i^i', 'Re((1+2i)/(3-i))', 'conj((1+i)^3)', 'arg(-1-i)'],
  solve: ['x^2 + 1 = 0', 'x^2 + 2x + 5 = 0', 'x^4 = 16', 'x^3 = 1', 'x^3 = -8', 'x^4 + 1 = 0', 'x^6 = 64', 'x^2 + i = 0', '(1+i) x = 2', 'x^3 - x^2 + x - 1 = 0'],
};

const lines = ['import sympy', 'i = sympy.I', 'X = sympy.Symbol("X")', 'x, y, a, b, c = sympy.symbols("x y a b c", real=True)', 'out = []',
  'def same_roots(a, b):\n    na = sorted((complex(sympy.N(v, 30)) for v in a), key=lambda z: (round(z.real, 9), round(z.imag, 9)))\n    nb = sorted((complex(sympy.N(v, 30)) for v in b), key=lambda z: (round(z.real, 9), round(z.imag, 9)))\n    return len(na) == len(nb) and all(abs(p - q) < 1e-9 for p, q in zip(na, nb))',
  'def numeric(e):\n    pts = [-2.3, -0.7, 0.4, 1.9, 3.1]\n    vals = [complex(e.subs({x: p, y: 0.6, a: 1.3, b: -0.4, c: 2.2}).evalf()) for p in pts]\n    return all(abs(v) < 1e-9 for v in vals if v == v)'];
const labels = [];
const runs = [...Object.entries(CASES).map(([op, inputs]) => ({ op, inputs, cas, complex: false })),
  ...Object.entries(COMPLEX_CASES).map(([op, inputs]) => ({ op, inputs, cas: complexCas, complex: true }))];
for (const { op, inputs, cas, complex } of runs) {
  const py = (postfix) => toPython(typeof postfix === 'string' ? postfix.split(' ') : postfix, { sympy: true })
    // MathZetta writes Re/Im/conj/arg as user functions; SymPy has them
    .replace(/\b(Re|re)\(/g, 'sympy.re(').replace(/\b(Im|im)\(/g, 'sympy.im(').replace(/\bconj\(/g, 'sympy.conjugate(').replace(/\barg\(/g, 'sympy.arg(');
  const read = (text) => (complex ? parse(text, { names: ['Re', 'Im', 'conj', 'arg'] }) : parse(text));
  for (const input of inputs) {
    let ours;
    let at = null;
    if (op === 'limit') {
      const [, f, to, side] = /^(.*) @ (\S+)(?: ([+-]))?$/.exec(input);
      at = { f, to: to === 'oo' ? '\\infty' : to === '-oo' ? '-\\infty' : to, side, py: to, dir: side ?? '+-' };
    }
    try {
      ours = op === 'limit' ? cas.limit(at.f, 'x', at.to, { steps: false, side: at.side === '+' ? 'right' : at.side === '-' ? 'left' : undefined }) : op === 'solve' ? cas.solve(input, 'x', { steps: false }) : op === 'diff' || op === 'integrate' ? cas[op](input, 'x', { steps: false }) : cas[op](input, { steps: false });
    } catch (error) {
      labels.push(`${op} ${input}: the CAS failed: ${error.message}`);
      lines.push('out.append("skip")');
      continue;
    }
    labels.push(`${complex ? 'complex ' : ''}${op} ${input} → ${ours.text}`);
    const f = py(read((at ? at.f : input).split('=')[0]));
    let check;
    if (op === 'limit') {
      const A = at.py === 'oo' ? 'sympy.oo' : at.py === '-oo' ? '-sympy.oo' : py(read(at.py));
      const them = `sympy.limit(${f}, x, ${A}${at.py.endsWith('oo') ? '' : `, "${at.dir}"`})`;
      check = ours.exists
        ? `(lambda T, O: T == O or sympy.simplify(T - O) == 0)(${them}, ${py(ours.result.s)})`   // == for ±∞ (∞ − ∞ is nan)
        // "does not exist": SymPy's sides differ, or it gives only bounds
        : `(lambda L, R: L != R or isinstance(L, sympy.AccumBounds))(sympy.limit(${f}, x, ${A}, "-"), sympy.limit(${f}, x, ${A}, "+"))`;
      lines.push(`try:\n    out.append("ok" if ${check} else "differs")\nexcept Exception as e:\n    out.append("error: " + str(e).splitlines()[0])`);
      continue;
    }
    if (op === 'solve') {
      const [l, r] = input.split('=').map((s) => py(read(s)));
      const mine = `sympy.FiniteSet(${ours.solutions.map((s) => py(s.s)).join(', ')})`;
      // compared as numbers (SymPy writes complex roots in its own shapes)
      check = complex
        ? `same_roots(sympy.solveset(((${l}) - (${r})).subs(x, X), X, domain=sympy.S.Complexes), ${mine})`
        : `sympy.simplify(sympy.solveset(sympy.Eq(${l}, ${r}), x, domain=sympy.S.Reals).symmetric_difference(${mine})) == sympy.S.EmptySet`;
    } else if (op === 'diff') check = `sympy.simplify(${py(ours.result.s)} - sympy.diff(${f}, x)) == 0`;
    else if (op === 'integrate') check = `sympy.simplify(sympy.diff(${py(ours.result.s)}, x) - (${f})) == 0`;
    else check = `sympy.simplify(${py(ours.result.s)} - (${f})) == 0`;
        // SymPy can't always simplify |x| away (d/dx ln|x| - 1/x): then compare at a few points
    const numeric = op === 'solve' ? 'False' : `numeric(${op === 'integrate' ? `sympy.diff(${py(ours.result.s)}, x) - (${f})` : op === 'diff' ? `${py(ours.result.s)} - sympy.diff(${f}, x)` : `${py(ours.result.s)} - (${f})`})`;
    lines.push(`try:\n    out.append("ok" if ${check} else "ok (numeric)" if ${numeric} else "differs")\nexcept Exception as e:\n    out.append("error: " + str(e).splitlines()[0])`);
  }
}
lines.push('print("\\n".join(out))');

const r = spawnSync('python3', ['-c', lines.join('\n')], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(2);
}
const results = r.stdout.trim().split('\n');
let bad = 0;
results.forEach((res, i) => {
  if (res.startsWith('ok')) return;
  bad++;
  console.log(`${res.padEnd(8)} ${labels[i]}`);
});
console.log(`${results.length - bad}/${results.length} agree with SymPy`);
process.exitCode = bad ? 1 : 0;
