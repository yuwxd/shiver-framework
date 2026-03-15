class BatchProcessor {
    constructor(processor, opts = {}) {
        this._processor = processor;
        this._maxBatchSize = opts.maxBatchSize ?? 100;
        this._maxWaitMs = opts.maxWaitMs ?? 50;
        this._queue = [];
        this._timer = null;
        this._processing = false;
        this._concurrency = opts.concurrency ?? 1;
        this._activeCount = 0;
        this._onError = opts.onError ?? null;
    }

    add(item) {
        return new Promise((resolve, reject) => {
            this._queue.push({ item, resolve, reject });
            if (this._queue.length >= this._maxBatchSize) {
                this._flush();
            } else if (!this._timer) {
                this._timer = setTimeout(() => this._flush(), this._maxWaitMs);
            }
        });
    }

    addMany(items) {
        return Promise.all(items.map(item => this.add(item)));
    }

    async _flush() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._queue.length === 0) return;
        if (this._activeCount >= this._concurrency) return;

        const batch = this._queue.splice(0, this._maxBatchSize);
        this._activeCount++;

        try {
            const items = batch.map(b => b.item);
            const results = await this._processor(items);
            if (Array.isArray(results)) {
                batch.forEach((b, i) => b.resolve(results[i]));
            } else {
                batch.forEach(b => b.resolve(results));
            }
        } catch (e) {
            if (this._onError) this._onError(e, batch.map(b => b.item));
            batch.forEach(b => b.reject(e));
        } finally {
            this._activeCount--;
            if (this._queue.length > 0) {
                setImmediate(() => this._flush());
            }
        }
    }

    async flush() {
        while (this._queue.length > 0) {
            await this._flush();
        }
    }

    get queueSize() { return this._queue.length; }
    get isProcessing() { return this._activeCount > 0; }

    destroy() {
        if (this._timer) clearTimeout(this._timer);
        this._queue.forEach(b => b.reject(new Error('BatchProcessor destroyed')));
        this._queue = [];
    }
}

module.exports = { BatchProcessor };
