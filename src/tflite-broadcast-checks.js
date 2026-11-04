// ADD and MUL Prepare require equal input dtypes and right-aligned
// broadcasting. The exported model must declare the resulting interface.
import {tflite as schema} from '../vendor/netron/tflite-schema.js';

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

function elementCount(tensor) {
    return tensor.shape.reduce((count, extent) => count * BigInt(extent), 1n);
}

export function checkBroadcastMetadata(name, inputs, outputs) {
    const [left, right] = inputs, [output] = outputs;
    if (inputs.length !== 2 || outputs.length !== 1 || !left || !right || !output) {
        throw Error(name + ' 需要 2 個完整輸入與 1 個完整輸出。');
    }
    const {FLOAT32, INT16, INT8, UINT8} = schema.TensorType;
    const mixedMul = name === 'MUL' && left.type === INT16 && (output.type === INT8 || output.type === UINT8);
    if (left.type !== right.type || (left.type !== output.type && !mixedMul)) {
        throw Error(name + ' 輸入／輸出 dtype 不符。');
    }

    const aRank = knownRank(left), bRank = knownRank(right), outRank = knownRank(output);
    const unknown = {status:'not-run', reason:name + ' 含動態或未知 shape，僅核對已知的 rank 與 broadcast 維度。'};
    if (aRank === null || bRank === null) return unknown;

    const rank = Math.max(aRank, bRank);
    if (outRank !== null && outRank !== rank) throw Error(name + ' 輸出 shape 的 rank 不符合 broadcast 結果。');
    let partial = outRank === null;
    for (let axis = 0; axis < rank; axis++) {
        const x = axis < aRank ? knownExtent(left, aRank - 1 - axis) : 1;
        const y = axis < bRank ? knownExtent(right, bRank - 1 - axis) : 1;
        if (x !== null && y !== null && x !== y && x !== 1 && y !== 1) throw Error(name + ' 的輸入 shape 無法 broadcast。');
        // Any known non-unit extent fixes this output extent for valid broadcasts.
        const expected = x !== null && x !== 1 ? x : y === 1 ? x : y;
        const actual = outRank === null ? null : knownExtent(output, rank - 1 - axis);
        if (expected !== null && actual !== null && actual !== expected) throw Error(name + ' 的輸出 shape 不符合 broadcast 結果。');
        partial ||= x === null || y === null || actual === null;
    }
    if (partial) return unknown;
    // The mixed 16-bit to 8-bit kernels use a flat elementwise loop.
    if (mixedMul) {
        const count = elementCount(output);
        if (elementCount(left) !== count || elementCount(right) !== count) {
            throw Error('MUL 的 int16 輸入與 8-bit 輸出必須有相同元素數。');
        }
    }
    if (left.type !== FLOAT32) return {status:'not-run', reason:name + ' 已核對 shape 與 dtype 介面，此 dtype 或量化的 kernel 條件尚未驗證。'};
    return {status:'passed', reason:'已核對 ' + name + ' float32 dtype、broadcast 與輸出 shape，未執行 kernel。'};
}
