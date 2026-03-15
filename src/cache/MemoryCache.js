class MemoryCache {
    constructor(options = {}) {
        this._maxSize = options.maxSize ?? 1000;
        this._ttlMs = options.ttlMs ?? null;
        this._store = new Map();
        this._timers = new Map();
    }

    set(key, value, ttlMs) {
        if (this._store.size >= this._maxSize && !this._store.has(key)) {
            const firstKey = this._store.keys().next().value;
            this._evict(firstKey);
        }

        if (this._timers.has(key)) {
            clearTimeout(this._timers.get(key));
            this._timers.delete(key);
        }

        const expiry = ttlMs ?? this._ttlMs;
        this._store.set(key, { value, expiresAt: expiry ? Date.now() + expiry : null });

        if (expiry) {
            const timer = setTimeout(() => this._evict(key), expiry);
            if (timer.unref) timer.unref();
            this._timers.set(key, timer);
        }

        return this;
    }

    get(key) {
        const entry = this._store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this._evict(key);
            return undefined;
        }
        return entry.value;
    }

    has(key) {
        return this.get(key) !== undefined;
    }

    delete(key) {
        this._evict(key);
        return this;
    }

    _evict(key) {
        this._store.delete(key);
        if (this._timers.has(key)) {
            clearTimeout(this._timers.get(key));
            this._timers.delete(key);
        }
    }

    clear() {
        for (const timer of this._timers.values()) clearTimeout(timer);
        this._timers.clear();
        this._store.clear();
        return this;
    }

    get size() {
        return this._store.size;
    }
}

module.exports = { MemoryCache };
