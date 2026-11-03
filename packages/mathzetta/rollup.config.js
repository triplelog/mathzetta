// `npm run build` writes build/ — what the CDN serves (tools/cdn.js --sizes then measures it into
// build/sizes.json, which the site's CDN page reads):
//   mathzetta.esm.js / .esm.min.js   everything (src/all.js) as an ES module
//   mathzetta.cjs                    CommonJS, for require()
//   mathzetta.js / .min.js           everything for a <script> tag: window.MathZetta
//   mathzetta.<flavour>.min.js       <script> tags with less in them, each setting window.MathZetta:
//                                    the flavours are listed in tools/flavours.js (core; core + one output;
//                                    display; maths; maths + display; maths + one code output; code)
//   mathzetta.core.esm.min.js        the core as an ES module
//   esm/<entry>.js, esm/chunks/      every entry point as its own ES module, all of them sharing
//                                    chunks/core.js: a page imports the outputs it wants, the core loads once
//   cjs/<entry>.cjs, cjs/chunks/     the same for require('mathzetta/<entry>') (require('mathzetta') is everything)
//   mathzetta.plain*.min.js, mathzetta.plain.esm.min.js, mathzetta.plain.cjs, esm-plain/
//                                    the same without the code-spelling reader (src/parse/clean/code.js —
//                                    numpy, SymPy, SQL, spreadsheets, GLSL on input): maths and LaTeX
//                                    only, about 5 KB gzipped less; the flavours without a code output
import terser from '@rollup/plugin-terser';
import { rollup } from 'rollup';
import { readFileSync } from 'node:fs';
import { ENTRIES, FLAVOURS, PLAIN_FLAVOURS } from './tools/flavours.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const src = (entry) => new URL(`./src/${entry}.js`, import.meta.url).pathname;
const banner = (what = '') => `/* MathZetta ${version}${what ? ' ' + what : ''} — MIT licence — https://mathzetta.com */`;
// The <script> builds also define this global; window.MathZetta is the one to use.
const name = 'MathZettaModule';
const min = terser({ format: { comments: /MIT licence/ } });
const quiet = (warning, warn) => { if (!['NAMESPACE_CONFLICT', 'MIXED_EXPORTS', 'CIRCULAR_DEPENDENCY'].includes(warning.code)) warn(warning); };

// a flavour's entry: the core and some outputters as one object, on window.MathZetta like src/all.js
const flavour = (outputs) => ({
    name: 'flavour',
    resolveId: (id) => (id === '\0flavour' ? id : null),
    load: (id) => (id !== '\0flavour' ? null : [
        `import * as core from ${JSON.stringify(src('index'))};`,
        ...outputs.map((o) => `import * as ${o} from ${JSON.stringify(src(o))};`),
        `export * from ${JSON.stringify(src('index'))};`,
        ...outputs.map((o) => `export * from ${JSON.stringify(src(o))};`),
        `const MathZetta = Object.assign({}, core${outputs.map((o) => `, ${o}`).join('')});`,
        `if (typeof window !== 'undefined') window.MathZetta = MathZetta;`,
        `export default MathZetta;`,
    ].join('\n')),
});

// the plain builds: the code-reading phase resolves to its identity stand-in
const plainReader = {
    name: 'plain-reader',
    resolveId: (source, importer) => (importer && source.endsWith('/code-phase.js') ? new URL('./src/parse/clean/code-phase.plain.js', import.meta.url).pathname : null),
};

export default async () => {
    // the modules the core is made of: the ES build keeps them in one shared chunk
    const core = await rollup({ input: src('index'), onwarn: quiet });
    const coreIds = new Set(Object.keys((await core.generate({ format: 'es' })).output[0].modules));
    await core.close();

    return [
        {
            input: src('all'),   // the bundles hold everything; ESM users import the entry points in src/
            onwarn: quiet,
            output: [
                { file: 'build/mathzetta.esm.js', format: 'es', banner: banner() },
                { file: 'build/mathzetta.esm.min.js', format: 'es', banner: banner(), plugins: [min] },
                { file: 'build/mathzetta.cjs', format: 'cjs', exports: 'named', banner: banner() },
                { file: 'build/mathzetta.js', format: 'umd', name, exports: 'named', banner: banner() },
                { file: 'build/mathzetta.min.js', format: 'umd', name, exports: 'named', banner: banner(), plugins: [min] },
            ],
        },
        ...Object.entries(FLAVOURS).map(([flavourName, outputs]) => ({
            input: '\0flavour',
            plugins: [flavour(outputs)],
            onwarn: quiet,
            output: { file: `build/mathzetta.${flavourName}.min.js`, format: 'umd', name, exports: 'named', banner: banner(flavourName), plugins: [min] },
        })),
        {
            input: src('index'),
            onwarn: quiet,
            output: { file: 'build/mathzetta.core.esm.min.js', format: 'es', banner: banner('core'), plugins: [min] },
        },
        {
            input: Object.fromEntries([['core', src('index')], ...ENTRIES.map((e) => [e, src(e)])]),
            onwarn: quiet,
            output: {
                dir: 'build/esm', format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js',
                banner: banner('esm'), plugins: [min],
                manualChunks: (id) => (coreIds.has(id) ? 'core' : undefined),
            },
        },
        {
            // the same split for require(): require('mathzetta/latex') loads the core and LaTeX, like import does
            input: Object.fromEntries([['core', src('index')], ...ENTRIES.map((e) => [e, src(e)])]),
            onwarn: quiet,
            output: {
                dir: 'build/cjs', format: 'cjs', exports: 'named', entryFileNames: '[name].cjs', chunkFileNames: 'chunks/[name].cjs',
                banner: banner('cjs'), plugins: [min],
                manualChunks: (id) => (coreIds.has(id) ? 'core' : undefined),
            },
        },
        // plain: the same three kinds of build without the code-spelling reader
        ...Object.entries(PLAIN_FLAVOURS).map(([flavourName, outputs]) => ({
            input: '\0flavour',
            plugins: [flavour(outputs), plainReader],
            onwarn: quiet,
            output: { file: `build/mathzetta.${flavourName}.min.js`, format: 'umd', name, exports: 'named', banner: banner(flavourName), plugins: [min] },
        })),
        {
            input: src('index'),
            plugins: [plainReader],
            onwarn: quiet,
            output: [
                { file: 'build/mathzetta.plain.esm.min.js', format: 'es', banner: banner('plain'), plugins: [min] },
                { file: 'build/mathzetta.plain.cjs', format: 'cjs', exports: 'named', banner: banner('plain'), plugins: [min] },
            ],
        },
        {
            input: Object.fromEntries([['core', src('index')], ...ENTRIES.map((e) => [e, src(e)])]),
            plugins: [plainReader],
            onwarn: quiet,
            output: {
                dir: 'build/esm-plain', format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js',
                banner: banner('plain esm'), plugins: [min],
                manualChunks: (id) => (coreIds.has(id) || id.endsWith('code-phase.plain.js') ? 'core' : undefined),
            },
        },
    ];
};
