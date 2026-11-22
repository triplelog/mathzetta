/**
 * Formulas over table columns: strToFunction (JavaScript over a row, createRowEvaluator), strToSQL, strToExcel —
 * columns, unknown names and the choices for them, text search, dialects, ranges, refusals.
 * The security checks of formula code are in security.test.js.
 */
import { suite, test, eq, throws, show } from '../harness.js';
import {
    createRowEvaluator, isSafeGeneratedJs, operator, parse, strToExcel, strToFunction, strToSQL, toExcel, toPython,
} from '../../src/all.js';
import { NP_HELPERS, PY_HELPERS } from '../../src/js-helpers.js';
import { DatabaseSync, sqliteTest } from '../helpers.js';

suite('formulas: columns, strings and unknown words', () => {
    const header = ['Name', 'Value', 'Count'];
    test('columns become row lookups', () => {
        const f = strToFunction(header, 'Value * 2 + count');
        eq(f.jsFunction, 'c1 * 2 + c2');
        eq(createRowEvaluator(f.jsFunction)(['a', 10, 3]), 23);
    });
    test('string comparisons', () => {
        const f = strToFunction(header, 'Name == "Alpha"');
        eq(createRowEvaluator(f.jsFunction)(['Alpha', 1, 1]), true);
    });
    test('a column named like an operator is still a column', () => {
        const header = ['neg', 'max', 'sum'];
        const f = strToFunction(header, 'not (max > 2) and neg < 0');
        eq(f.success, true);
        eq(createRowEvaluator(f.jsFunction)([-1, 1, 0]), true);
        eq(createRowEvaluator(f.jsFunction)([-1, 3, 0]), false);
        eq(strToSQL(header, 'neg + max * sum').sqlExpression, '"neg" + "max" * "sum"');
    });
    test('unknown words are reported', () => {
        const f = strToFunction(header, 'Value + Missing');
        eq(f.unknownStrings, ['Missing']);
    });
    test('SQL quotes columns and strings', () => {
        eq(strToSQL(header, 'Value > 3 & Name == "O\'Neil"').sqlExpression, `("Value" > 3 AND "Name" = 'O''Neil')`);
    });
});

suite('formulas: the row evaluator', () => {
    test('column references inside string literals are left alone', () => {
        const f = strToFunction(['Name', 'Value'], 'Name == "c1"');
        eq(createRowEvaluator(f.jsFunction)(['c1', 2]), true);
        eq(createRowEvaluator(f.jsFunction)(['x', 2]), false);
    });
});

suite('formulas: choices for unknown names', () => {
    test("strToFunction's third argument makes a word a column, a number or a string", () => {
        const choose = (type, value) => new Map([['rate', { type, value }]]);
        const run = (map, row) => createRowEvaluator(strToFunction(['price', 'tax'], 'price * rate', map).jsFunction)(row);
        eq(run(choose('column', 'tax'), [10, 0.5]), 5);
        eq(run(choose('integer', '3'), [10, 0]), 30);
        eq(run(choose('float', '0.25'), [10, 0]), 2.5);
        const named = (row) => createRowEvaluator(strToFunction(['name'], 'name = rate', choose('string', 'abc')).jsFunction)(row);
        eq(strToFunction(['name'], 'name = rate', choose('string', 'abc')).jsFunction, 'c0 == "abc"');
        eq([named(['abc']), named(['abd'])], [true, false]);
        eq(strToFunction(['price'], 'price * rate', choose('column', 'nothing')).types, ['column', 'unknown', 'operator']);
        eq(strToFunction(['price'], 'price * rate').unknownStrings, ['rate']);
    });
});

suite('formulas: LaTeX over columns', () => {
    test("a column's placeholder stays whole in LaTeX, where letters side by side are a product", () => {
        const run = (f) => createRowEvaluator(strToFunction(['x', 'Value', 'Count'], f).jsFunction)([4, 50, 200]);
        eq(strToFunction(['x'], '\\sqrt{x}+x').jsFunction, 'Math.sqrt(c0) + c0');
        eq(run('\\sqrt{x}+x'), 6);
        eq(run('\\frac{Value}{Count} \\cdot 100'), 25);
    });
});

