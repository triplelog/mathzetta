/**
 * What ships: the package's exports, files and bundles (the CDN flavors, the split ES modules, the CommonJS builds, the plain builds, sizes.json).
 */
import { createRequire } from 'node:module';
import { suite, test, eq } from '../harness.js';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parse } from '../../src/index.js';
import { FLAVOURS, PLAIN_FLAVOURS, flavourFile } from '../../tools/flavours.js';

const loadUmd = (file) => { const module = { exports: {} }; new Function('module', 'exports', readFileSync(new URL(file, root), 'utf8'))(module, module.exports); return module.exports; };

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const head = (file) => readFileSync(new URL(file, root), 'utf8').slice(0, 120);

/** The names a .d.ts file exports: `export { … }` lists (re-exports too), `export declare …`, and `export *` followed. */
const declared = (file) => {
    const text = readFileSync(new URL(file, root), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const names = new Set();
    for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
        for (const part of m[1].split(',')) { const name = part.trim().split(/\s+as\s+/).pop().trim(); if (name) names.add(name); }
    }
    for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:const|let|var|function|class|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    if (/export\s+default\b/.test(text)) names.add('default');
    for (const m of text.matchAll(/export\s+\*\s+from\s+'([^']+)'/g)) {
        for (const name of declared(new URL(m[1].replace(/\.js$/, '.d.ts'), new URL(file, root)).pathname.slice(root.pathname.length))) names.add(name);
    }
    return names;
};
/** Every file under build/, as 'build/…'. */
const buildFiles = (dir = 'build/') => readdirSync(new URL(dir, root), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? buildFiles(`${dir}${e.name}/`) : [`${dir}${e.name}`]));

