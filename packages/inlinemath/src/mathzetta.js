/**
 * Where Inline Math reaches into MathZetta: this file (the core and speech) and calculator.js (the
 * calculator, for `{{…}}` blocks). Everything else imports from these two, so a change in
 * MathZetta's API is a small change — and the lite build, which leaves the calculator out, is
 * everything that doesn't import calculator.js.
 *
 * MathZetta is a peer dependency; a page without a bundler maps the names with an import map (as
 * the README shows).
 */

export {
    parse, parseTree, fromPostfix, toPostfix, walk, firstVariable,
    operator, precedenceOf, isCustomFunction, VARIADIC,
    GREEK, needsBrackets, unaryNeedsBrackets, isMinusOneTimes, isImplicitProduct, isVariable,
    firstLeaf, customName, derivativeOrder, bracketedSides, bracketOp,
    MATRICES, matrixRows,
} from 'mathzetta';
export { toSpeechSegments, toAudioSpeech } from 'mathzetta/speech';