suite('formulas: percentages, the spreadsheet text search, what JavaScript cannot write', () => {
    test('a percentage is a number in formulas, as toSQL writes it', () => {
        eq(strToSQL(['a'], '50% * a', new Map()).sqlExpression, '0.5 * "a"');
        eq(strToExcel(['a'], '50% * a').unknownStrings, []);
    });
    test('the spreadsheet searches as well', () => {
        eq(strToExcel(['name', 'team'], 'team in name').excelFormula((i) => 'AB'[i] + '2'), '=ISNUMBER(FIND(LOWER(B2), LOWER(A2)))');
    });
    test('strToFunction answers { success: false } for what JavaScript cannot write', () => {
        const out = strToFunction(['Value'], 'lim(Value, Value, 0)');
        eq(out.success, false);
        eq(typeof out.error, 'string');
    });
});

suite('formulas: strToSQL dialects', () => {
    const header = ['H', 'AB', 'HR'];
    test('3-argument form is postgres', () => eq(strToSQL(header, 'max(H, HR)').sqlExpression, 'GREATEST("H", "HR")'));
    test('sqlite option', () => {
        eq(strToSQL(header, 'H / AB', new Map(), { dialect: 'sqlite' }).sqlExpression, 'CAST("H" AS REAL) / "AB"');
        eq(strToSQL(header, 'max(H, HR)', undefined, { dialect: 'sqlite' }).sqlExpression, 'MAX("H", "HR")');
    });
    test('unsupported operators are an error result', () => {
        const r = strToSQL(header, 'HR!', new Map(), { dialect: 'sqlite' });
        eq(r.success, false);
        eq(r.error, 'No SQLite SQL for a factorial');
    });
    test('columns that look like constants stay columns', () => {
        eq(strToSQL(['e', 'pi'], 'e * pi').sqlExpression, '"e" * "pi"');
        eq(strToSQL(['e', 'pi'], 'e * pi', new Map(), { dialect: 'sqlite' }).sqlExpression, '"e" * "pi"');
    });
});

