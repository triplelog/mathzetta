/**
 * Every operator in the table, in every format: written, or refused by name where the language has no such
 * function and none can be written inline — and what is written calls only names the language has (SQLite runs
 * it). Then what every format does with brackets, fixed, ∉ and empty input.
 */
import { suite, test, skip, eq, throws } from '../harness.js';
import {
    GLSL_HELPERS, VARIADIC, calculate, checkGeneratedJs, evaluate, num, op, operator, operatorNames, parse, sym,
    toAudioSpeech, toExcel, toGLSL, toJavaScript, toLaTeX, toMathML, toPython, toPythonFunction, toSQL, toSpeech,
    toText, toUnified,
} from '../../src/all.js';
import { DatabaseSync } from '../helpers.js';

suite('operator table', () => {
    // A node for every operator, with as many arguments as it takes.
    const sample = (name) => {
        // a matrix's arguments are its rows: [[a, b], [c, d]]
        if (['pmatrix', 'bmatrix', 'vmatrix'].includes(name)) return op(name, [op('[]', [sym('a'), sym('b')]), op('[]', [sym('c'), sym('d')])]);
        const { arity } = operator(name);
        const count = arity === VARIADIC ? 3 : arity;
        return op(name, ['a', 'b', 'c', 'd'].slice(0, count).map(sym));
    };
    // …and one each output can work with: the calculus ones with a variable and bounds, a sum with its index,
    // matrices of numbers. What it writes must call only names its language has.
    const working = (name) => {
        if (['pmatrix', 'bmatrix', 'vmatrix'].includes(name)) return op(name, [op('[]', [num('1'), num('2')]), op('[]', [num('3'), num('4')])]);
        if (name === 'det') return op(name, [op('[]', [op('[]', [num('1'), num('2')]), op('[]', [num('3'), num('4')])])]);
        if (name === 'der') return op(name, [op('^', [sym('a'), num('2')]), sym('a')]);
        if (name === 'int' || name === 'evaluated') return op(name, [op('^', [sym('a'), num('2')]), sym('a'), num('0'), num('1')]);
        if (name === 'lim') return op(name, [op('^', [sym('a'), num('2')]), sym('a'), num('1')]);
        if (name === '\\sumidx' || name === '\\prodidx') return op(name, [op('^', [sym('i'), num('2')]), op('=', [sym('i'), num('1')]), sym('n')]);
        const { arity } = operator(name);
        const args = ['a', 'b', 'c'].slice(0, arity === VARIADIC ? 3 : arity);
        if (args.length !== (arity === VARIADIC ? 3 : arity)) throw new Error(`no sample for ${name} with ${arity} operands`);
        return op(name, args.map(sym));
    };

    const formats = { toLaTeX, toMathML, toJavaScript, toPython, toSQL, toText, toSpeech, toGLSL };
    // What a language has no function for, and can't be written inline: refused with an error naming it,
    // never written as a call to a function that doesn't exist (gcd, det, union are written inline in JavaScript).
    const REFUSED = {
        toJavaScript: { der: 'a derivative', int: 'an integral', lim: 'a limit', setbuilder: 'a set described by a condition' },
        toPython: { der: 'a derivative', lim: 'a limit', setbuilder: 'a set described by a condition' },
        toSQL: { der: 'a derivative', int: 'an integral', lim: 'a limit', '\\sumidx': 'a sum to n', '\\prodidx': 'a product to n',
            '∪': 'a union of sets', '∩': 'an intersection of sets', vmatrix: 'a determinant', det: 'a determinant', setbuilder: 'a set described by a condition' },
        toGLSL: { der: 'a derivative', int: 'an integral', lim: 'a limit', '\\sumidx': 'a sum to n', '\\prodidx': 'a product to n',
            '∪': 'a union of sets', '∩': 'an intersection of sets', '∈': '∈ b', '∉': '∈ b', setbuilder: 'a set described by a condition' },
    };

    // ---- the names the code calls: no output calls a function its language doesn't have
    const db = DatabaseSync ? new DatabaseSync(':memory:') : null;
    if (!db) skip('the SQLite checks', 'node:sqlite is missing (Node before 22.5)');
    const REFUSAL = /^No (JavaScript|Python|numpy|SymPy|SQL|SQLite SQL|GLSL|spreadsheet formula) for /;
    /** The output, or null when it refuses by name; anything else thrown is a failure. */
    const written = (write) => {
        try { return write(); } catch (e) {
            if (REFUSAL.test(e.message.replace(/^f(\(.*?\))?: /, ''))) return null;
            throw e;
        }
    };
    const PG = new Set(['POWER', 'SQRT', 'CBRT', 'ABS', 'FLOOR', 'CEIL', 'LN', 'LOG', 'EXP', 'SIN', 'COS', 'TAN', 'COT', 'ASIN', 'ACOS',
        'ATAN', 'ATAN2', 'SINH', 'COSH', 'TANH', 'ASINH', 'ACOSH', 'ATANH', 'ROUND', 'TRUNC', 'MOD', 'GREATEST', 'LEAST', 'GCD', 'FACTORIAL',
        'RANDOM', 'PI', 'CAST', 'ARRAY', 'NOT', 'IN', 'OR', 'AND']);
    const GLSL = new Set(['radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
        'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt', 'abs', 'sign', 'floor', 'ceil', 'trunc', 'round', 'fract', 'mod', 'min', 'max',
        'clamp', 'mix', 'step', 'smoothstep', 'length', 'distance', 'dot', 'cross', 'normalize', 'determinant', 'inverse', 'transpose',
        'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', ...[...GLSL_HELPERS.matchAll(/\b(mz_\w+)\s*\(/g)].map((m) => m[1])]);
    // SQLite's core and math functions (3.35+), and the words that take a bracket
    const SQLITE = new Set(['ABS', 'ACOS', 'ACOSH', 'ASIN', 'ASINH', 'ATAN', 'ATAN2', 'ATANH', 'CEIL', 'CEILING', 'COS', 'COSH', 'DEGREES', 'EXP',
        'FLOOR', 'LN', 'LOG', 'LOG10', 'LOG2', 'MOD', 'PI', 'POW', 'POWER', 'RADIANS', 'SIN', 'SINH', 'SQRT', 'TAN', 'TANH', 'TRUNC', 'MAX', 'MIN',
        'ROUND', 'RANDOM', 'PRINTF', 'FORMAT', 'INSTR', 'LOWER', 'UPPER', 'LENGTH', 'SUBSTR', 'COALESCE', 'IFNULL', 'IIF', 'NULLIF', 'SIGN',
        'CAST', 'NOT', 'IN', 'OR', 'AND']);
    // the spreadsheet functions every spreadsheet has (Excel, Numbers, Sheets, LibreOffice)
    const EXCEL = new Set(['ABS', 'ACOS', 'ACOSH', 'AND', 'ASIN', 'ASINH', 'ATAN', 'ATAN2', 'ATANH', 'AVERAGE', 'CEILING', 'COMBIN', 'COS', 'COSH',
        'EXP', 'FACT', 'FIXED', 'FLOOR', 'GCD', 'IF', 'INT', 'ISNUMBER', 'FIND', 'LEFT', 'LEN', 'LOWER', 'LN', 'LOG', 'LOG10', 'MAX', 'MDETERM', 'MIN',
        'MOD', 'NOT', 'OR', 'PERMUT', 'PI', 'POWER', 'PRODUCT', 'RAND', 'ROUND', 'ROUNDDOWN', 'SIGN', 'SIN', 'SINH', 'SQRT', 'SUM', 'TAN', 'TANH',
        'TRUNC', 'XOR']);
    /** Every name called in the code (outside quoted text and quoted names), as written. */
    const called = (code) => [...code.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "''").matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]);
    /** SQL names are not case-sensitive: lowercase printf( is checked as PRINTF. */
    const unknownSql = (code, known) => called(code).filter((n) => !known.has(n.toUpperCase()));
    const CALLS = {
        toJavaScript: (name, t) => {
            const js = written(() => toJavaScript(t));
            // a sum's loop: checkGeneratedJs refuses loops by design, so it is run instead (∑ i² to 3 is 14, ∏ is 36)
            if (js !== null && /^\\(sum|prod)idx$/.test(name)) eq(new Function('n', `return ${js};`)(3), name === '\\sumidx' ? 14 : 36);
            // a name JavaScript lacks is refused here (x_1 is a variable)
            else if (js !== null) checkGeneratedJs(js, { variables: /^(?:[a-z](?:_\w+)?|sum|prod|loopCount)$/ });
        },
        toPython: (name, t) => {
            for (const flavour of [{}, { numpy: true }, { sympy: true }]) {
                if (written(() => toPython(t, flavour)) !== null) written(() => toPythonFunction(t, flavour));   // its whitelist: every name exists
            }
        },
        toSQL: (name, t) => {
            const sql = written(() => toSQL(t));
            if (sql !== null) eq(unknownSql(sql, PG), [], sql);
        },
        sqlite: (name, t) => {
            const sqlite = written(() => toSQL(t, { dialect: 'sqlite' }));
            if (sqlite === null) return;
            eq(unknownSql(sqlite, SQLITE), [], sqlite);
            // and SQLite itself runs it (a missing function or a syntax error throws here)
            if (db) {
                const statement = db.prepare(`SELECT ${sqlite} AS v FROM (SELECT 1 AS a, 2 AS b, 3 AS c, 1 AS i, 3 AS n)`);
                statement.setReadBigInts(true);   // RANDOM() is a 64-bit integer
                statement.get();
            }
        },
        toExcel: (name, t) => {
            const excel = written(() => toExcel(t));
            if (excel !== null) eq(called(excel).filter((n) => !EXCEL.has(n)), [], excel);
        },
        toGLSL: (name, t) => {
            const glsl = written(() => toGLSL(t));
            if (glsl !== null) eq(called(glsl).filter((n) => !GLSL.has(n)), [], glsl);
        },
    };

    for (const name of operatorNames()) {
        for (const [format, render] of Object.entries(formats)) {
            test(`${name} renders with ${format}`, () => {
                const refused = REFUSED[format]?.[name];
                if (refused) {
                    throws(() => render(sample(name)), new RegExp(`^No [\\w ]+ for ${refused.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
                } else {
                    const out = render(sample(name));
                    if (typeof out !== 'string' || !out.length) throw new Error('empty output');
                }
                CALLS[format]?.(name, working(name));
            });
        }
    }

    // SQLite has no function for these; the sqlite dialect throws rather than
    // writing SQL that fails later. Everything else must render.
    const SQLITE_UNSUPPORTED = new Set(['!', 'gcd', 'perm', 'comb', 'der', 'int', 'lim',
        '\\sumidx', '\\prodidx', '±', 'pm', '∪', '∩', '_', '→', 'pmatrix', 'bmatrix', 'vmatrix', 'det', 'setbuilder']);
    const sqliteWrites = (name) => {
        const node = sample(name);
        const sqlite = () => toSQL(node, { dialect: 'sqlite' });
        if (SQLITE_UNSUPPORTED.has(name)) return throws(sqlite, /^No SQLite SQL for /);
        // A group of several items only means something on the right of ∈.
        if (operator(name).group) {
            throws(sqlite, /^No SQLite SQL for .* outside ∈/);
            eq(toSQL(op(name, [sym('a')]), { dialect: 'sqlite' }), '(a)');
            return;
        }
        const out = sqlite();
        if (typeof out !== 'string' || !out.length) throw new Error('empty output');
    };
    for (const name of operatorNames()) {
        test(`${name} renders with toSQL sqlite`, () => {
            sqliteWrites(name);
            CALLS.sqlite(name, working(name));
        });
    }

    // Spreadsheets have no symbolic math, ±, sets to combine, or an index into a list: toExcel says so.
    const EXCEL_UNSUPPORTED = new Set(['der', 'int', 'lim', '\\sumidx', '\\prodidx', '±', 'pm', '∪', '∩', '→', 'setbuilder',
        'pmatrix', 'bmatrix', 'vmatrix']);   // matrices: of numbers only (the sample's entries are letters)
    const excelWrites = (name) => {
        const node = sample(name);
        if (EXCEL_UNSUPPORTED.has(name)) return throws(() => toExcel(node), /^No spreadsheet formula for /);
        if (operator(name).group) {   // a list means something only after ∈
            throws(() => toExcel(node), /^No spreadsheet formula for a list/);
            return eq(toExcel(op(name, [sym('a')])), '=(a)');
        }
        if (name === '∈' || name === '∉') return throws(() => toExcel(node), /^No spreadsheet formula for ∈ b/);   // a set known only by name
        const out = toExcel(node);
        if (typeof out !== 'string' || !out.startsWith('=')) throw new Error(`not a formula: ${out}`);
    };
    for (const name of operatorNames()) {
        test(`${name} renders with toExcel`, () => {
            excelWrites(name);
            CALLS.toExcel(name, working(name));
        });
    }
});

suite('every format: brackets', () => {
    test('-1·(a + b) is -(a + b) everywhere', () => {
        const pf = ['-1', 'a', 'b', '+', '*'];
        eq(toLaTeX(pf), '-\\left(a + b\\right)');
        eq(toText(pf), '-(a + b)');
        eq(toJavaScript(pf), '-(a + b)');
        eq(toPython(pf), '-(a + b)');
        eq(toSQL(pf), '-(a + b)');
        eq(toExcel(pf), '=-(a+b)');
        eq(toGLSL(pf), '-(a + b)');
        eq(toMathML(pf).includes('<mo>(</mo>'), true);
        eq(toLaTeX(['c', '-1', 'a', 'b', '+', '*', '+']), 'c - \\left(a + b\\right)');
        eq(toLaTeX(['-1', 'x', '*', '!']), '\\left(-x\\right)!');
    });
});

suite('every format: fixed, round then exactly that many decimals', () => {
    test('every format', () => {
        eq(toLaTeX('fixed(x, 2)'), '\\text{fixed}\\left(x, 2\\right)');
        eq(toText('fixed(x, 2)'), 'fixed(x, 2)');
        eq(toSpeech('fixed(x, 2)'), 'x, written to 2 decimal places');
        eq(toSpeech('fixed(x, 0)'), 'x, written as a whole number');
        eq(toJavaScript('fixed(x, 2)'), 'Number(x).toFixed(2)');
        eq(toJavaScript('fixed(x + 1, n)'), 'Number(x + 1).toFixed(n)');
        // rounded first, halves away from zero: format(2.5, '.0f') alone is '2', format(0.125, '.2f') '0.12'
        eq(toPython('fixed(x, 2)'), 'format(((math.floor(x * 10 ** 2 + 0.5) if x >= 0 else -math.floor(-x * 10 ** 2 + 0.5)) / 10 ** 2 if abs(x) < math.inf else x), ".2f")');   // NaN and ±∞ pass through: math.floor raises on them
        eq(toPython('fixed(x, n)'), 'format(((math.floor(x * 10 ** n + 0.5) if x >= 0 else -math.floor(-x * 10 ** n + 0.5)) / 10 ** n if abs(x) < math.inf else x), "." + str(n) + "f")');
        eq(toPython('fixed(x, 2)', { numpy: true }), 'np.char.mod("%.2f", np.where(x >= 0, np.floor(x * 10.0 ** 2 + 0.5), -np.floor(-x * 10.0 ** 2 + 0.5)) / 10.0 ** 2)');
        eq(toSQL('fixed(x, 2)'), 'ROUND(CAST(x AS NUMERIC), 2)');
        eq(toSQL('fixed(x, 2)', { dialect: 'sqlite' }), "printf('%.2f', x)");
        eq(toExcel('fixed(x, 2)'), '=FIXED(x, 2)');
        eq(toGLSL('fixed(x, 2)'), toGLSL('round(x, 2)'));
        eq(toMathML('fixed(x, 2)').replace(/ id="mz-\d+"/g, ''), '<math><mrow><mi>fixed</mi><mo>(</mo><mi>x</mi><mo>,</mo><mn>2</mn><mo>)</mo></mrow></math>');
    });
    test('the JavaScript and Excel spellings read back', () => {
        eq(parse(toJavaScript('fixed(x + 1, 2)')), ['x', '1', '+', '2', 'fixed']);
        eq(parse('=FIXED(A1, 3)'), ['A1', '3', 'fixed']);
        eq(parse('=FIXED(A1)'), ['A1', '2', 'fixed']);
    });
});

suite('every format: ∉, in every spelling', () => {
    test('every spelling means ∉', () => {
        for (const s of ['x ∉ S', 'x \\notin S', 'x \\not\\in S', 'x not in S', 'x Not In S']) eq(parse(s), ['x', 'S', '∉'], s);
    });
    test('in each format', () => {
        eq(toPython('x not in {1, 2}'), 'x not in {1, 2}');
        eq(toPython('x \\notin [0, 1)'), 'not (x >= 0 and x < 1)');
        eq(toText('x \\notin \\mathbb{R}'), 'x ∉ ℝ');
        eq(toMathML('x ∉ S').includes('<mo>∉</mo>'), true);
    });
});

suite('every format: empty input', () => {
    // The empty postfix array is an empty expression each format writes its own way; empty text is a parse error.
    test('[]: each format has a value for nothing', () => {
        eq(toLaTeX([]), '');
        eq(toMathML([]), '<math><mi>empty</mi></math>');
        eq(toText([]), '');
        eq(toSpeech([]), '');
        eq(toAudioSpeech([]), '');
        eq(toJavaScript([]), '0');
        eq(toPython([]), '0');
        eq(toSQL([]), '0');
        eq(toExcel([]), '=0');
        eq(toExcel([], { equals: false }), '0');
        eq(toGLSL([]), '0.0');
    });
    test('[]: evaluate and calculate refuse it', () => {
        throws(() => evaluate([]), /^Empty postfix$/);
        throws(() => calculate([]), /^Empty postfix$/);
    });
    test("'' and blanks: every renderer refuses them alike", () => {
        const renderers = { toLaTeX, toMathML, toText, toSpeech, toAudioSpeech, toJavaScript, toPython, toSQL, toExcel, toGLSL, toUnified, evaluate, calculate };
        for (const [name, render] of Object.entries(renderers)) {
            for (const input of ['', '   ']) throws(() => render(input), /Failed to parse expression .*: Empty expression/);
        }
    });
    test('toUnified([]) agrees with every renderer', () => {
        const u = toUnified([]);
        eq([u.latex, u.mathml, u.exp, u.speech, u.javascript, u.python, u.sql, u.glsl],
            [toLaTeX([]), toMathML([]), toText([]), toSpeech([]), toJavaScript([]), toPython([]), toSQL([]), toGLSL([])]);
    });
});
