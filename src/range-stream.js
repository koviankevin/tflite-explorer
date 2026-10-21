// Synchronous range access is confined to the dedicated model worker.
export class RangeStream {
    constructor(readAt, length, offset = 0, stats = { bytesRead: 0, reads: 0 }, storage = null) {
        this.readAt = readAt;
        this.length = length;
        this.offset = offset;
        this.position = 0;
        this.stats = stats;
        this.storage = storage || { cache: new Map(), length };
    }
    seek(position) {
        position = position < 0 ? this.length + position : position;
        if (!Number.isSafeInteger(position) || position < 0 || position > this.length) throw new Error('檔案位置超出範圍。');
        this.position = position;
    }
    skip(length) { this.seek(this.position + length); }
    peek(length = this.length - this.position) {
        if (!Number.isSafeInteger(length) || length < 0 || this.position + length > this.length) throw new Error('檔案不完整，讀取範圍超出檔案大小。');
        if (length > 64 * 1024 * 1024) throw new Error('單次讀取超過 64 MiB；請使用局部資料預覽。');
        if (!length) return new Uint8Array(0);
        const pageSize = 64 * 1024;
        const begin = this.offset + this.position;
        const end = begin + length;
        const getPage = (pageOffset) => {
            let page = this.storage.cache.get(pageOffset);
            if (!page) {
                const count = Math.min(pageSize, this.storage.length - pageOffset);
                page = this.readAt(pageOffset, count);
                if (page.length !== count) throw new Error('檔案讀取長度不完整。');
                this.stats.bytesRead += count;
                this.stats.reads++;
            }
            this.storage.cache.delete(pageOffset);
            this.storage.cache.set(pageOffset, page);
            if (this.storage.cache.size > 128) this.storage.cache.delete(this.storage.cache.keys().next().value);
            return page;
        };
        const first = Math.floor(begin / pageSize) * pageSize;
        if (end <= first + pageSize) return getPage(first).subarray(begin - first, end - first);
        const result = new Uint8Array(length);
        for (let offset = begin; offset < end;) {
            const pageOffset = Math.floor(offset / pageSize) * pageSize;
            const page = getPage(pageOffset);
            const start = offset - pageOffset;
            const count = Math.min(page.length - start, end - offset);
            result.set(page.subarray(start, start + count), offset - begin);
            offset += count;
        }
        return result;
    }
    read(length) { const bytes = this.peek(length); this.position += bytes.length; return bytes; }
    stream(length) {
        if (!Number.isSafeInteger(length) || length < 0 || this.position + length > this.length) throw new Error('Tensor 資料範圍無效。');
        const child = new RangeStream(this.readAt, length, this.offset + this.position, this.stats, this.storage);
        this.position += length;
        return child;
    }
}
