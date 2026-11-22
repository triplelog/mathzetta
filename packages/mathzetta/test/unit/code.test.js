/**
 * Code: what JavaScript, Python (plain, numpy, SymPy), SQL (PostgreSQL, SQLite) and spreadsheets write — brackets,
 * chains, sets, the SymPy flavor, the SQLite dialect, Excel's own rules. python.test.js runs the Python;
 * agreement.test.js runs JavaScript and SQLite against evaluate().
 */
import { suite, test, eq, throws } from '../harness.js';
import {
    calculate, createRowEvaluator, evaluate, forXlsxFile, parse, strToFunction, toExcel, toGLSL, toJavaScript,
    toLaTeX, toPython, toSQL, toText,
} from '../../src/all.js';

suite('code: brackets, factorials, reciprocal trig, constants, bounds', () => {
    test('division keeps its brackets in code', () => {
        eq(toJavaScript('(a+b)/(c+d)'), '(a + b) / (c + d)');
        eq(toPython('a/(b/c)'), 'a / (b / c)');
        eq(toSQL('(a+b)/(c+d)'), '(a + b) / (c + d)');
        eq(toText('a/(b*c)'), 'a / (b * c)');
    });
    test('Python exponents keep their brackets', () => {
        eq(toPython('2^(x+1)'), '2 ** (x + 1)');
        eq(toPython('e^(2x)'), 'math.e ** (2 * x)');
    });
    test('membership keeps both sides', () => {
        eq(toLaTeX('x ∈ S'), 'x \\in S');
        eq(toJavaScript('x ∈ S'), 'S.includes(x)');
        eq(toJavaScript('x ∈ [0, 1)'), '(x >= 0 && x < 1)');
        eq(toPython('2 ∉ {1, 3}'), '2 not in {1, 3}');
    });
    test('factorials', () => {
        eq(toJavaScript('5!'), '5 * 4 * 3 * 2 * 1');
        eq(toPython('(5!)^2'), '(5 * 4 * 3 * 2 * 1) ** 2');
        eq(toLaTeX('(5!)!'), '\\left(5!\\right)!');
        eq(new Function(`return ${toJavaScript('!7!')}`)(), false);
    });
    test('reciprocal trig functions evaluate', () => {
        eq(toJavaScript('sec(x)'), '1 / Math.cos(x)');
        for (const f of ['sec(x)', 'csc(x)', 'cot(x)']) {
            const js = new Function('x', `return ${toJavaScript(f)};`);
            for (const x of [-2.3, 0.4, 1, 2.9]) {
                const [got, want] = [js(x), evaluate(f, { x })];
                eq(Math.abs(got - want) <= 1e-12 * Math.max(1, Math.abs(want)), true, `${f} at ${x}: ${toJavaScript(f)} = ${got}, evaluate ${want}`);
            }
        }
    });
    test('constants', () => {
        eq(toJavaScript('∞'), 'Infinity');
        eq(toSQL('pi'), 'PI()');
        eq(toPython('true'), 'True');
    });
    test('a compound upper bound is still a bound, not a loop condition', () => {
        const js = toJavaScript('\\sum_{i=1}^{n+1} i');
        eq(js.includes('i<=n + 1'), true, js);
        eq(new Function('n', 'return ' + js)(3), 10);
    });
    test('Python: max of one number, not with its looser binding, ≈ with an absolute tolerance', () => {
        eq(toPython('max(x)'), 'x');
        eq(toPython('!a + 1'), '(not a) + 1');
        eq(toPython('!a = b'), '(not a) == b');
        eq(toSQL('!a + 1'), '(NOT a) + 1');
        eq(toPython('x ≈ 0'), 'abs((x) - (0)) < 1e-9');
        eq(toJavaScript('mean(c, c = -1, x)'), '((c + (c == -1) + x) / 3)');
    });
    test('one value is its own max or min, kept in brackets (it was a + b * 2)', () => {
        eq(toPython('max(a + b) * 2'), '(a + b) * 2');
        eq(toPython('min(not (x > 1)) + 1'), '(not (x > 1)) + 1');
        eq(toSQL('max(a + b) * 2', { dialect: 'sqlite' }), '(a + b) * 2');
        eq(toExcel('2 - max(a - b)'), '=2-(a-b)');
        eq(toGLSL('max(a + b) * 2'), '(a + b) * 2.0');
    });
});

