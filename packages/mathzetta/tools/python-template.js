#!/usr/bin/env node
/**
 * Fill a Python template's formula slots, and run it.
 *
 *   mathzetta-python <template.py> [slot=formula …] [options]
 *
 *   --slots              list the slots and the data's columns, and stop
 *   --data <file.csv>    the table (default: the template's `# mathzetta-data:`, relative to the template)
 *   --numpy | --math     override the template's mode
 *   --errors raise|nan   what 1/0 does (default: the template's, else raise)
 *   -o <file.py>         write the program there (default: print it)
 *   --run [args …]       run it with python3 ($PYTHON) instead; what follows goes to the program
 *
 *   mathzetta-python examples/python/logistic.py growth='r P ln(K / P) - h' -o model.py
 *   mathzetta-python chart.py x='BB / AB' --run chart.png
 */

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, basename } from 'node:path';
import { fillPythonTemplate, readPythonTemplate } from '../src/python.js';

const USAGE = 'usage: mathzetta-python <template.py> [slot=formula …] [--slots] [--data file.csv] [--numpy|--math] [--errors raise|nan] [-o out.py] [--run args…]';

/** The first line of a CSV file, split into fields ("quoted, with commas" allowed). */
function csvHeader(path) {
    const line = readFileSync(path, 'utf8').split(/\r?\n/, 1)[0].replace(/^﻿/, '');
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false;
            else field += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { fields.push(field); field = ''; } else field += ch;
    }
    fields.push(field);
    return fields;
}

function parseArgs(argv) {
    const args = { formulas: {}, options: {}, runArgs: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const value = () => {
            if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
            return argv[++i];
        };
        if (a === '--run') { args.runArgs = argv.slice(i + 1); break; }
        if (a === '--slots') args.slots = true;
        else if (a === '--data') args.data = value();
        else if (a === '--numpy' || a === '--math') args.options.numpy = a === '--numpy';
        else if (a === '--errors') args.options.errors = value();
        else if (a === '-o') args.out = value();
        else if (a === '-h' || a === '--help') args.help = true;
        else if (a.startsWith('-')) throw new Error(`unknown option ${a}\n${USAGE}`);
        else if (!args.template) args.template = a;
        else {
            const m = /^([\p{L}_][\p{L}\p{N}_]*)=(.*)$/su.exec(a);
            if (!m) throw new Error(`"${a}" should be slot=formula`);
            args.formulas[m[1]] = m[2];
        }
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.template) {
        console.log(USAGE);
        return args.help ? 0 : 2;
    }
    const template = readFileSync(args.template, 'utf8');
    const read = readPythonTemplate(template);
    const dataPath = args.data ? resolve(args.data) : read.data ? resolve(dirname(args.template), read.data) : null;
    const columns = dataPath ? csvHeader(dataPath) : undefined;

    if (args.slots) {
        for (const s of read.slots) console.log(`${s.name}(${s.params.join(', ')})${s.formula ? ` = ${s.formula}` : ''}`);
        if (columns) console.log(`\ncolumns of ${dataPath}:\n  ${columns.join(', ')}`);
        return 0;
    }

    const program = fillPythonTemplate(template, args.formulas, { ...args.options, columns, data: dataPath ?? undefined });
    if (args.runArgs) {
        const dir = mkdtempSync(join(tmpdir(), 'mathzetta-'));
        const file = join(dir, basename(args.template));
        try {
            writeFileSync(file, program);
            const r = spawnSync(process.env.PYTHON || 'python3', [file, ...args.runArgs], { stdio: 'inherit' });
            if (r.error) throw r.error;
            return r.status ?? 1;
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }
    if (args.out) writeFileSync(args.out, program);
    else process.stdout.write(program);
    return 0;
}

try {
    process.exitCode = main();
} catch (error) {
    console.error(`mathzetta-python: ${error.message}`);
    process.exitCode = 1;
}