suite('formulas: text search', () => {
    const header = ['team', 'name', 'HR'];
    const rows = [['NYA', 'Aaron Judge', 62], ['bos', 'Ted Williams', 43], ['', "Mc'Gee 50%_x*?", 0], [null, 'ÉMILE émile', 6]];
    const js = (f) => {
        const r = strToFunction(header, f);
        if (!r.success) throw new Error(`${f}: ${r.error}`);
        eq(r.unknownStrings, [], `${f}: no unknown names`);
        const fn = createRowEvaluator(r.jsFunction);
        return rows.map((row) => {
            const v = fn(row);
            if (typeof v !== 'boolean') throw new Error(`${f}: ${show(v)} is not true or false`);
            return Number(v);
        }).join('');
    };
    test('a text in a value, whatever the case of A to Z; contains() is the same test', () => {
        eq(js('"aa" in name'), '1000');
        eq(js('contains(name, "AA")'), '1000');
        eq(js('"ILLIAMS" ∈ name'), '0100');
        eq(js('"aa" ∉ name'), '0111');
        eq(js('not contains(name, "aa")'), '0111');
        eq(parse('contains(name, "aa")'), parse('"aa" in name'));
    });
    test('startswith, in any capitals', () => {
        eq(js('startswith(name, "ted")'), '0100');
        eq(js('StartsWith(name, "Mc\'")'), '0010');
        eq(js('startswith(name, "a") and HR > 50'), '1000');
        eq(js('not startswith(name, "a")'), '0111');
    });
    test('only A to Z fold: É and é are different letters', () => {
        eq(js('"émile" in name'), '0001');
        eq(js('startswith(name, "émile")'), '0000');
        eq(js('startswith(name, "Émile")'), '0001');
    });
    test('nothing in the text is a pattern; a number is read by its digits; a missing value is empty text', () => {
        eq(js('"%_" in name'), '0010');
        eq(js('"*?" in name'), '0010');
        eq(js('"." in name'), '0000');
        eq(js('"6" in HR'), '1001');
        eq(js('startswith(HR, "4")'), '0100');
        eq(js('"" in team'), '1111');
        eq(js('"n" ∉ team'), '0111');
    });
    test('membership in a written set is still membership', () => {
        eq(js('team in {"NYA", "BOS"}'), '1000');
        eq(js('"NYA" in {"NYA", team}'), '1111');
        eq(strToSQL(header, 'team in {"NYA", "BOS"}').sqlExpression, `("team" IN ('NYA', 'BOS')) IS TRUE`);   // a missing team is in no set, as in JavaScript
    });
    test('startswith takes two arguments; other functions are still unknown', () => {
        eq(strToFunction(header, 'startswith(name)').success, false);
        eq(/startswith\(name, "Mc"\)/.test(strToSQL(header, 'startswith(name, "a", 1)').error), true);
        eq(strToFunction(header, 'endswith(name, "x")').unknownStrings, ['endswith']);
        eq(/unknown name endswith/.test(strToSQL(header, 'endswith(name, "x")').error), true);
    });
    test('the generated JavaScript passes the gate, and text in it stays text', () => {
        for (const f of ['"aa" in name', 'startswith(name, "x\\" ); alert(1); (\\"")', '"${HR}" in name', "startswith(name, 'a') or \"`\" in name"]) {
            const r = strToFunction(header, f);
            eq(r.success && isSafeGeneratedJs(r.jsFunction, { variables: /^c\d+$/, keywords: false }), true, f);
            eq(typeof createRowEvaluator(r.jsFunction)(rows[0]), 'boolean', f);
        }
    });
    test('SQL, a spreadsheet and Python', () => {
        eq(strToSQL(header, '"aa" in name', new Map(), { dialect: 'sqlite' }).sqlExpression, `(INSTR(LOWER(COALESCE("name", '')), LOWER(COALESCE('aa', ''))) > 0)`);
        eq(strToSQL(header, '"aa" ∉ name', new Map(), { dialect: 'sqlite' }).sqlExpression, `(INSTR(LOWER(COALESCE("name", '')), LOWER(COALESCE('aa', ''))) = 0)`);
        eq(strToSQL(header, "startswith(name, \"O'N\")", new Map(), { dialect: 'sqlite' }).sqlExpression, `(INSTR(LOWER(COALESCE("name", '')), LOWER(COALESCE('O''N', ''))) = 1)`);
        eq(strToSQL(header, '"aa" in name').sqlExpression, `(STRPOS(LOWER(COALESCE(CAST("name" AS TEXT), '')), LOWER(COALESCE(CAST('aa' AS TEXT), ''))) > 0)`);
        eq(toExcel('"aa" in name'), '=ISNUMBER(FIND(LOWER("aa"), LOWER(name)))');
        eq(toExcel('"aa" ∉ name'), '=NOT(ISNUMBER(FIND(LOWER("aa"), LOWER(name))))');
        eq(toExcel('startswith(name, "Mc")'), '=(LEFT(LOWER(name), LEN("Mc"))=LOWER("Mc"))');
        eq(toPython('"aa" in name'), `${PY_HELPERS.contains}(name, "aa")`);
        eq(toPython('"aa" ∉ name'), `(not ${PY_HELPERS.contains}(name, "aa"))`);
        eq(toPython('startswith(name, "Mc")'), `${PY_HELPERS.startswith}(name, "Mc")`);
        eq(toPython('"aa" in name', { numpy: true }), `${NP_HELPERS.contains}(name, "aa")`);
        eq(toPython('"aa" ∉ name', { numpy: true }), `np.logical_not(${NP_HELPERS.contains}(name, "aa"))`);
    });
    sqliteTest('SQLite gives the JavaScript answers', () => {
        const db = new DatabaseSync(':memory:');
        db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, team TEXT, name TEXT, HR INTEGER)');
        const add = db.prepare('INSERT INTO t (team, name, HR) VALUES (?, ?, ?)');
        for (const r of rows) add.run(...r);
        for (const f of ['"aa" in name', 'contains(name, "AA")', '"aa" ∉ name', 'not contains(name, "aa")', 'startswith(name, "ted")', 'StartsWith(name, "Mc\'")',
            '"émile" in name', '"É" in name', 'startswith(name, "Émile")', '"%_" in name', '"*?" in name', '"6" in HR', 'startswith(HR, "4")', '"" in team', '"n" ∉ team',
            'not startswith(team, "n")', 'startswith(name, "a") and HR > 50', '"x" in team or "e w" in name', 'team in {"NYA", "BOS"}', 'team ∉ {"NYA", "BOS"}']) {
            const sql = strToSQL(header, f, new Map(), { dialect: 'sqlite' });
            if (!sql.success) throw new Error(`${f}: ${sql.error}`);
            // 1 or 0; a NULL shows as N, so it can't pass for false
            const got = db.prepare(`SELECT ${sql.sqlExpression} AS v FROM t ORDER BY id`).all().map((r) => (r.v === null ? 'N' : String(r.v))).join('');
            eq(got, js(f), `${f} (${sql.sqlExpression})`);
        }
    });
    sqliteTest('a missing text is empty text in SQLite too: the answer is never NULL', () => {
        const db = new DatabaseSync(':memory:');
        db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, prefix TEXT)');
        db.prepare('INSERT INTO t (name, prefix) VALUES (?, ?), (?, ?), (?, ?)').run('Ted', null, null, null, 'Ted', 'x');
        const h = ['name', 'prefix'];
        for (const f of ['startswith(name, prefix)', 'not startswith(name, prefix)', 'startswith(prefix, name)']) {
            const sql = strToSQL(h, f, new Map(), { dialect: 'sqlite' });
            const got = db.prepare(`SELECT ${sql.sqlExpression} AS v FROM t ORDER BY id`).all().map((r) => String(r.v)).join(' ');
            const fn = createRowEvaluator(strToFunction(h, f).jsFunction);
            eq(got, [['Ted', null], [null, null], ['Ted', 'x']].map((row) => String(Number(fn(row)))).join(' '), `${f} (${sql.sqlExpression})`);
        }
    });
});