suite('code: chains, text joins, mod, means, calls, sets', () => {
    test('3 < x < 7 is both links in code; displays keep the chain', () => {
        eq(toJavaScript('3 < x < 7'), '(3 < x && x < 7)');
        eq(toPython('3 < x < 7'), '3 < x < 7');   // Python chains comparisons itself
        eq(toPython('3 < x < 7', { sympy: true }), 'sympy.And(3 < x, x < 7)');
        eq(toSQL('3 < x < 7'), '(3 < x AND x < 7)');
        eq(toExcel('3 < x < 7'), '=AND(3<x, x<7)');
        eq(toGLSL('3 < x < 7'), '(3.0 < x && x < 7.0)');
        eq(toLaTeX('3 < x < 7'), '3 < x < 7');
    });
    test('+ on text joins: || in SQL, & in spreadsheets', () => {
        eq(toSQL('"a"+"b"+"c"'), "'a' || 'b' || 'c'");
        eq(toSQL('"x"+1', { dialect: 'sqlite' }), "'x' || 1");
        eq(toExcel('"a"+"b"'), '="a"&"b"');
        eq(toSQL('1+2'), '1 + 2');
    });
    test('x (mod n) with no congruence is x mod n in code too: the divisor\'s sign', () => {
        eq(evaluate('-7 (mod 8)'), 1);
        eq(createRowEvaluator(toJavaScript('-7 (mod 8)'))([]), 1);
        eq(toSQL('x (mod 3)'), toSQL('x mod 3'));
        eq(toSQL('a ≡ b (mod 3)'), 'MOD((a) - (b), 3) = 0');
    });
    test('PostgreSQL: a mean of whole numbers is not a whole-number division', () => {
        eq(toSQL('mean(1,2)'), '((1 + 2) / 2.0)');
    });
    test('a call is never repeated: x mod random() draws one number', () => {
        eq(toJavaScript('x mod random()').split('Math.random()').length, 2);
        eq(createRowEvaluator(strToFunction(['x'], 'x mod (x + 1)').jsFunction)([5]), 5);
    });
    test('a number in a set operation is a set of one in Python and SymPy', () => {
        eq(toPython('{1,2} ∪ 3'), 'sorted(set({1, 2}) | set([3]))');
        eq(toPython('{1,2} ∪ 3', { sympy: true }), 'sympy.Union(sympy.FiniteSet(1, 2), sympy.FiniteSet(3))');
    });
    test('outside a table a name may be a list: toJavaScript keeps membership', () => {
        eq(toJavaScript('team in name'), 'name.includes(team)');
    });
});

suite('code: what Excel, GLSL and PostgreSQL write for one meaning', () => {
    test('the same in the code that is only written (Excel, GLSL, PostgreSQL)', () => {
        eq(toExcel('-1*x^2'), '=-(x^2)');                    // Excel's minus binds tighter than ^
        eq(toExcel('sum(a, b) * c'), '=(a+b)*c');
        eq(toExcel('2*(a ≈ b)'), '=2*(ABS((a)-(b))<1E-9)');
        eq(toExcel('c = (a < b)'), '=c=(a<b)');               // spreadsheet comparisons share one precedence
        eq(toExcel('cbrt(x)'), '=IF(x<0, -POWER(-x, 1/3), POWER(x, 1/3))');
        eq(toExcel('50% * x'), '=50%*x');
        eq(toGLSL('round(a + b, 2)'), 'mz_round((a + b) * 100.0) / 100.0');
        eq(toGLSL('(a+b)^1*c'), '(a + b) * c');
        eq(toGLSL('a ≈ b - c'), '(abs(a - (b - c)) < 1e-5)');
        eq(toGLSL('round(x, 25)'), 'mz_round(x * 1.0e25) / 1.0e25');
        eq(toSQL('x mod 3'), 'MOD(MOD(x, 3) + 3, 3)');
        eq(toSQL('round(x, 2)'), 'ROUND(CAST(x AS NUMERIC), 2)');   // PostgreSQL's ROUND(x, d) takes NUMERIC only
        eq(toSQL('cbrt(x)'), 'CBRT(x)');
        eq(toSQL('1/2'), '1.0 / 2');                                  // not integer division
        eq(toSQL('name = "Bob"'), "name = 'Bob'");                    // "Bob" would be a column
        eq(toSQL('tau * x > -∞'), "(2 * PI()) * x > '-Infinity'");
        eq(toSQL(['user', 'current_user', '+']), '"user" + "current_user"');
        eq(toSQL('c = (a < b)'), 'c = (a < b)');
    });
    test('a spreadsheet brackets startswith, so it nests', () => {
        eq(toExcel('2 * startswith(name, "a") + 1'), '=2*(LEFT(LOWER(name), LEN("a"))=LOWER("a"))+1');
    });
    test('the spreadsheet and GLSL check the index too', () => {
        eq(toExcel('root(n, x)'), '=IF(AND(x<0, MOD(n,2)=1), -POWER(-x, 1/n), POWER(x, 1/n))');
        eq(toGLSL('root(n, x)'), 'mz_root(n, x)');
        eq(toGLSL('root(5, x)'), 'mz_root(5.0, x)', 'a constant odd index past 3 too: pow is undefined below 0');
    });
});

