/** 'mathzetta/excel' — a spreadsheet formula for Excel and Google Sheets: =IF(x>0, SQRT(x), 0). */

import { treeOf, isEmpty } from './input.js';
import { toExcelFormula, forXlsxFile } from './render/excel.js';

export { forXlsxFile };

/**
 * @param {string|string[]|object} input expression text, standard postfix or a tree
 * @param {object} [options] { cells, ranges, equals } — see render/excel.js
 */
export function toExcel(input, options = {}) {
    if (isEmpty(input)) return options.equals === false ? '0' : '=0';
    return toExcelFormula(treeOf(input), options);
}
