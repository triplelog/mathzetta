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
  simplify: ['2x + 3x', 'sqrt(72)', 'sin(pi/6) + cos(pi/3)', 'sin(7pi/6)', 'tan(5pi/4)', 'sin(x)^2 + cos(x)^2 + 1', 'ln(e^(2x))', '(x^2 - 1)/(x - 1)',
    '(x + 1)^2 - x^2', 'log_2(8) + log_8(4)', 'sqrt(2) sqrt(6)', '1/3 + 1/6 - 0.25', 'e^x e^(2x)', 'arcsin(1/2) + arccos(1/2)', '(x^3 - 8)/(x - 2)', '2^(1/2) * 2^(2/3)'],
  expand: ['(x + 1)^3', '(x - y)(x + y)', '(2x - 3)^4', '(a + b + c)^2', '(x + 1)(x^2 - x + 1)'],
  factor: ['x^2 - 5x + 6', 'x^3 - x', '6x^2 + 9x', 'x^4 - 16', '2x^2 - x - 1', 'x^3 + 27', '4x^2 - 9y^2', 'x^3 - 6x^2 + 11x - 6'],
  cancel: ['(x^2 - 1)/(2x - 2)', '1/x + 1/y', '(x^2 + 2x + 1)/(x^2 - 1)', 'x/(x^2 + x)'],
  diff: ['x^3', 'x^2 sin(x)', 'e^(2x) cos(3x)', 'ln(x^2 + 1)', 'sqrt(x)', '(x + 1)/(x - 1)', 'sin(x)^2', 'arctan(2x)', 'x^x', 'tan(x)',
    'sec(x)', '\\sqrt[3]{x}', 'log_2(x)', 'arcsin(x)', 'cosh(x^2)', 'e^(-x^2/2)', 'x/(x^2 + 1)', 'ln(sin(x))', '|x|', '2^x'],
  integrate: ['x^2', '3x^2 + 2x + 1', '1/x', 'cos(3x + 1)', 'e^(2x)', 'x e^x', 'x^2 e^x', 'x sin(x)', 'ln(x)', 'x ln(x)', '1/(x^2 + 1)', 'sqrt(x)', 'tan(x)',
    '1/(x^2 - 1)', 'x^2/(x^2 + 1)', '(x^3 + 1)/(x - 1)', 'x arctan(x)', '(2x + 1)^5', '1/(2x + 1)', 'sin(x)^2 + cos(x)^2', 'x cos(2x)', '5^x', '1/sqrt(1 - x^2)', 'sinh(x)'],
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
    try {
      ours = op === 'solve' ? cas.solve(input, 'x', { steps: false }) : op === 'diff' || op === 'integrate' ? cas[op](input, 'x', { steps: false }) : cas[op](input, { steps: false });
    } catch (error) {
      labels.push(`${op} ${input}: the CAS failed: ${error.message}`);
      lines.push('out.append("skip")');
      continue;
    }
    labels.push(`${complex ? 'complex ' : ''}${op} ${input} → ${ours.text}`);
    const f = py(read(input.split('=')[0]));
    let check;
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
