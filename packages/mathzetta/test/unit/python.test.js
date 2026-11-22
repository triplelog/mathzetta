import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test, eq, throws } from '../harness.js';
import {
    toPython, toPythonFunction, checkGeneratedPython, readPythonTemplate, fillPythonTemplate, preparePythonTemplate, pythonName,
    evaluate, UnsafeCodeError,
} from '../../src/all.js';

// Machines without python3 (or numpy) skip the tests that run Python.
const hasPython = spawnSync('python3', ['--version']).status === 0;
const hasNumpy = hasPython && spawnSync('python3', ['-c', 'import numpy']).status === 0;
const hasSympy = hasPython && spawnSync('python3', ['-c', 'import sympy']).status === 0;
const CLI = new URL('../../tools/python-template.js', import.meta.url).pathname;
const FIXTURES = new URL('../fixtures/python/', import.meta.url).pathname;
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const runPython = (source) => {
    const r = spawnSync('python3', ['-c', source], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout;
};

suite('python: names', () => {
    test('keywords get an underscore', () => {
        eq(toPython('lambda x'), 'lambda_ * x');
        eq(pythonName('in'), 'in_');
        eq(pythonName('rate'), 'rate');
    });
});

suite('python: functions', () => {
    test('a definition names the function and its parameters', () => {
        const { tree, ...fn } = toPythonFunction('f(x) = x^2 + 3x');
        eq(tree.op, '+');
        eq(fn, {
            code: 'def f(x):\n    # f(x) = x^2 + 3x\n    return x ** 2 + 3 * x\n', name: 'f', params: ['x'], imports: [],
            formula: 'f(x) = x^2 + 3x', latex: 'x^2 + 3x',
        });
    });
    test('without one, the parameters are the variables in order', () => {
        const fn = toPythonFunction('A = P_0 e^{rt}');
        eq([fn.name, fn.params, fn.imports], ['A', ['P_0', 'r', 't'], ['import math']]);
    });
    test('declared names are read whole, as values', () => {
        eq(toPythonFunction('f(rate, dt) = rate dt').code.split('\n')[2], '    return rate * dt');
        eq(toPythonFunction('r P (1 - P/K)', { params: ['P', 'r', 'K'] }).code.split('\n')[2], '    return r * P * (1 - P / K)');
    });
    test('a definition may name some of the declared parameters', () => {
        eq(toPythonFunction('growth(P) = r P', { params: ['P', 'r'] }).params, ['P', 'r']);
        throws(() => toPythonFunction('growth(Q) = r Q', { params: ['P', 'r'] }), /growth\(Q\) should be growth\(P, r\)/);
        // naming another function, it is an equation: g(P) == P
        throws(() => toPythonFunction('g(P) = P', { name: 'growth' }), /the function "g"/);
        eq(toPythonFunction('league = "AL"', { name: 'keep', params: ['data'], columns: ['league'], table: 'data' }).code.includes('return league == "AL"'), true);
    });
    test('unknown names are refused, naming them', () => {
        throws(() => toPythonFunction('r P / M', { name: 'growth', params: ['P', 'r'] }), /growth\(P, r\): unknown name M \(it can use P, r\)/);
        eq(toPythonFunction('beta S', { params: ['S'], globals: ['beta'] }).params, ['S']);
    });
    test('bound names are not parameters', () => {
        eq(toPythonFunction('\\sum_{i=1}^{n} i^2').params, ['n']);
        eq(toPythonFunction('int(x^2, x, 0, b)').imports, ['import scipy.integrate']);
    });
    test('derivatives, limits and integrals without limits are refused', () => {
        throws(() => toPythonFunction('dP/dt = r P'), /derivative can't be computed numerically/);
        throws(() => toPythonFunction('int(x^2, x)'), /integral with no bounds \(the SymPy flavour/);
    });
    test('the formula comment stays on one line', () => {
        eq(toPythonFunction('x + 1\nimport os').code.split('\n').length, 4);
    });
});

suite('python: checkGeneratedPython', () => {
    test('passes what the renderer writes', () => {
        const code = '(1 if float(x).is_integer() else 0) + math.sqrt(y) + sum(i for i in range(1, n + 1))';
        eq(checkGeneratedPython(code, { variables: ['x', 'y', 'n'] }), code);
        eq(checkGeneratedPython('scipy.integrate.quad(lambda t: t, 0, 1)[0]'), 'scipy.integrate.quad(lambda t: t, 0, 1)[0]');
    });
    test('refuses calls, attributes and syntax off the whitelist', () => {
        for (const code of ['print(x)', 'exec("1")', 'ｅｘｅｃ("1")', 'open("f")', 'x.__class__', '().__class__',
            'math.sqrt.__self__', 'math.os', 'x; y', 'x = 1', "'a'", 'x # c', 'y', '__x', 'f(x)']) {
            throws(() => checkGeneratedPython(code, { variables: ['x'] }), /not allowed/);
        }
        eq(checkGeneratedPython('f(x)', { variables: ['x'], functions: ['f'] }), 'f(x)');
    });
    test('formulas that would call anything else fail to become functions', () => {
        for (const formula of ['print(x)', 'exec("import os")', 'ｅｘｅｃ("1")', 'x.y']) {
            throws(() => toPythonFunction(formula), /not allowed/);
        }
        let error;
        try { toPythonFunction('open("f")'); } catch (e) { error = e; }
        eq(error instanceof UnsafeCodeError, true);
    });
});

suite('python: numpy', () => {
    test('element-wise forms', () => {
        eq(toPython('x > 0 ? 1/x : 0', { numpy: true }), 'np.where(x > 0, 1 / x, 0)');
        eq(toPython('max(a, b, c) + |x|', { numpy: true }), 'np.maximum(np.maximum(a, b), c) + np.abs(x)');
        eq(toPython('x ∈ [0, 1) and y ∉ {1, 2}', { numpy: true }),
            'np.logical_and(np.logical_and(x >= 0, x < 1), np.logical_not(np.isin(y, [1, 2])))');
        eq(toPython('arcsin(x) + ln(x)', { numpy: true }), 'np.arcsin(x) + np.log(x)');
    });
    test('chained comparisons are joined element-wise', () => {
        eq(toPython('a < b ≤ c < d', { numpy: true }), 'np.logical_and(np.logical_and(a < b, b <= c), c < d)');
        eq(toPython('3 < x < 7'), '3 < x < 7');
    });
    test('a numpy function takes arrays and judges errors on the result', () => {
        const fn = toPythonFunction('f(x) = 1/x', { numpy: true });
        eq(fn.imports, ['import numpy as np']);
        eq(fn.code.includes('    x = np.asarray(x, dtype=float)\n'), true);
        eq(fn.code.includes('raise FloatingPointError("f(x): no finite value'), true);
        eq(toPythonFunction('f(x) = 1/x', { numpy: true, errors: 'nan' }).code.includes('raise'), false);
    });
});

suite('python: errors', () => {
    test("errors: 'nan' returns math.nan instead of raising", () => {
        const fn = toPythonFunction('f(x) = 1/x', { errors: 'nan' });
        eq(fn.code, 'def f(x):\n    # f(x) = 1/x\n    try:\n        return 1 / x\n    except (ArithmeticError, ValueError):\n        return math.nan\n');
        eq(fn.imports, ['import math']);
        throws(() => toPythonFunction('x', { errors: 'ignore' }), /errors is 'raise' or 'nan'/);
    });
    test('a template sets numpy and errors, and fill options override it', () => {
        const t = '# mathzetta-options: numpy errors=nan\nimport numpy as np\n# mathzetta: f(x) = 1/x\n';
        const filled = fillPythonTemplate(t);
        eq(filled.match(/import numpy as np/g).length, 1);
        eq(filled.includes("with np.errstate(all='ignore')") && !filled.includes('raise'), true);
        eq(fillPythonTemplate(t, {}, { numpy: false, errors: 'raise' }).includes('    return 1 / x\n'), true);
        throws(() => fillPythonTemplate('# mathzetta-options: fast\n'), /"fast" is not numpy/);
    });
});

const HEADER = ['player', 'year', 'team', 'G', 'AB', 'H', '2B', 'HR', 'value'];

suite('python: formulas over columns', () => {
    const over = (formula, o = {}) => toPythonFunction(formula, { name: 'f', params: ['data'], columns: HEADER, numpy: true, ...o });
    test('columns are read from the table by name, matched as whole words', () => {
        const fn = over('(H + 2B) / ab');
        eq(fn.code.includes('    H = np.asarray(data["H"])\n'), true);
        eq(fn.code.includes('    _2B = np.asarray(data["2B"])\n'), true);
        eq(fn.code.includes('    _value = np.asarray((H + _2B) / AB)\n'), true);
        eq(fn.params, ['data']);
    });
    test('a column named like a helper variable gets another name', () => {
        eq(over('value + 1').code.includes('value = np.asarray(data["value"])'), true);
        eq(toPythonFunction('_value + 1', { name: 'f', params: ['data'], columns: ['_value'], numpy: true }).code
            .includes('_value_ = np.asarray(data["_value"])'), true);
    });
    test('one-argument sum, max, mean … are over the column', () => {
        eq(over('sum(H) / sum(AB)').code.includes('np.nansum(H) / np.nansum(AB)'), true);
        eq(over('[0, 1.1 max(HR)]').code.includes('[0, 1.1 * np.nanmax(HR)]'), true);
        eq(over('median(HR) + stdev(HR)').code.includes('np.nanmedian(HR) + np.nanstd(HR)'), true);
        eq(over('max(HR, 2B)').code.includes('np.maximum(HR, _2B)'), true);
        eq(over('1000 sum(HR) / sum(AB)').latex, '\\frac{1000\\left(\\sum \\mathrm{HR}\\right)}{\\sum \\mathrm{AB}}');
    });
    test('text columns compare with strings; an equation is not a definition', () => {
        eq(over('team = "NYA" and year >= 2000', { name: 'keep' }).code.includes('np.logical_and(team == "NYA", year >= 2000)'), true);
        eq(over('team = "NYA"', { name: 'keep' }).name, 'keep');
    });
    test('without numpy a column is a value from a row', () => {
        eq(over('HR + 1', { numpy: false }).code, 'def f(data):\n    # HR + 1\n    HR = data["HR"]\n    return HR + 1\n');
    });
    test('words that are not columns are refused', () => {
        throws(() => over('HR / foo'), /f\(data\): unknown name foo \(not a column\)/);
        throws(() => toPythonFunction('HR', { name: 'f', params: ['x'], columns: HEADER }), /has no parameter data for the columns/);
    });
});

suite('python: templates over a table', () => {
    const CHART = '# mathzetta-data: rows.csv\n# mathzetta-options: numpy\n# mathzetta: keep(data: columns) = HR > 10\n# mathzetta: y(data: columns, scale) = scale H / AB\n';
    test('the slot knows its columns parameter, the template its data', () => {
        const read = readPythonTemplate(CHART);
        eq([read.data, read.numpy, read.slots.map((s) => [s.name, s.params, s.columns])],
            ['rows.csv', true, [['keep', ['data'], 'data'], ['y', ['data', 'scale'], 'data']]]);
        throws(() => readPythonTemplate('# mathzetta: f(a: columns, b: columns)\n'), /only one parameter can hold the columns/);
    });
    test('filling needs the header; the data line becomes DATA_FILE', () => {
        throws(() => fillPythonTemplate(CHART), /keep reads columns: pass the table's header/);
        const filled = fillPythonTemplate(CHART, {}, { columns: HEADER, data: '/data/rows.csv' });
        eq(filled.startsWith('DATA_FILE = "/data/rows.csv"\n'), true);
        eq(filled.includes('def y(data, scale):\n'), true);
        eq(filled.includes('keep.formula = "HR > 10"\nkeep.latex = "\\\\mathrm{HR} > 10"'), true);
    });
});

const TEMPLATE = `R = 0.5

def run():
    # mathzetta: rate(x, r) = r x
    return rate(2, R) + twice(3)

# mathzetta: twice(y) = 2y
print(run())
`;

suite('python: templates', () => {
    test('slots are read with their signatures and defaults', () => {
        eq(readPythonTemplate(TEMPLATE), { slots: [
            { name: 'rate', params: ['x', 'r'], columns: null, formula: 'r x', line: 4, indent: '    ', doc: '' },
            { name: 'twice', params: ['y'], columns: null, formula: '2y', line: 7, indent: '', doc: '' },
        ], data: null, description: '' });
        throws(() => readPythonTemplate('# mathzetta: oops'), /line 1: a slot is written/);
        throws(() => readPythonTemplate('# mathzetta: f(x)\n# mathzetta: f(y)'), /second slot called f/);
    });
    test('filling swaps each slot for its def, keeping the indent', () => {
        eq(fillPythonTemplate(TEMPLATE, { twice: 'y + y' }), `R = 0.5

def run():
    def rate(x, r):
        # r x
        return r * x
    rate.formula = "r x"
    rate.latex = "rx"
    return rate(2, R) + twice(3)

def twice(y):
    # y + y
    return y + y
twice.formula = "y + y"
twice.latex = "y + y"
print(run())
`);
    });
    test('imports go with the function unless the program has them', () => {
        const filled = fillPythonTemplate('# mathzetta: f(x) = sqrt(x)\n');
        eq(filled.startsWith('import math\ndef f(x):'), true);
        eq(fillPythonTemplate('import math\n# mathzetta: f(x) = sqrt(x)\n').match(/import math/g).length, 1);
        eq(fillPythonTemplate('# mathzetta: f(x) = sqrt(x)\n# mathzetta: g(x) = ln(x)\n').match(/import math/g).length, 1);
    });
    test('slots may call each other and declared functions', () => {
        eq(fillPythonTemplate('# mathzetta: f(x) = 2 g(x)\n# mathzetta: g(x) = h(x)\n', {}, { functions: ['h'] }).includes('return 2 * g(x)'), true);
    });
    test("a slot's doc is the comment above it; the description the docstring's first paragraph", () => {
        const read = readPythonTemplate('"""A chart\nof things.\n\nMore."""\nimport math\n\n# Which rows:\n# true or false.\n# mathzetta: keep(x) = x > 1\n# mathzetta: y(x) = x\n');
        eq([read.description, read.slots.map((s) => s.doc)], ['A chart of things.', ['Which rows: true or false.', '']]);
    });
    test('preparePythonTemplate reports every slot, and never throws for a formula', () => {
        const prepared = preparePythonTemplate(TEMPLATE, { rate: 'r x / q', twice: 'print(y)' });
        eq(prepared.program, null);
        eq(prepared.slots.map((s) => [s.name, s.default, s.formula, s.error]), [
            ['rate', 'r x', 'r x / q', 'rate(x, r): unknown name q (it can use x, r)'],
            ['twice', '2y', 'print(y)', 'twice(y): not allowed in a formula: the function "print"'],
        ]);
        const good = preparePythonTemplate(TEMPLATE, { twice: 'y + y' });
        eq(good.program, fillPythonTemplate(TEMPLATE, { twice: 'y + y' }));
        eq([good.slots[1].latex, good.slots[1].tree.op, good.slots[1].code.startsWith('def twice(y):')], ['y + y', '+', true]);
        eq(preparePythonTemplate(TEMPLATE, { twise: 'y' }).error, 'the template has no slot called twise (it has rate, twice)');
        eq(preparePythonTemplate(TEMPLATE, { twice: '  ' }).slots[1].error, 'no formula for twice(y)');
    });
    test('errors say which line', () => {
        throws(() => fillPythonTemplate(TEMPLATE, { twice: 'y + z' }), /line 7: twice\(y\): unknown name z/);
        throws(() => fillPythonTemplate(TEMPLATE, { twise: 'y' }), /no slot called twise \(it has rate, twice\)/);
        throws(() => fillPythonTemplate('# mathzetta: f(x)\n'), /line 1: no formula for f\(x\)/);
    });
});

if (hasPython) {
    suite('python: runs in python3', () => {
        test('expressions give what evaluate() gives', () => {
            const cases = ['x^2 + 3x - 1', 'sin(x)^2 + cos(x)^2', '|x - 5| / 2', 'sqrt(x) + ln(x) + log_2(x)', '2^-x',
                'max(x, 3) + min(1, x)', 'x mod 3', '5! / 3!', 'csc(x) + sec(x) + cot(x)', 'floor(x) + ceil(x)',
                '(x + 1)(x - 1) / x', 'x > 2 and x < 5', 'x ∈ [1, 3)', 'e^x - pi', 'round(x, 2)', 'arctan(x) + atan2(x, 1)'];
            const scope = { x: 2.7 };
            const lines = cases.map((c) => `print(repr(${toPython(c)}))`);
            const out = runPython(`import math\nx = ${scope.x}\n${lines.join('\n')}`).trim().split('\n');
            cases.forEach((c, i) => {
                const want = evaluate(c, scope);
                const got = out[i] === 'True' ? true : out[i] === 'False' ? false : Number(out[i]);
                eq(typeof want === 'number' ? Math.abs(got - want) < 1e-9 : got === want, true, `${c}: python ${out[i]}, evaluate ${want}`);
            });
        });
        test('1/0 raises by default, or gives nan', () => {
            const program = (options) => `${fillPythonTemplate('# mathzetta: f(x) = 1/x\n', {}, options)}
try:
    print(repr(f(0)))
except ArithmeticError as e:
    print(type(e).__name__)
`;
            eq(runPython(program()).trim(), 'ZeroDivisionError');
            eq(runPython(program({ errors: 'nan' })).trim(), 'nan');
        });
        test('numpy functions work on arrays; a branch not taken does not raise', () => {
            const program = (formula, options = {}) => `${fillPythonTemplate('import numpy as np\n# mathzetta: f(x)\n', { f: formula }, { numpy: true, ...options })}
try:
    print(f(np.array([-1.0, 0.0, 2.0])).tolist())
except FloatingPointError as e:
    print('FloatingPointError')
`;
            eq(runPython(program('x > 0 ? 1/x : 0')).trim(), '[0.0, 0.0, 0.5]');
            eq(runPython(program('max(x, 0)^2 + (x ∈ [0, 1) ? 10 : 0)')).trim(), '[0.0, 10.0, 4.0]');
            eq(runPython(program('1/x')).trim(), 'FloatingPointError');
            eq(runPython(program('1/x', { errors: 'nan' })).trim(), '[-1.0, inf, 0.5]');
            eq(runPython(`${fillPythonTemplate('# mathzetta: f(x) = 3 < x < 7\n', {}, { numpy: true })}\nprint(f([1, 5, 9]).tolist(), f(5))`).trim(), '[False, True, False] True');
        });
        test('a filled template runs', () => {
            eq(runPython(fillPythonTemplate(TEMPLATE)).trim(), '7.0');
        });
        test('the example model runs, as is and customized', () => {
            const template = readFileSync(new URL('../../examples/python/logistic.py', import.meta.url), 'utf8');
            const years = (formula) => runPython(fillPythonTemplate(template, formula)).trim().split('\n');
            eq(years().length, 11);
            const last = (lines) => Number(lines.at(-1).trim().split(/\s+/)[1]);
            eq(last(years({ growth: 'r P (1 - P/K) - h' })) > last(years({ growth: 'r P (1 - P/K) - 2h' })), true);
        });
    });
}

suite('python: mathzetta-python', () => {
    test('--slots lists the slots and the columns', () => {
        const r = cli(join(FIXTURES, 'table.py'), '--slots');
        eq(r.status, 0, r.stderr);
        eq(r.stdout.startsWith('keep(data) = year >= 2000\nvalue(data) = HR / AB\n'), true);
        eq(r.stdout.includes('player, year, AB, HR, SB, CS'), true);
    });
    test('fills from slot=formula, with the data path made absolute', () => {
        const r = cli(join(FIXTURES, 'table.py'), 'value=player = "B" ? 1 : 0');
        eq(r.status, 0, r.stderr);
        eq(r.stdout.includes('np.where(player == "B", 1, 0)'), true);
        eq(/^DATA_FILE = "\/.*\/test\/fixtures\/python\/rows\.csv"$/m.test(r.stdout), true);
    });
    test('reports a bad formula and fails', () => {
        const r = cli(join(FIXTURES, 'table.py'), 'value=open("f")');
        eq([r.status, r.stderr.trim()], [1, 'mathzetta-python: line 12: value(data): not allowed in a formula: the function "open"']);
    });
});

// The charts over baseball data that used to be here are pyslots' examples now (tabdn.com/pyslots), tested there.
if (hasNumpy) {
    suite('python: mathzetta-python --run', () => {
        test('runs the filled program', () => {
            const r = cli(join(FIXTURES, 'table.py'), '--run');
            eq([r.status, r.stdout], [0, '0.100 0.050 0.040\n'], r.stderr);
            eq(cli(join(FIXTURES, 'table.py'), 'keep=HR > 25', 'value=HR + 1', '--run').stdout, '41.000 31.000\n');
        });
        test('1/0 raises by default, and gives nan with --errors nan', () => {
            const raised = cli(join(FIXTURES, 'table.py'), 'value=SB / CS', '--run');
            const stderr = raised.stderr.replace(/\x1b\[[0-9;]*m/g, '');   // Python 3.13+ colors tracebacks
            eq([raised.status !== 0, /FloatingPointError: value\(data\): no finite value/.test(stderr)], [true, true]);
            eq(cli(join(FIXTURES, 'table.py'), 'value=SB / CS', '--errors', 'nan', '--run').stdout, '5.000 nan 2.000\n');
        });
    });
}

suite('python: sympy', () => {
    test('exact and symbolic', () => {
        eq(toPython('1/3 x + 0.25', { sympy: true }), 'sympy.Rational(1, 3) * x + sympy.Rational(1, 4)');
        eq(toPython('\\frac{d}{dx} x^3', { sympy: true }), 'sympy.diff(x ** 3, x)');
        eq(toPython('\\int_0^1 t^2 dt', { sympy: true }), 'sympy.integrate(t ** 2, (t, 0, 1))');
        eq(toPython('y = e^x', { sympy: true }), 'sympy.Eq(y, sympy.exp(x))');
        throws(() => toPython('x', { sympy: true, numpy: true }), /numpy or sympy, not both/);
        throws(() => toPython('"AL"', { sympy: true }), /No SymPy for text/);
    });
    test('the variable a derivative binds is a symbol; a parameter of the same name is substituted after', () => {
        const { code } = toPythonFunction('f(x) = \\frac{d}{dx} x^3', { sympy: true });
        eq(code.includes('x = sympy.Symbol("x")') && code.includes('.subs({x: _x})'), true, code);
        const g = toPythonFunction('F(b) = \\int_0^b t^2 dt', { sympy: true });
        eq(g.params, ['b']);
        eq(g.code.includes('t = sympy.Symbol("t")'), true, g.code);
        throws(() => toPythonFunction('f(x) = \\frac{d}{dx} x^3'), /can't be computed numerically \(sympy: true can\)/);
        throws(() => toPythonFunction('f(x) = x', { sympy: true, numpy: true }), /not both/);
    });
    test('a template says sympy', () => {
        const out = fillPythonTemplate('# mathzetta-options: sympy\n# mathzetta: f(x) = d/dx x^2\n');
        eq(out.includes('import sympy') && out.includes('sympy.diff'), true, out);
    });
    if (hasSympy) {
        test('runs in SymPy', () => {
            const fns = ['f(x) = \\frac{d}{dx} x^3', 'F(b) = \\int_0^b t^2 dt', 'g(n) = \\sum_{i=1}^{n} i^2',
                'k(r) = \\lim_{x \\to 0} \\sin(r x)/x', 'p(x) = 1/3 x + 0.5',
                'q(x) = \\begin{cases} x^2 & x > 0 \\\\ -x & \\text{otherwise} \\end{cases}'];
            const code = fns.map((f) => toPythonFunction(f, { sympy: true }).code).join('\n\n');
            const out = runPython(`import sympy\n\n${code}\n\nX = sympy.Symbol("x")\nprint(f(2), f(X), F(3), g(10), k(5), p(3), q(-2), q(3))`);
            eq(out.trim(), '12 3*x**2 9 385 5 3/2 2 9');
        });
    }
});

// ---- added 2026-11-11: negatives and halves, where Python's own %, round and format differ from math ----
suite('python: negatives and halves give what evaluate() gives', () => {
    const CASES = ['x mod 3', 'x mod -3', 'round(x)', 'round(x, 1)', 'trunc(x)', 'cbrt(x)', 'root(5, x)', 'x xor 0', 'x ≈ 0',
        '-1*(x+1)', 'max(x)', 'fixed(x, 0)', 'fixed(x, 2)'];
    const VALUES = [-7, -2.5, -2.25, -0.5, 0, 0.125, 2.5, 7];
    const check = (write, preamble, label) => {
        const lines = VALUES.flatMap((x) => CASES.map((c) => `x = ${x}\nprint(repr(${write(c)}))`));
        const out = runPython(`${preamble}\n${lines.join('\n')}`).trim().split('\n');
        let k = 0;
        for (const x of VALUES) {
            for (const c of CASES) {
                // numpy's reprs: array(-7.), np.float64(2.5), np.True_, array('-3', dtype='<U2')
                const raw = out[k++].replace(/^(?:np\.)?\w+\((.*?)(?:, dtype=[^)]*)?\)$/, '$1').replace(/^np\.(True|False)_$/, '$1');
                const want = evaluate(c, { x });
                const got = raw === 'True' ? true : raw === 'False' ? false : /^['"]/.test(raw) ? raw.slice(1, -1) : Number(raw.replace(/^np\.\w+\(|\)$/g, ''));
                const same = typeof want === 'number' ? Math.abs(got - want) < 1e-9 : String(got) === String(want);
                eq(same, true, `${label} ${c} at x = ${x}: python ${raw}, evaluate ${want}`);
            }
        }
    };
    if (!hasPython) {
        test('python3 not found: skipped', () => {});
        return;
    }
    test('python', () => check((c) => toPython(c), 'import math', 'python'));
    // .item(): the plain Python value, every digit (an array's repr keeps eight)
    if (hasNumpy) test('numpy', () => check((c) => `np.asarray(${toPython(c, { numpy: true })}).item()`, 'import numpy as np', 'numpy'));
});

// The review before 1.2 (2026-11-19): plain Python's round and fixed raised on NaN and ±∞ (math.floor)
suite('python: NaN and infinity', () => {
    if (hasPython) test('round and fixed pass NaN and ±∞ through, as JavaScript and evaluate() do', () => {
        const lines = ['round(x)', 'round(x, 2)', 'fixed(x, 2)', 'round(x + 1)', 'round(x*y + 1, 2)'].map((f) => `print(repr(${toPython(f)}))`);
        const out = (x) => runPython(`import math\nx = ${x}\ny = 2.0\n${lines.join('\n')}`).trim().split('\n');
        eq(out('float("nan")'), ['nan', 'nan', "'nan'", 'nan', 'nan']);
        eq(out('float("inf")'), ['inf', 'inf', "'inf'", 'inf', 'inf']);
        eq(out('-2.5'), ['-3', '-2.5', "'-2.50'", '-2', '-4.0']);
    });
});

// Python chains every comparison: y == x > 0 is (y == x) and (x > 0). A comparison inside another is bracketed.
suite('python: a comparison inside a comparison', () => {
    const cases = ['(y = x > 0) ? 1 : 2', 'y = (x > 0)', '3 < x < 7', 'x > 0 = (y < 1)', 'y ≠ (x ≤ 1)', '(a < b) = (c < d)'];
    const scopes = [{ x: 2, y: 1, a: 1, b: 2, c: 2, d: 3 }, { x: -1, y: 0, a: 3, b: 2, c: 2, d: 1 }, { x: 1, y: 1, a: 1, b: 1, c: 1, d: 1 }];
    test('written with brackets', () => {
        eq(toPython('y = (x > 0)'), 'y == (x > 0)');
        eq(toPython('(y = x > 0) ? 1 : 2'), '(1 if (y == (x > 0)) else 2)');
        eq(toPython('3 < x < 7'), '3 < x < 7');   // a chain written as one stays one
        eq(toPython('y = (x > 0)', { numpy: true }), 'y == (x > 0)');
    });
    const run = (flavor, wrap) => () => {
        for (const scope of scopes) {
            const vars = Object.entries(scope).map(([k, v]) => `${k} = ${v}`).join('\n');
            const lines = cases.map((c) => `print(float(${wrap(toPython(c, flavor))}))`).join('\n');
            const got = runPython(`import math\n${flavor.numpy ? 'import numpy as np\n' : ''}${vars}\n${lines}`).trim().split('\n').map(Number);
            eq(got, cases.map((c) => Number(evaluate(c, scope))), JSON.stringify(scope));
        }
    };
    if (hasPython) test('Python gives what evaluate() gives', run({}, (code) => code));
    if (hasNumpy) test('numpy gives what evaluate() gives', run({ numpy: true }, (code) => `np.asarray(${code}).item()`));
});

// "ab" in name, startswith(name, "ab"): the inline helpers, which the gate knows as exact text only
suite('python: text search', () => {
    const CASES = [
        ['"ab" in "CAB"', true], ['"ab" ∉ "CAB"', false], ['startswith("Abc", "ab")', true], ['startswith("Abc", "bc")', false],
        ['"é" in "É"', false], ['"%" in "a_b"', false], ['"6" in 62', true], ['2 * startswith("ab", "A") + 1', 3], ['2 * ("x" ∉ "ab") + 1', 3],
    ];
    test('toPythonFunction takes what toPython writes, plain and numpy', () => {
        for (const f of ['"ab" in name', '"ab" ∉ name', 'startswith(name, "ab")', 'not startswith(name, p) and x > 1']) {
            for (const numpy of [false, true]) {
                const fn = toPythonFunction(f, { numpy });
                eq(fn.params.includes('name'), true, f);
                eq(checkGeneratedPython(toPython(f, { numpy }), { variables: fn.params }), toPython(f, { numpy }));
            }
        }
        // numpy keeps a searched value as it comes (text), not as floats
        eq(toPythonFunction('startswith(name, "a") or x > 1', { numpy: true }).code.includes('name = np.asarray(name)\n'), true);
        eq(toPythonFunction('startswith(name, "a") or x > 1', { numpy: true }).code.includes('x = np.asarray(x, dtype=float)\n'), true);
    });
    test('the gate opens for the exact helpers only, not for what is inside them', () => {
        for (const code of ['str(name).lower()', '"ab".startswith("a")', '(lambda s: s.lower())(name)',
            '"".join(name)', 'name.__class__', toPython('"ab" in name').replace('f(t) in f(s)', 'f(t) in f(s) or open(s)'),
            toPython('"ab" in name').replace('(name, "ab")', '')]) {
            let error = null;
            try { checkGeneratedPython(code, { variables: ['name', 's', 't'] }); } catch (e) { error = e; }
            eq(error instanceof UnsafeCodeError, true, code);
        }
    });
    if (hasPython) test('Python gives what evaluate() gives; None and NaN are empty text, 62.0 is 62', () => {
        const lines = CASES.map(([f]) => `print(int(${toPython(f)}))`);
        const fn = toPythonFunction('"aa" in name');
        const sw = toPythonFunction('startswith(name, "6")', { name: 'g' });
        const out = runPython([fn.code, sw.code, ...lines,
            'print([int(f(v)) for v in ["AAron", "aÀa", None, float("nan"), 62.0]])',
            'print([int(g(v)) for v in [62.0, 6.5, None, True, "6x"]])'].join('\n')).trim().split('\n');
        eq(out.slice(0, CASES.length).map(Number), CASES.map(([f, want]) => Number(want)));
        eq(out.slice(0, CASES.length).map(Number), CASES.map(([f]) => Number(evaluate(f))));
        eq(out[CASES.length], '[1, 0, 0, 0, 0]');
        eq(out[CASES.length + 1], '[1, 1, 0, 0, 1]');
    });
    if (hasNumpy) test('numpy searches element by element', () => {
        const fn = toPythonFunction('"aa" in name', { numpy: true });
        const sw = toPythonFunction('not startswith(name, "ted")', { numpy: true, name: 'g' });
        const out = runPython(['import numpy as np', fn.code, sw.code,
            'v = np.array(["Aaron Judge", "Ted Williams", None, float("nan"), 62.0], dtype=object)',
            'print(f(v).tolist(), g(v).tolist(), f(np.array(["xaAx", "b"])).tolist(), f(np.array([], dtype=str)).tolist(), bool(f("AAa")))',
            ...CASES.map(([f]) => `print(int(np.asarray(${toPython(f, { numpy: true })}).item()))`)].join('\n')).trim().split('\n');
        eq(out[0], '[True, False, False, False, False] [True, False, True, True, True] [True, False] [] True');
        eq(out.slice(1).map(Number), CASES.map(([, want]) => Number(want)));
    });
});
