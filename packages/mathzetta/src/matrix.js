/**
 * Matrix arithmetic over any kind of number: calculate.js runs it on exact values (fractions stay
 * fractions, so a determinant or an inverse is exact) and evaluate.js on doubles.
 *
 * A matrix is an array of rows, each an array of entries, all the same length; a vector is a flat
 * array. `ring` says how to work with the entries:
 *   { add, sub, mul, div, isZero, zero, one, size?, fail, make? }
 * size(x) (a magnitude, for choosing pivots in doubles) is optional; fail(message) throws the
 * caller's "no answer" error; make(rows, like) wraps a result the way the caller marks matrices.
 */

/** Is `v` a matrix: rows of entries, all the same length (and no deeper lists)? */
export function isMatrixValue(v) {
    return Array.isArray(v) && v.length > 0 && v.every((r) => Array.isArray(r) && r.length > 0 && r.length === v[0].length && !r.some(Array.isArray));
}

/** Is `v` a vector: a flat list of entries? */
export const isVectorValue = (v) => Array.isArray(v) && v.length > 0 && !v.some(Array.isArray);

export function matrixArithmetic(ring) {
    const R = ring;
    const make = R.make ?? ((rows) => rows);
    const size = R.size ?? (() => 1);
    const shape = (A) => `${A.length} by ${A[0].length}`;

    const identity = (n, like) => make(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? R.one() : R.zero()))), like);
    const transpose = (A) => make(A[0].map((_, j) => A.map((r) => r[j])), A);

    function times(A, B) {
        if (A[0].length !== B.length) R.fail(`a ${shape(A)} matrix times a ${shape(B)} one`);
        return make(A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => R.add(s, R.mul(x, B[k][j])), R.zero()))), A);
    }

    /** Row reduction to reduced echelon form; also the determinant and the rank. */
    function reduce(A) {
        const M = A.map((r) => r.slice());
        const rows = M.length;
        const cols = M[0].length;
        let det = R.one();
        let rank = 0;
        for (let c = 0; c < cols && rank < rows; c++) {
            // the pivot: any non-zero entry when exact, the largest in doubles
            let p = -1;
            for (let r = rank; r < rows; r++) {
                if (R.isZero(M[r][c])) continue;
                if (p < 0 || size(M[r][c]) > size(M[p][c])) p = r;
            }
            if (p < 0) { det = R.zero(); continue; }
            if (p !== rank) { [M[p], M[rank]] = [M[rank], M[p]]; det = R.sub(R.zero(), det); }
            const pivot = M[rank][c];
            det = R.mul(det, pivot);
            M[rank] = M[rank].map((x) => R.div(x, pivot));
            for (let r = 0; r < rows; r++) {
                if (r === rank || R.isZero(M[r][c])) continue;
                const f = M[r][c];
                M[r] = M[r].map((x, k) => R.sub(x, R.mul(f, M[rank][k])));
            }
            rank++;
        }
        if (rank < rows) det = R.zero();
        return { M, det, rank };
    }

    function det(A) {
        if (A.length !== A[0].length) R.fail(`a ${shape(A)} matrix has no determinant`);
        return reduce(A).det;
    }

    function inverse(A) {
        const n = A.length;
        if (n !== A[0].length) R.fail(`a ${shape(A)} matrix has no inverse`);
        const I = identity(n);
        const { M, rank } = reduce(A.map((r, i) => [...r, ...I[i]]));
        if (rank < n || M.some((r, i) => R.isZero(r[i]))) R.fail('the matrix has no inverse (its determinant is 0)');
        return make(M.map((r) => r.slice(n)), A);
    }

    function power(A, n) {
        if (A.length !== A[0].length) R.fail(`a ${shape(A)} matrix has no powers`);
        let base = n < 0n ? inverse(A) : A;
        let k = n < 0n ? -n : n;
        let out = identity(A.length, A);
        while (k > 0n) {
            if (k & 1n) out = times(out, base);
            base = times(base, base);
            k >>= 1n;
        }
        return out;
    }

    const trace = (A) => {
        if (A.length !== A[0].length) R.fail(`a ${shape(A)} matrix has no trace`);
        return A.reduce((s, r, i) => R.add(s, r[i]), R.zero());
    };

    const dot = (u, v) => {
        if (u.length !== v.length) R.fail('vectors of different lengths');
        return u.reduce((s, x, i) => R.add(s, R.mul(x, v[i])), R.zero());
    };

    const cross = (u, v) => {
        if (u.length !== 3 || v.length !== 3) R.fail('the cross product is for vectors of 3 numbers');
        return [
            R.sub(R.mul(u[1], v[2]), R.mul(u[2], v[1])),
            R.sub(R.mul(u[2], v[0]), R.mul(u[0], v[2])),
            R.sub(R.mul(u[0], v[1]), R.mul(u[1], v[0])),
        ];
    };

    /** A x = b, for one solution: b a vector (the answer is a vector) or a matrix. */
    function solve(A, b) {
        if (isMatrixValue(b)) return times(inverse(A), b);
        const x = times(inverse(A), b.map((y) => [y]));
        return x.map((r) => r[0]);
    }

    return {
        identity, transpose, times, det, inverse, power, trace, dot, cross, solve,
        rank: (A) => reduce(A).rank,
        rref: (A) => make(reduce(A).M, A),
        /** A matrix times a vector (a column), or a vector (a row) times a matrix: a vector. */
        timesVector: (A, v) => times(A, v.map((y) => [y])).map((r) => r[0]),
        vectorTimes: (v, A) => times([v], A)[0],
    };
}