const H = ['Value', 'Count', 'Name'];

const cell = (i) => `${'ABC'[i]}2`;

const range = (i) => `${'ABC'[i]}2:${'ABC'[i]}101`;

suite('formulas: strToExcel ranges', () => {
    test('options.ranges: a one-argument sum or mean of a column is over its range', () => {
        const r = strToExcel(H, 'sum(Value) + Count', new Map(), { ranges: range });
        eq(r.success, true);
        eq(r.excelFormula(cell), '=SUM(A2:A101)+B2');
        eq(strToExcel(H, 'mean(Value)', new Map(), { ranges: range }).excelFormula(cell), '=AVERAGE(A2:A101)');
    });
    test('rangeOf given to excelFormula does the same', () => {
        const r = strToExcel(H, 'sum(Value) + Count');
        eq(r.excelFormula(cell, range), '=SUM(A2:A101)+B2');
    });
    test('without ranges, a sum of one cell is the cell', () => eq(strToExcel(H, 'sum(Value) + Count').excelFormula(cell), '=A2+B2'));
    test('the parts of a success', () => {
        const r = strToExcel(H, 'sum(Value) + Count');
        eq(r.postfixArray, ['c0', '1', 'sum', 'c1', '+']);
        eq(r.types, ['column', 'number', 'operator', 'column', 'operator']);
        eq(r.unknownStrings, []);
        eq(r.tree.args[1], { type: 'symbol', value: 'Count', id: 3 });   // columns under their own names
    });
});

suite('formulas: strToExcel refusals', () => {
    test('what a spreadsheet cannot hold', () => {
        const inf = strToExcel(H, 'Value + ∞');
        eq(inf.success, false);
        eq(inf.error, 'No spreadsheet formula for ∞ (spreadsheets have no infinity)');
        eq(strToExcel(H, 'd/dx Value').error, 'No spreadsheet formula for a derivative');
    });
    test('a formula that does not parse', () => {
        const r = strToExcel(H, 'Value +');
        eq(r.success, false);
        eq(/An operator is missing an operand/.test(r.error), true);
        eq(r.unknownStrings, []);
    });
    test('f(…) only for the functions listed', () => {
        const r = strToExcel(H, 'f(Value)');
        eq(r.success, false);
        eq(r.error, 'No spreadsheet formula for the function f(…)');
        eq(r.unknownStrings, ['f']);
        eq(strToExcel(H, 'f(Value)', new Map(), { functions: ['f'] }).excelFormula(cell), '=f(A2)');
    });
});

suite('formulas: strToSQL functions', () => {
    test('an unlisted function is an unknown name', () => {
        eq(strToSQL(H, 'f(Value) + 1'), { success: false, error: 'unknown name f(…)', unknownStrings: ['f'] });
    });
    test('a list', () => {
        const r = strToSQL(H, 'f(Value) + 1', new Map(), { functions: ['f'] });
        eq(r.success, true);
        eq(r.sqlExpression, 'F("Value") + 1');
    });
    test('a predicate', () => {
        eq(strToSQL(H, 'f(Value) + g(Count)', new Map(), { functions: (n) => n === 'f' || n === 'g' }).sqlExpression, 'F("Value") + G("Count")');
        eq(strToSQL(H, 'f(Value) + g(Count)', new Map(), { functions: (n) => n === 'f' }).error, 'unknown name g(…)');
    });
    test('a name that is no column is refused', () => {
        eq(strToSQL(H, 'Value + bogus'), { success: false, error: 'unknown name bogus', unknownStrings: ['bogus'] });
    });
});

