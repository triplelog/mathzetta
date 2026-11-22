/**
 * What more than one test file needs: quick() (an answer or a refusal, within a time) and SQLite
 * (node:sqlite, Node 22.5+; older Nodes skip the tests that run SQL).
 */
import { test, skip, eq } from './harness.js';

/** `fn` holds its own assertion (an answer, or a refusal with `throws`): it must pass, and within `ms`. */
export function quick(fn, ms = 1500) {
    const t = Date.now();
    let failure;
    try { fn(); } catch (error) { failure = error; }
    eq(Date.now() - t < ms, true, `took ${Date.now() - t} ms`);
    if (failure) throw failure;
}

// node:sqlite prints an ExperimentalWarning on first load: keep it out of the test output.
async function loadSqlite() {
    const emit = process.emitWarning;
    process.emitWarning = (warning, ...rest) => {
        const text = typeof warning === 'string' ? warning : warning?.message;
        if (/SQLite is an experimental feature/.test(text ?? '')) return;
        emit.call(process, warning, ...rest);
    };
    try {
        return (await import('node:sqlite')).DatabaseSync;
    } catch {
        return null;
    } finally {
        process.emitWarning = emit;
    }
}

/** node:sqlite's DatabaseSync, or null where Node has none. */
export const DatabaseSync = await loadSqlite();

/** `test` where node:sqlite is there, else a skip (counted as skipped, not passed). */
export const sqliteTest = DatabaseSync ? test : (name) => skip(name, 'node:sqlite is missing (Node before 22.5)');
