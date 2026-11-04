// TFLite ADD Prepare requires equal input dtypes and right-aligned
// broadcasting. Check the declared output interface used by exported models.
function knownRank(tensor) {
    const {shape, shape_signature: signature, has_rank: hasRank} = tensor;
    if (!Array.isArray(shape) && !ArrayBuffer.isView(shape)) return null;
    const rank = shape.length;
    if (rank === undefined || rank > 128 || (!rank && (hasRank === false || signature?.length))) return null;
    return rank;
}

function knownExtent(tensor, axis) {
    const {shape, shape_signature: signature} = tensor;
    const extent = shape[axis];
    if (signature?.length && (signature.length !== shape.length || signature[axis] !== extent)) return null;
    return Number.isInteger(extent) && extent >= 0 && extent <= 2147483647 ? extent : null;
}

export function checkAddMetadata(inputs, outputs) {
    const [left, right] = inputs, [output] = outputs;
    if (inputs.length !== 2 || outputs.length !== 1 || !left || !right || !output) {
        throw Error('ADD 需要 2 個完整輸入與 1 個完整輸出。');
    }
    if (left.type !== right.type || left.type !== output.type) throw Error('ADD 輸入／輸出 dtype 不符。');

    const aRank = knownRank(left), bRank = knownRank(right), outRank = knownRank(output);
    const unknown = {status:'not-run', reason:'ADD 含動態或未知 shape，僅核對已知的 rank 與 broadcast 維度。'};
    if (aRank === null || bRank === null) return unknown;

    const rank = Math.max(aRank, bRank);
    if (outRank !== null && outRank !== rank) throw Error('ADD 輸出 shape 的 rank 不符合 broadcast 結果。');
    let partial = outRank === null;
    for (let axis = 0; axis < rank; axis++) {
        const x = axis < aRank ? knownExtent(left, aRank - 1 - axis) : 1;
        const y = axis < bRank ? knownExtent(right, bRank - 1 - axis) : 1;
        if (x !== null && y !== null && x !== y && x !== 1 && y !== 1) throw Error('ADD 的輸入 shape 無法 broadcast。');
        // Any known non-unit extent fixes this output extent for valid broadcasts.
        const expected = x !== null && x !== 1 ? x : y === 1 ? x : y;
        const actual = outRank === null ? null : knownExtent(output, rank - 1 - axis);
        if (expected !== null && actual !== null && actual !== expected) throw Error('ADD 的輸出 shape 不符合 broadcast 結果。');
        partial ||= x === null || y === null || actual === null;
    }
    if (partial) return unknown;
    if (left.type !== 0) return {status:'not-run', reason:'ADD 已核對 broadcast shape 與 dtype 一致性，此 dtype 或量化的 kernel 條件尚未驗證。'};
    return {status:'passed', reason:'已核對 ADD float32 dtype、broadcast 與輸出 shape，未執行 kernel。'};
}
