/** 'mathzetta/sql' — a SQL expression; PostgreSQL by default, or { dialect: 'sqlite' }. */

import { treeOf, isEmpty } from './input.js';
import { toSqlCode } from './render/sql.js';

/**
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {object} [options] { dialect, quoteIdentifiers, stringQuote, columns } — see render/sql.js
 */
export function toSQL(input, options = {}) {
    if (isEmpty(input)) return '0';
    return toSqlCode(treeOf(input), options);
}
