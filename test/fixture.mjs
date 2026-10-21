// A small, valid FlatBuffer writer for deterministic TFLite integration fixtures.
import { tflite as schema } from '../vendor/netron/tflite-schema.js';
export function fixture({ graphCount = 2, weightBytes = 8, repeats = 1, variant = 'chain', brokenJoin = false } = {}) {
    const bytes = Array(8).fill(0);
    const align = (n = 8) => { while (bytes.length % n) bytes.push(0); };
    const reserve = (size) => { const pos = bytes.length; bytes.push(...Array(size).fill(0)); return pos; };
    const write = (pos, value, size = 4) => { let n = BigInt(value); for (let i = 0; i < size; i++) { bytes[pos + i] = Number(n & 255n); n >>= 8n; } };
    const reference = (pos, target) => write(pos, target - pos);
    const table = (slots) => {
        align(); const vtable = reserve(4 + slots.length * 2); align(); const pos = reserve(8 + slots.length * 8);
        write(vtable, 4 + slots.length * 2, 2); write(vtable + 2, 8 + slots.length * 8, 2); write(pos, pos - vtable);
        return slots.map((present, i) => { if (present) write(vtable + 4 + i * 2, 8 + i * 8, 2); return pos + 8 + i * 8; }).concat(pos);
    };
    const string = (text) => { align(4); const data = new TextEncoder().encode(text); const pos = reserve(4); write(pos, data.length); bytes.push(...data, 0); return pos; };
    const vector = (values) => { align(4); const pos = reserve(4 + values.length * 4); write(pos, values.length); values.forEach((v, i) => write(pos + 4 + i * 4, v)); return pos; };
    const refs = (count) => { align(4); const pos = reserve(4 + count * 4); write(pos, count); return { pos, at: (i, target) => reference(pos + 4 + i * 4, target) }; };
    const model = table([true, true, true, true, true]); write(0, model.at(-1)); bytes.splice(4, 4, 84, 70, 76, 51); write(model[0], 3);
    const codes = refs(7); reference(model[1], codes.pos);
    const op = schema.BuiltinOperator;
    [op.RESHAPE, op.TRANSPOSE, op.ADD, op.QUANTIZE, op.MUL, op.FULLY_CONNECTED, op.BATCH_MATMUL].forEach((code, i) => { const t = table([true, false, true, true]); codes.at(i, t.at(-1)); write(t[0], code, 1); write(t[2], 1); write(t[3], code); });
    const graphs = refs(graphCount); reference(model[2], graphs.pos);
    for (let g = 0; g < graphCount; g++) {
        const sg = table([true, true, true, true, true]); graphs.at(g, sg.at(-1));
        const count = variant === 'lora' ? brokenJoin ? 9 : 8 : repeats * 3 + 4;
        const tensors = refs(count); reference(sg[0], tensors.pos);
        for (let i = 0; i < count; i++) {
            const quantized = i === count - 2;
            const t = table([true, true, true, true, quantized]); tensors.at(i, t.at(-1));
            reference(t[0], vector([1, 2])); write(t[1], quantized ? 9 : 0, 1); write(t[2], i === count - 1 ? 1 : 0);
            reference(t[3], string(i === count - 1 ? 'unused_weights' : `block_${g}/tensor_${i}`));
            if (quantized) {
                const q = table([false, false, true, true, false, false, true]); reference(t[4], q.at(-1));
                const scale = vector([0]); reference(q[2], scale); const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, 0.25, true); new Uint8Array(b).forEach((v, j) => bytes[scale + 4 + j] = v);
                align(8); reserve(4); const zero = reserve(12); write(zero, 1); write(zero + 4, 3, 8); reference(q[3], zero); write(q[6], 1);
            }
        }
        const operations = variant === 'lora' ? [
            [4, [0], [1]], [5, [1], [2]], [6, [1], [3]], [6, [3], [4]], [2, brokenJoin ? [2, 0] : [2, 4], [5]],
            ...(brokenJoin ? [[2, [4, 0], [6]]] : [])
        ] : Array.from({length: repeats * 3 + 1}, (_, n) => [n === repeats * 3 ? 2 : n % 3 === 1 ? 1 : 0, n === repeats * 3 ? [2, 0] : [n], [n + 1]]);
        reference(sg[1], vector([0])); reference(sg[2], vector([variant === 'lora' ? 5 : repeats * 3]));
        const ops = refs(operations.length); reference(sg[3], ops.pos);
        for (let n = 0; n < operations.length; n++) {
            const op = table([true, true, true]); ops.at(n, op.at(-1)); write(op[0], operations[n][0]);
            reference(op[1], vector(operations[n][1])); reference(op[2], vector(operations[n][2]));
        }
        reference(sg[4], string(`測試圖 ${g}`));
    }
    reference(model[3], string('Synthetic TFLite fixture; not a trained model.'));
    const buffers = refs(2); reference(model[4], buffers.pos);
    const empty = table([]); buffers.at(0, empty.at(-1));
    const weight = table([true, false, false]); buffers.at(1, weight.at(-1));
    align(4); const payload = reserve(4); write(payload, weightBytes); reference(weight[0], payload);
    const data = Uint8Array.from(bytes);
    return { data, totalBytes: data.length + weightBytes, payloadOffset: data.length };
}
