/**
 * The code-spelling reader as a cleaning phase. clean/index.js takes it from here rather than from
 * code.js so that a build can leave it out: the "plain" bundles (rollup.config.js) resolve this
 * file to code-phase.plain.js instead, and read maths and LaTeX only — about 5 KB gzipped less.
 */
export { codeRewrites as codePhase } from './code.js';