suite('code: x ∈ ℕ (whole numbers from 1)', () => {
    test('JavaScript', () => {
        eq(toJavaScript('x ∈ ℕ'), '(Number.isInteger(x) && x > 0)');
        eq(toJavaScript('x ∉ ℕ'), '!(Number.isInteger(x) && x > 0)');
    });
    test('Python, numpy, SymPy', () => {
        eq(toPython('x ∈ ℕ'), '(float(x).is_integer() and x > 0)');
        eq(toPython('x ∈ ℕ', { numpy: true }), 'np.logical_and(np.mod(x, 1) == 0, x > 0)');
        eq(toJavaScript('x ∈ ℕ', 'numpy'), toPython('x ∈ ℕ', { numpy: true }));
        eq(toPython('x ∈ ℕ', { sympy: true }), 'sympy.Contains(x, sympy.S.Naturals)');
        eq(toPython('x ∉ ℕ', { numpy: true }), 'np.logical_not((np.logical_and(np.mod(x, 1) == 0, x > 0)))');
    });
    test('SQL: PostgreSQL and SQLite', () => {
        eq(toSQL('x ∈ ℕ'), '(x = TRUNC(x) AND x > 0)');
        eq(toSQL('x ∈ ℕ', { dialect: 'sqlite' }), "(typeof(x) IN ('integer', 'real') AND x = TRUNC(x) AND x > 0)");
    });
    test('the same meaning as evaluate and calculate: 0 is not in ℕ', () => {
        for (const [x, inN] of [[0, false], [1, true], [2, true], [2.5, false], [-1, false]]) {
            eq(evaluate('x ∈ ℕ', { x }), inN, `evaluate x=${x}`);
            eq(calculate('x ∈ ℕ', { x }).value, inN, `calculate x=${x}`);
            // eslint-disable-next-line no-new-func -- the renderer's own output, on a number
            eq(new Function('x', `return ${toJavaScript('x ∈ ℕ')};`)(x), inN, `JavaScript x=${x}`);
        }
    });
    test('the reader takes each spelling back', () => {
        eq(parse(toJavaScript('x ∈ ℕ')), ['x', 'ℤ', '∈', 'x', '0', '>', '&']);   // the same test, spelled out
        eq(parse(toPython('x ∈ ℕ', { sympy: true })), parse('x ∈ ℕ'));
    });
});

suite('code: \\:std in numpy', () => {
    test('one argument: np.nanstd', () => {
        eq(toPython(['x', '1', '\\:std'], { numpy: true }), 'np.nanstd(x)');
        eq(toPython(['x', '1', '\\:stdev'], { numpy: true }), 'np.nanstd(x)');
    });
    test('anything else is the call as written', () => {
        eq(toPython(['x', 'y', '2', '\\:std'], { numpy: true }), 'std(x, y)');
        eq(toPython(['x', '1', '\\:std']), 'std(x)');
        eq(toJavaScript(['x', '1', '\\:std']), 'std(x)');
    });
    test('no SQL for a function nobody listed', () => {
        throws(() => toSQL(['x', '1', '\\:std']), /No SQL for the function std/);
    });
    test('np.nanstd reads back as stdev', () => eq(parse('np.nanstd(x)'), ['x', '1', '\\:stdev']));
});

