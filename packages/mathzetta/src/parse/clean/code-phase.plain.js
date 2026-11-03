/**
 * The "plain" builds' stand-in for code-phase.js: no code-spelling reading at all. `np.sin(x)`,
 * SQL's CASE, a spreadsheet's =SUM(…), SymPy's names and the rest arrive at the parser as written.
 */
export const codePhase = (text) => text;