suite('package', () => {
    test('every export points at a file that exists', () => {
        for (const [key, target] of Object.entries(pkg.exports)) {
            if (key.includes('*')) continue;
            const paths = typeof target === 'string' ? [target] : Object.values(target);
            for (const p of paths) eq(existsSync(new URL(p, root)), true, `${key} → ${p}`);
        }
    });
    test('the files list ships src, build, the types, the license and the readme', () => {
        for (const f of ['src/', 'build/', 'README.md', 'LICENSE']) eq(pkg.files.includes(f), true, f);
        // the types: package.json's types and every export's types are files under src/ (shipped), one per entry
        eq(existsSync(new URL(pkg.types, root)) && pkg.types.startsWith('src/'), true, `types: ${pkg.types}`);
        for (const [key, target] of Object.entries(pkg.exports)) {
            if (typeof target !== 'object') continue;
            eq(typeof target.types === 'string' && target.types.startsWith('./src/') && target.types.endsWith('.d.ts'), true, `${key} has types`);
            eq(existsSync(new URL(target.types, root)), true, `${key} → ${target.types}`);
        }
        for (const f of readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.js'))) {
            const types = f.replace(/\.js$/, '.d.ts');
            const entry = Object.values(pkg.exports).some((t) => typeof t === 'object' && t.import === `./src/${f}`);
            if (entry) eq(existsSync(new URL(`src/${types}`, root)), true, `src/${f} is an entry: src/${types}`);
        }
        eq(existsSync(new URL('LICENSE', root)), true);
        eq(pkg.publishConfig?.access, 'public');
        eq(pkg.jsdelivr, 'build/mathzetta.min.js');
    });
    test('the bundles are built from this version', () => {
        for (const f of ['build/mathzetta.js', 'build/mathzetta.min.js', 'build/mathzetta.esm.js', 'build/mathzetta.esm.min.js', 'build/mathzetta.cjs', ...Object.keys(FLAVOURS).map(flavourFile), ...Object.keys(PLAIN_FLAVOURS).map(flavourFile), 'build/mathzetta.core.esm.min.js', 'build/mathzetta.plain.esm.min.js', 'build/mathzetta.plain.cjs', 'build/esm/core.js', 'build/esm/latex.js', 'build/esm/chunks/core.js', 'build/esm-plain/latex.js', 'build/esm-plain/chunks/core.js']) {
            eq(head(f).includes(`MathZetta ${pkg.version} `), true, `${f} banner has version ${pkg.version}`);
        }
    });
    test('the minified ES module (the CDN file) parses like the source', async () => {
        const cdn = await import(new URL('build/mathzetta.esm.min.js', root));
        eq(typeof cdn.parse, 'function');
        eq(typeof cdn.toLaTeX, 'function');
        eq(typeof cdn.calculate, 'function');
        eq(cdn.parse('2x sin x'), parse('2x sin x'));
        eq(cdn.version, pkg.version);
    });
    test('the split ES modules share one core and give the same answers', async () => {
        const latex = await import(new URL('build/esm/latex.js', root));
        const speech = await import(new URL('build/esm/speech.js', root));
        const core = await import(new URL('build/esm/core.js', root));
        eq(latex.toLaTeX('x^2/2'), (await import('../../src/latex.js')).toLaTeX('x^2/2'));
        eq(typeof speech.toSpeech, 'function');
        eq(core.parse('2x'), parse('2x'));
        const files = ['build/esm/latex.js', 'build/esm/speech.js'].map((f) => readFileSync(new URL(f, root), 'utf8'));
        eq(files.every((c) => c.includes('./chunks/core.js')), true, 'both import the shared core chunk');
    });
    test('every entry\'s types declare every name it exports', async () => {
        for (const [key, target] of Object.entries(pkg.exports)) {
            if (typeof target !== 'object' || !target.types) continue;
            const names = declared(target.types.replace(/^\.\//, ''));
            const runtime = Object.keys(await import(new URL(target.import, root)));
            eq(runtime.filter((name) => !names.has(name)), [], `${key}: exported, but not in ${target.types}`);
        }
        // and what an entry's .d.ts re-exports from types.d.ts is declared there
        const types = declared('src/types.d.ts');
        for (const f of readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.d.ts') && f !== 'types.d.ts')) {
            const text = readFileSync(new URL(`src/${f}`, root), 'utf8');
            const reexported = [...text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'\.\/types\.js'/g)]
                .flatMap((m) => m[1].split(',').map((p) => p.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));
            eq(reexported.filter((name) => !types.has(name)), [], `src/${f}: not declared in types.d.ts`);
        }
    });
    test('build/sizes.json lists every file in build/ for this version', () => {
        const sizes = JSON.parse(readFileSync(new URL('build/sizes.json', root), 'utf8'));
        eq(sizes.version, pkg.version);
        const files = buildFiles().filter((f) => f !== 'build/sizes.json').sort();
        eq(files.filter((f) => typeof sizes.files[f]?.gz !== 'number'), [], 'in build/, not in sizes.json');
        eq(Object.keys(sizes.files).filter((f) => !files.includes(f)), [], 'in sizes.json, not in build/');
        eq(files.length > 80, true, `${files.length} files`);
        eq(sizes.files['build/esm/latex.js'].imports.includes('./chunks/core.js'), true);
    });
    test('each <script> flavour carries its outputs and no others', () => {
        const MAIN = { latex: 'toLaTeX', mathml: 'toMathML', text: 'toText', speech: 'toSpeech', javascript: 'toJavaScript', python: 'toPython', sql: 'toSQL', excel: 'toExcel', glsl: 'toGLSL', evaluate: 'evaluate', calculate: 'calculate', formulas: 'strToFunction' };
        for (const [name, outputs] of [...Object.entries(FLAVOURS), ...Object.entries(PLAIN_FLAVOURS)]) {
            const mz = loadUmd(flavourFile(name));
            eq(typeof mz.parse, 'function', `${name}: parse`);
            for (const [output, fn] of Object.entries(MAIN)) eq(typeof mz[fn] === 'function', outputs.includes(output), `${name}: ${fn} ${outputs.includes(output) ? 'present' : 'absent'}`);
        }
        eq(typeof loadUmd('build/mathzetta.formulas.min.js').forXlsxFile, 'function', 'formulas brings what tabview needs');
    });
    test('require() reaches every entry point, each with the same exports as import', async () => {
        const exportsMap = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).exports;
        const requireHere = createRequire(import.meta.url);
        for (const [path, target] of Object.entries(exportsMap)) {
            if (typeof target !== 'object') continue;
            eq(typeof target.require, 'string', `${path} has a require target`);
            const required = requireHere(new URL(target.require, root).pathname);
            if (path === '.' || path === './plain') continue;   // require('mathzetta') is everything; plain is checked below
            const imported = await import(new URL(target.import, root));
            for (const name of Object.keys(imported)) eq(typeof required[name], typeof imported[name], `${path}: ${name}`);
        }
        const cjs = (entry) => requireHere(new URL(`build/cjs/${entry}.cjs`, root).pathname);
        eq(cjs('latex').toLaTeX('x^2/2'), (await import('../../src/latex.js')).toLaTeX('x^2/2'));
        eq(cjs('calculate').calculate('1/3 + 1/6'), (await import('../../src/calculate.js')).calculate('1/3 + 1/6'));    });
    test('the plain builds read math and LaTeX like the core, and no code spellings', async () => {
        const plain = await import(new URL('build/mathzetta.plain.esm.min.js', root));
        for (const input of ['3x^2 + sin(x)', '\\frac{d}{dx} x^2', 'sqrt(8)/2', 'x_1 + y_2', '2^3^2', 'max(a, b+1)']) eq(plain.parse(input), parse(input), input);
        eq(parse('np.sin(x)'), ['x', 'sin'], 'the core reads numpy');
        eq(plain.parse('np.sin(x)')[1] !== 'sin', true, 'the plain build does not');
        const plainCjs = createRequire(import.meta.url)(new URL('build/mathzetta.plain.cjs', root).pathname);
        eq(plainCjs.parse('3x^2 + sin(x)'), parse('3x^2 + sin(x)'), 'require("mathzetta/plain") reads the same');
        eq(plainCjs.parse('np.sin(x)')[1] !== 'sin', true, 'and no code spellings');
        const code = readFileSync(new URL('build/mathzetta.plain.min.js', root), 'utf8');
        eq(code.includes('Piecewise'), false, 'the code reader is not in the plain script');
        eq(readFileSync(new URL('build/mathzetta.core.min.js', root), 'utf8').includes('Piecewise'), true, 'but it is in the core');
        const latex = await import(new URL('build/esm-plain/latex.js', root));
        eq(latex.toLaTeX('x^2/2'), (await import('../../src/latex.js')).toLaTeX('x^2/2'));
        const sizes = JSON.parse(readFileSync(new URL('build/sizes.json', root), 'utf8'));
        eq(sizes.files['build/mathzetta.plain.min.js'].gz < sizes.files['build/mathzetta.core.min.js'].gz, true, 'plain is smaller');
    });
    test('the core bundle parses but carries no outputter', async () => {
        const core = await import(new URL('build/mathzetta.core.esm.min.js', root));
        eq(core.parse('2x sin x'), parse('2x sin x'));
        eq(typeof core.operator, 'function');
        eq('toLaTeX' in core, false, 'no toLaTeX in the core');
        eq('calculate' in core, false, 'no calculate in the core');
    });
});