suite('code: the SymPy flavor', () => {
    const sympy = (s) => toPython(s, { sympy: true });
    test('not, and, or', () => {
        eq(sympy('not x'), 'sympy.Not(x)');
        eq(sympy('!x'), 'sympy.Not(x)');
        eq(sympy('x and y'), 'sympy.And(x, y)');
        eq(sympy('x && y'), 'sympy.And(x, y)');
        eq(sympy('x or y'), 'sympy.Or(x, y)');
        eq(sympy('x || y'), 'sympy.Or(x, y)');
        eq(sympy('x ∈ ℕ & y'), 'sympy.And(sympy.Contains(x, sympy.S.Naturals), y)');
    });
    test('factorial, perm, comb: SymPy functions, exact', () => {
        eq(sympy('5!'), 'sympy.factorial(5)');
        eq(sympy('n!'), 'sympy.factorial(n)');
        eq(sympy('n!/(k!)'), 'sympy.factorial(n) / sympy.factorial(k)');
        eq(sympy('perm(5,2)'), 'sympy.ff(5, 2)');
        eq(sympy('perm(n,k)'), 'sympy.ff(n, k)');
        eq(sympy('comb(5,2)'), 'sympy.binomial(5, 2)');
        eq(sympy('comb(n,k)'), 'sympy.binomial(n, k)');
    });
    test('beside plain Python', () => {
        eq(toPython('not x'), 'not x');
        eq(toPython('x and y'), '(x and y)');
        eq(toPython('n!'), 'math.factorial(n)');
        eq(toPython('perm(n,k)'), 'math.perm(n, k)');
        eq(toPython('comb(n,k)'), 'math.comb(n, k)');
        eq(toPython('5!'), '5 * 4 * 3 * 2 * 1');
    });
    test('toJavaScript(…, "sympy") is the same flavor', () => {
        eq(toJavaScript('comb(n,k)', 'sympy'), sympy('comb(n,k)'));
        eq(toJavaScript('x ∈ ℕ', 'sympy'), sympy('x ∈ ℕ'));
    });
    test('each reads back', () => {
        for (const s of ['not x', 'x and y', 'x or y', 'n!', 'perm(n,k)', 'comb(n,k)']) eq(parse(sympy(s)), parse(s), s);
    });
});

const lite = (s, options = {}) => toSQL(s, { dialect: 'sqlite', ...options });

suite('SQL: the SQLite dialect', () => {
    const cases = [
        ['(a+b)/(c+d)', 'CAST(a + b AS REAL) / (c + d)'],
        ['a/b/c', 'CAST(a AS REAL) / b / c'],
        ['1/x', '1.0 / x'],
        ['-a/b', 'CAST(-a AS REAL) / b'],
        ['a/(b/c)', 'CAST(a AS REAL) / (CAST(b AS REAL) / c)'],
        ['2.5/x', '2.5 / x'],
        ['x^2/2', 'POWER(x, 2) / 2'],
        ['mean(a,b,c)', '((a + b + c) / 3.0)'],
        ['max(a,b,c)', 'MAX(a, b, c)'],
        ['min(a,b)', 'MIN(a, b)'],
        ['csc(x) + sec(x) * cot(x)', '(1.0 / SIN(x)) + (1.0 / COS(x)) * (1.0 / TAN(x))'],
        ['expm1(x)', '(EXP(x) - 1)'],
        ['x < ∞', 'x < 9e999'],
        ['-∞', '-9e999'],
        ['e^x', 'POWER(EXP(1), x)'],
        ['pi r^2', 'PI() * POWER(r, 2)'],
        ['x ∈ [1, 5)', '(x >= 1 AND x < 5)'],
        ['x ∉ {1, 2, 3}', '(x IN (1, 2, 3)) IS NOT TRUE'],
        ['x ∈ ℤ', "(typeof(x) IN ('integer', 'real') AND x = TRUNC(x))"],
        ['a mod 3', 'MOD(MOD(a, 3) + 3, 3)'],   // mod takes the divisor's sign; SQL's MOD takes a's
        ['log_2(x)', 'LOG(2, x)'],
        ['x ≈ 1', 'ABS((x) - (1)) < 1e-9'],
        ['"O\'Neil" = name', "'O''Neil' = name"],
        ['if x > 1 then 2 else 3', 'CASE WHEN x > 1 THEN 2 ELSE 3 END'],
    ];
    for (const [input, expected] of cases) test(input, () => eq(lite(input), expected));

    test('quoted identifiers', () => eq(lite('a/b', { quoteIdentifiers: true }), 'CAST("a" AS REAL) / "b"'));
    test('postgres stays the default', () => {
        eq(toSQL('(a+b)/(c+d)'), '(a + b) / (c + d)');
        eq(toSQL('max(a,b)'), 'GREATEST(a, b)');
        eq(toSQL('x < ∞'), "x < 'Infinity'");
        eq(toSQL('a/b', { dialect: 'postgres' }), 'a / b');
    });
    test('unknown dialects throw', () => throws(() => toSQL('a', { dialect: 'mysql' }), /Unknown SQL dialect/));

    // what SQLite has no function for is refused by name: operators.test.js checks every operator ("renders with toSQL sqlite")
    test('gcd message', () => throws(() => lite('gcd(a, b)'), /^No SQLite SQL for gcd$/));
});

