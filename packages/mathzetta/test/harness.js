/**
 * A very small test harness: suites of named checks, a summary, an exit code.
 *
 *   suite('tokenizer', () => {
 *       test('splits operators', () => eq(tokenize('a+b'), ['a', '+', 'b']));
 *       skip('runs the Python', 'python3 is not installed');   // counted as skipped, never as passed
 *   });
 */

import { deepStrictEqual } from 'node:assert';
import { inspect } from 'node:util';

const results = { passed: 0, failed: [], skipped: [] };
const pending = [];   // async tests: report() waits for them
// SLOW_MS=200 node test/run.js lists the synchronous tests that took longer than that
const slowMs = Number(globalThis.process?.env?.SLOW_MS) || 0;
const slow = [];
let current = '';

export function suite(name, body) {
    current = name;
    body();
}

export function test(name, body) {
    const full = `${current}: ${name}`;
    const fail = (error) => results.failed.push({ name: full, message: error?.message ?? String(error) });
    const start = slowMs ? Date.now() : 0;
    try {
        const result = body();
        if (slowMs && Date.now() - start >= slowMs) slow.push(`${Date.now() - start} ms  ${full}`);
        if (result && typeof result.then === 'function') {
            // counted once it settles: a test that resolves later is not a pass until then
            pending.push(Promise.resolve(result).then(() => { results.passed++; }, fail));
        } else {
            results.passed++;
        }
    } catch (error) {
        fail(error);
    }
}

/** A test that cannot run here (a runtime is missing): listed as skipped, with the reason, not counted as passed. */
export function skip(name, reason) {
    results.skipped.push({ name: `${current}: ${name}`, reason });
}

/** Any value as readable text: strings as they are, everything else (BigInt, NaN, ∞, -0, cycles) through inspect. */
export function show(value) {
    return typeof value === 'string' ? value : inspect(value, { depth: 6, breakLength: Infinity });
}

/** Deep equality with a readable message. */
export function eq(actual, expected, label = '') {
    try {
        deepStrictEqual(actual, expected);
    } catch {
        throw new Error(`${label ? label + ': ' : ''}expected ${show(expected)}\n      got      ${show(actual)}`);
    }
}

/**
 * Does `error` match `expect`? `expect` is a RegExp (the message), an error class (instanceof), or
 * `{ class, message }` (either or both). Returns a description of the mismatch, or '' when it matches.
 */
function mismatch(error, expect) {
    if (expect === undefined) return '';
    const what = `${error?.constructor?.name ?? typeof error} "${error?.message ?? String(error)}"`;
    const { class: Kind, message } = expect instanceof RegExp ? { message: expect }
        : typeof expect === 'function' ? { class: expect } : expect;
    if (Kind && !(error instanceof Kind)) return `threw ${what}, expected ${Kind.name}`;
    if (message && !message.test(error?.message ?? String(error))) return `threw ${what}, expected ${message}`;
    return '';
}

/**
 * Expect `body` to throw. `expect`: a RegExp for the message, an error class, or `{ class, message }`.
 * For an async body use `rejects`.
 */
export function throws(body, expect) {
    let result;
    try {
        result = body();
    } catch (error) {
        const problem = mismatch(error, expect);
        if (problem) throw new Error(problem);
        return error;
    }
    if (result && typeof result.then === 'function') throw new Error('expected an error, got a promise: use rejects()');
    throw new Error('expected an error');
}

/** Expect `body` (a promise, or a function returning one) to reject; `expect` as for `throws`. Returns a promise. */
export async function rejects(body, expect) {
    try {
        await (typeof body === 'function' ? body() : body);
    } catch (error) {
        const problem = mismatch(error, expect);
        if (problem) throw new Error(problem);
        return error;
    }
    throw new Error('expected a rejection');
}

/** Print the summary once every async test has settled; resolves true when everything passed. */
export async function report() {
    await Promise.all(pending);
    if (slowMs) for (const line of slow.sort((a, b) => parseInt(b) - parseInt(a))) console.log(`  SLOW ${line}`);
    for (const s of results.skipped) console.log(`  SKIP ${s.name}\n      ${s.reason}`);
    for (const f of results.failed) console.log(`  FAIL ${f.name}\n      ${f.message}`);
    const skipped = results.skipped.length ? `, ${results.skipped.length} skipped` : '';
    console.log(`\n${results.passed} passed, ${results.failed.length} failed${skipped}`);
    return results.failed.length === 0;
}