suite('formulas: unknownStringSelections', () => {
    const pick = (formula, selection) => strToFunction(H, formula, new Map([[Object.keys(selection)[0], Object.values(selection)[0]]]));
    test("{ type: 'string' }: the word as quoted text", () => {
        const r = pick('Name == bogus', { bogus: { type: 'string', value: 'Gamma' } });
        eq(r.jsFunction, 'c2 == "Gamma"');
        eq(r.types, ['column', 'string', 'operator']);
        eq(r.unknownStrings, ['bogus']);   // still reported
        const sql = strToSQL(H, 'Name == bogus', new Map([['bogus', { type: 'string', value: 'Gamma' }]]));
        eq(sql.sqlExpression, `"Name" = 'Gamma'`);
    });
    test("{ type: 'integer' }, { type: 'float' }, { type: 'column' }", () => {
        eq(pick('Value + k', { k: { type: 'integer', value: '7' } }).jsFunction, 'c0 + 7');
        eq(pick('Value + k', { k: { type: 'float', value: '0.5' } }).jsFunction, 'c0 + 0.5');
        eq(pick('Value + k', { k: { type: 'column', value: 'Count' } }).jsFunction, 'c0 + c1');
    });
    test('a selection that cannot be used leaves the name unknown', () => {
        for (const selection of [{ type: 'integer', value: 'abc' }, { type: 'column', value: 'Nope' }, { type: 'what', value: 1 }, { type: 'string' }]) {
            const r = pick('Value + k', { k: selection });
            eq(r.types, ['column', 'unknown', 'operator'], JSON.stringify(selection));
        }
        eq(strToFunction(H, 'Value + k').types, ['column', 'unknown', 'operator']);
    });
});

suite('formulas: argument checks', () => {
    test('the header must be an array', () => {
        for (const run of [strToFunction, strToSQL, strToExcel]) {
            throws(() => run('Value', 'Value'), /^Header must be an array of column names$/);
            throws(() => run(null, 'Value'), /^Header must be an array of column names$/);
        }
    });
    test('the formula must be a non-empty string', () => {
        for (const run of [strToFunction, strToSQL, strToExcel]) {
            throws(() => run(H, ''), /^Formula must be a non-empty string$/);
            throws(() => run(H, 5), /^Formula must be a non-empty string$/);
            throws(() => run(H, undefined), /^Formula must be a non-empty string$/);
        }
    });
});

suite('formulas: createRowEvaluator on code it will not run', () => {
    const row = [6, 3, 'a'];
    test('no code: a function that says so', () => {
        for (const code of [undefined, '', 42, null]) eq(createRowEvaluator(code)(row), 'Error: Invalid JavaScript code');
    });
    test('code that does not compile', () => eq(createRowEvaluator('c0 +')(row).startsWith('Error creating function:'), true));
    test('code the checker refuses is never compiled', () => {
        eq(createRowEvaluator('alert(1)')(row), 'Error: not allowed in a formula: the name "alert"');
        eq(createRowEvaluator('c0.constructor')(row), 'Error: not allowed in a formula: .constructor');
        eq(createRowEvaluator('(() => { throw new Error("boom") })()')(row), 'Error: not allowed in a formula: the name "throw"');
    });
    test('code that throws as it runs gives the error as text', () => {
        eq(createRowEvaluator('Number(c0).toFixed(200)')(row), 'Error: toFixed() digits argument must be between 0 and 100');
    });
    test('good code: columns by index, "c1" inside a string left alone', () => {
        eq(createRowEvaluator('c0 / c1')(row), 2);
        eq(createRowEvaluator('"c1" + c0')(row), 'c16');
    });
});

suite('formulas: strToFunction MathML', () => {
    test('mathMLOriginal shows the columns by name; mathMLSubbed is the same', () => {
        const r = strToFunction(H, 'Value^2 / Count');
        eq(r.mathMLOriginal, '<math><mfrac id="mz-4"><msup id="mz-2"><mi id="mz-0">Value</mi><mn id="mz-1">2</mn></msup><mi id="mz-3">Count</mi></mfrac></math>');
        eq(r.mathMLSubbed, r.mathMLOriginal);
        eq(r.jsFunction, 'Math.pow(c0, 2) / c1');
    });
    test('a chosen string is shown as text', () => {
        const r = strToFunction(H, 'Name == bogus', new Map([['bogus', { type: 'string', value: 'Gamma' }]]));
        eq(r.mathMLOriginal, '<math><mrow id="mz-2"><mi id="mz-0">Name</mi><mo>=</mo><mtext id="mz-1">"Gamma"</mtext></mrow></math>');
    });
});
