class RequestDeduplicator {
    constructor(opts = {}) {
        this._pending = new Map();
        this._cache = new Map();
        this._ttlMs = opts.ttlMs ?? 500;
    }

    async run(key, asyncFn) {
        const cached = this._cache.get(key);
        if (cached && Date.now() < cached.expiresAt) return cached.value;

        if (this._pending.has(key)) return this._pending.get(key);

        const promise = asyncFn().then(value => {
            this._pending.delete(key);
            if (this._ttlMs > 0) {
                this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
            }
            return value;
        }).catch(err => {
            this._pending.delete(key);
            throw err;
        });

        this._pending.set(key, promise);
        return promise;
    }

    invalidate(key) {
        this._cache.delete(key);
    }

    clear() {
        this._pending.clear();
        this._cache.clear();
    }
}

module.exports = { RequestDeduplicator };
