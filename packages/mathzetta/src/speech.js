/** 'mathzetta/speech' — the expression read aloud, as a teacher would: toSpeech() beside the drawing (a
 *  video, captions), toAudioSpeech() for a listener who cannot see it (a screen reader). */

import { treeOf, isEmpty } from './input.js';
import {
    toSpeech as speak, toSpeechSegments as speakSegments, toAudioSpeech as speakAudio, toAudioSpeechSegments as speakAudioSegments,
} from './render/speech.js';

export { WORDS as SPEECH_WORDS, NAMES as SPEECH_NAMES } from './render/speech.js';

/**
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {object} [options] { words, names, say } — every word and phrase can be changed; see render/speech.js
 * @returns {string} "x squared plus 1"
 */
export function toSpeech(input, options = {}) {
    if (isEmpty(input)) return '';
    return speak(treeOf(input), options);
}

/** The spoken phrase in pieces tagged with node ids, [{ text, id }], for captions that follow the maths. */
export function toSpeechSegments(input, options = {}) {
    if (isEmpty(input)) return [];
    return speakSegments(treeOf(input), options);
}

/**
 * The expression for a listener who cannot see it — a screen reader, audio only. Same words as
 * toSpeech(), but a compound radicand, exponent, subscript, denominator, argument … is opened
 * with "the quantity" and closed with an end word, so the grouping is in the words:
 * "the square root of the quantity x plus 1, end root, plus 2". Same options as toSpeech().
 * @returns {string}
 */
export function toAudioSpeech(input, options = {}) {
    if (isEmpty(input)) return '';
    return speakAudio(treeOf(input), options);
}

/** toAudioSpeech() in pieces tagged with node ids, [{ text, id }]. */
export function toAudioSpeechSegments(input, options = {}) {
    if (isEmpty(input)) return [];
    return speakAudioSegments(treeOf(input), options);
}
