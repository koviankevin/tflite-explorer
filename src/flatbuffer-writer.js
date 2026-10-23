import { tflite as schema } from '../vendor/netron/tflite-schema.js?v=505c5538ae9ba327';

// The pinned generated decoder is the schema authority. Interpret its field
// declarations, never execute generated source or infer field types from values.
const descriptors = new Map();
export function tableFields(name) {
    if (descriptors.has(name)) return descriptors.get(name);
    const source = schema[name]?.decode?.toString();
    if (!source || !source.includes(`new tflite.${name}()`)) throw new Error(`不支援的 TFLite table：${name}`);
    const fields = [...source.matchAll(/\$\.(\w+) = reader\.(\w+)\(position, (\d+)(?:, ([^;]+))?\);/g)].map(([, key, kind, slot, args]) => ({ key, kind, slot: Number(slot), args }));
    if ((source.match(/\$\.\w+ = /g) || []).length !== fields.length) throw new Error(`TFLite schema ${name} 有無法編碼的欄位。`);
    descriptors.set(name, fields);
    return fields;
}

const scalar = { bool_: ['setUint8', 1], int8_: ['setInt8', 1], int32_: ['setInt32', 4], uint32_: ['setUint32', 4], int64_: ['setBigInt64', 8], uint64_: ['setBigUint64', 8], float32_: ['setFloat32', 4] };
const vectors = { Int8Array: ['setInt8', 1], Uint8Array: ['setUint8', 1], Int16Array: ['setInt16', 2], Uint16Array: ['setUint16', 2], Int32Array: ['setInt32', 4], Uint32Array: ['setUint32', 4], Float32Array: ['setFloat32', 4], Float64Array: ['setFloat64', 8], int64s_: ['setBigInt64', 8], bools_: ['setUint8', 1] };

export class FlatbufferWriter {
    constructor() { this.bytes = new Uint8Array(65536); this.length = 8; this.external = []; }
    reserve(count, alignment = 8, bias = 0) {
        const start = this.length + (alignment - (this.length + bias) % alignment) % alignment;
        const end = start + count;
        if (end > 64 * 1024 * 1024) throw new Error('匯出結構超過 64 MiB，請縮小選取範圍。');
        if (end > this.bytes.length) { const grown = new Uint8Array(Math.max(end, this.bytes.length * 2)); grown.set(this.bytes); this.bytes = grown; }
        this.length = end;
        return start;
    }
    write(position, value, method = 'setUint32') {
        new DataView(this.bytes.buffer)[method](position, method.includes('Big') ? BigInt(value) : Number(value), true);
    }
    ref(position, target) { if (target <= position) throw new Error('FlatBuffer offset 無效。'); this.write(position, target - position); }
    vector(values, type) {
        const [method, width] = vectors[type] || [];
        if (!method) throw new Error(`不支援的 vector：${type}`);
        const pos = this.reserve(4 + values.length * width, Math.max(4, width), 4);
        this.write(pos, values.length);
        values.forEach((value, i) => this.write(pos + 4 + i * width, value, method));
        return pos;
    }
    string(value) {
        const bytes = new TextEncoder().encode(value);
        const pos = this.reserve(5 + bytes.length, 4);
        this.write(pos, bytes.length); this.bytes.set(bytes, pos + 4);
        return pos;
    }
    table(value, name = value.constructor.name) {
        // Buffer.decode is replaced by the lazy reader; its original three fields are fixed.
        const fields = name === 'Buffer' ? [{key:'data',kind:'array',slot:4,args:'Uint8Array'}, {key:'offset',kind:'uint64_',slot:6}, {key:'size',kind:'uint64_',slot:8}] : tableFields(name);
        const slots = Math.max(0, ...fields.map((field) => (field.slot - 4) / 2 + (field.kind === 'union' ? 2 : 1)));
        const vt = this.reserve(4 + slots * 2, 2);
        const pos = this.reserve(8 + slots * 8);
        this.write(vt, 4 + slots * 2, 'setUint16'); this.write(vt + 2, 8 + slots * 8, 'setUint16'); this.write(pos, pos - vt, 'setInt32');
        const at = (slot) => pos + 8 + (slot - 4) / 2 * 8;
        const present = (slot) => this.write(vt + slot, at(slot) - pos, 'setUint16');
        for (const field of fields) {
            const item = value[field.key];
            if (item === null || item === undefined) continue;
            const { kind, slot, args } = field;
            if (scalar[kind]) { present(slot); this.write(at(slot), item, scalar[kind][0]); }
            else if (kind === 'union') {
                const union = schema[args.replace('tflite.', '')];
                const cases = [...union.decode.toString().matchAll(/case (\d+): return tflite\.(\w+)\.decode/g)];
                const match = cases.find(([, , type]) => item instanceof schema[type]);
                if (!match) throw new Error(`不支援的 union：${args}`);
                present(slot); present(slot + 2); this.write(at(slot), Number(match[1]), 'setUint8'); this.ref(at(slot + 2), this.table(item, match[2]));
            } else if (kind === 'string_') { present(slot); this.ref(at(slot), this.string(item)); }
            else if (kind === 'table') { present(slot); this.ref(at(slot), this.table(item, args.replace('tflite.', ''))); }
            else if (kind === 'tables' || kind === 'strings_') {
                present(slot); const vector = this.reserve(4 + item.length * 4, 4); this.write(vector, item.length); this.ref(at(slot), vector);
                item.forEach((v, i) => this.ref(vector + 4 + i * 4, kind === 'tables' ? this.table(v, args.replace('tflite.', '')) : this.string(v)));
            } else if (kind === 'array' || vectors[kind]) { present(slot); this.ref(at(slot), this.vector(item, kind === 'array' ? args : kind)); }
            else throw new Error(`不支援的 TFLite 欄位：${name}.${field.key}`);
        }
        if (value.sourceRange) this.external.push({ offsetAt: at(6), sizeAt: at(8), ...value.sourceRange });
        for (const range of value.externalRanges || []) {
            const offset = fields.find((field) => field.key === range.offsetKey && field.kind === 'uint64_');
            const size = fields.find((field) => field.key === range.sizeKey && field.kind === 'uint64_');
            if (!offset || !size) throw new Error('外部資料範圍沒有對應的 offset／size 欄位。');
            present(offset.slot); present(size.slot);
            this.external.push({ offsetAt: at(offset.slot), sizeAt: at(size.slot), offset: range.offset, size: range.size });
        }
        return pos;
    }
    finish(model, file) {
        const root = this.table(model, 'Model'); this.write(0, root); this.bytes.set([84, 70, 76, 51], 4);
        let offset = this.length;
        const parts = [];
        for (const range of this.external) {
            if (!Number.isSafeInteger(range.offset) || !Number.isSafeInteger(range.size) || range.offset < 0 || range.size < 0 || range.offset > file.size - range.size) throw new Error('外部資料範圍超出來源檔案。');
            const padding = (16 - offset % 16) % 16;
            parts.push(new Uint8Array(padding), file.slice(range.offset, range.offset + range.size)); offset += padding;
            this.write(range.offsetAt, offset, 'setBigUint64'); this.write(range.sizeAt, range.size, 'setBigUint64'); offset += range.size;
        }
        return new Blob([this.bytes.slice(0, this.length), ...parts], { type: 'application/octet-stream' });
    }
}