suite('SQL: options', () => {
    test('toSQL: string quotes and quoted identifiers', () => {
        eq(toSQL('cost + tax', { quoteIdentifiers: true }), '"cost" + "tax"');
        eq(toSQL('name = "Bob"', { stringQuote: "'" }), "name = 'Bob'");
    });
});

suite('spreadsheets: toExcel', () => {
    test("a spreadsheet's own rules: minus before ^, ^ left to right, ATAN2(x, y), LOG(number, base)", () => {
        eq(toExcel('-x^2'), '=-(x^2)');
        eq(toExcel('2^3^2'), '=2^(3^2)');
        eq(toExcel('(-2)^x + x^{-1}'), '=(-2)^x+x^(-1)');
        eq(toExcel('atan2(y, x)'), '=ATAN2(x, y)');
        eq(toExcel('log_2(x) + \\ln y'), '=LOG(x, 2)+LN(y)');
    });
    test('logic is functions, choices are IF, sets are spelled out', () => {
        eq(toExcel('a and not b or c'), '=OR(AND(a, NOT(b)), c)');
        eq(toExcel('x > 0 ? sqrt(x) : 0'), '=IF(x>0, SQRT(x), 0)');
        eq(toExcel('x ∈ {1, 2, 3}'), '=OR(x=1, x=2, x=3)');
        eq(toExcel('x ∉ [0, 1)'), '=NOT(AND(x>=0, x<1))');
        eq(toExcel('n ∈ ℕ'), '=AND(n=INT(n), n>0)');
    });
    test('functions by their spreadsheet names; strings with doubled quotes', () => {
        eq(toExcel('n! / (k! (n-k)!) + \\binom{n}{k} + (x mod 7)'), '=FACT(n)/(FACT(k)*FACT(n-k))+COMBIN(n, k)+MOD(x, 7)');
        eq(toExcel('floor(x) + ceil(y) + e^x + \\sqrt[3]{x}'), '=INT(x)+-INT(-y)+EXP(x)+IF(x<0, -POWER(-x, 1/3), POWER(x, 1/3))');
        eq(toExcel('sec(x) + (a xor b)'), '=1/COS(x)+(NOT(a)<>NOT(b))');   // functions every spreadsheet has (not SEC, XOR)
        eq(toExcel('ceil(x / 2) * 3'), '=-INT(-(x/2))*3');
        eq(toExcel('name = "Ann \\"Jr\\""'), '=name="Ann ""Jr"""');
        eq(toExcel(parse('=name="Ann ""Jr"""')), '=name="Ann ""Jr"""');   // read back and written again: the same
    });
    test('cells and ranges', () => {
        eq(toExcel('Revenue - Cost', { cells: { Revenue: 'B2', Cost: 'C2' } }), '=B2-C2');
        eq(toExcel('Profit / sum(Profit)', { cells: (n) => ({ Profit: 'D7' }[n]), ranges: { Profit: 'D2:D101' } }), '=D7/SUM(D2:D101)');
        eq(toExcel('x + 1', { equals: false }), 'x+1');
    });
    test('what a spreadsheet has no formula for', () => {
        throws(() => toExcel('1/∞'), /No spreadsheet formula for ∞/);
        throws(() => toExcel('\\frac{d}{dx} x^2'), /No spreadsheet formula for a derivative/);
    });
    test('newer functions get _xlfn. in an .xlsx file, not in strings', () => {
        eq(forXlsxFile('=CEILING.MATH(x)+SEC(y)+LEN("CSC(")+XOR(a, b)'), '_xlfn.CEILING.MATH(x)+_xlfn.SEC(y)+LEN("CSC(")+_xlfn.XOR(a, b)');
    });
});
