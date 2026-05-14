class UserSessionStore {
    constructor(opts = {}) {
        this._ttlMs = opts.ttlMs ?? 300000;
        this._store = new Map();
        this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    }

    _entry(userId) {
        let entry = this._store.get(userId);
        if (!entry) {
            entry = { data: {}, expiresAt: Date.now() + this._ttlMs };
            this._store.set(userId, entry);
        }
        return entry;
    }

    _isExpired(entry) {
        return Date.now() > entry.expiresAt;
    }

    get(userId, key) {
        const entry = this._store.get(userId);
        if (!entry || this._isExpired(entry)) return undefined;
        return entry.data[key];
    }

    set(userId, key, value, ttl) {
        const entry = this._entry(userId);
        entry.data[key] = value;
        entry.expiresAt = Date.now() + (ttl ?? this._ttlMs);
        return this;
    }

    has(userId, key) {
        const entry = this._store.get(userId);
        if (!entry || this._isExpired(entry)) return false;
        return Object.prototype.hasOwnProperty.call(entry.data, key);
    }

    delete(userId, key) {
        const entry = this._store.get(userId);
        if (!entry) return;
        if (key === undefined) {
            this._store.delete(userId);
        } else {
            delete entry.data[key];
        }
    }

    getAll(userId) {
        const entry = this._store.get(userId);
        if (!entry || this._isExpired(entry)) return {};
        return { ...entry.data };
    }

    clear(userId) {
        if (userId) {
            this._store.delete(userId);
        } else {
            this._store.clear();
        }
    }

    touch(userId, ttl) {
        const entry = this._store.get(userId);
        if (entry) entry.expiresAt = Date.now() + (ttl ?? this._ttlMs);
    }

    _cleanup() {
        const now = Date.now();
        for (const [userId, entry] of this._store) {
            if (now > entry.expiresAt) this._store.delete(userId);
        }
    }

    destroy() {
        clearInterval(this._cleanupInterval);
        this._store.clear();
    }
}

module.exports = { UserSessionStore };
