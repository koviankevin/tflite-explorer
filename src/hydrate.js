export function hydrate(root, file) {
    const seen = new WeakSet();
    const visit = (value) => {
        if (!value || typeof value !== 'object' || seen.has(value)) return value;
        seen.add(value);
        if (ArrayBuffer.isView(value)) return value;
        for (const key of Object.keys(value)) visit(value[key]);
        if (Array.isArray(value.dimensions)) Object.defineProperty(value, 'toString', { value() { return this.dimensions.length ? `[${this.dimensions.join(',')}]` : ''; } });
        if (value.dataType && value.shape) Object.defineProperty(value, 'toString', { value() { return this.dataType + this.shape.toString(); } });
        if ('_data' in value && value.encoding && value.type) {
            let data;
            let reading;
            const range = value._data;
            Object.defineProperties(value, {
                values: { get() { return data || null; } },
                peek: { value: () => !!data },
                read: { value: async () => {
                    if (data) return;
                    if (reading) return reading;
                    reading = (async () => {
                        if (range?.__range) {
                            if (range.length > 16 * 1024 * 1024) throw new Error(`這個權重有 ${(range.length / 1048576).toFixed(1)} MiB；本版保留完整 metadata，但暫不展開超過 16 MiB 的數值，以避免頁面耗盡記憶體。`);
                            data = new Uint8Array(await file.slice(range.offset, range.offset + range.length).arrayBuffer());
                        } else data = range instanceof Uint8Array ? range : new Uint8Array(0);
                        if (value.type.dataType === 'string') {
                            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
                            if (data.length < 4) throw new Error('字串 tensor 資料不完整。');
                            const count = view.getInt32(0, true);
                            if (count < 0 || count > (data.length - 4) / 4) throw new Error('字串 tensor 的索引無效。');
                            const offsets = Array.from({ length: count }, (_, i) => view.getInt32(4 + i * 4, true)).concat(data.length);
                            const raw = data;
                            data = offsets.slice(0, -1).map((start, i) => {
                                if (start < 4 + count * 4 || start > offsets[i + 1] || offsets[i + 1] > raw.length) throw new Error('字串 tensor 的範圍無效。');
                                return new TextDecoder().decode(raw.subarray(start, offsets[i + 1]));
                            });
                        }
                    })();
                    try { await reading; } catch (error) { data = null; reading = null; throw error; }
                } }
            });
        }
        return value;
    };
    return visit(root);
}
