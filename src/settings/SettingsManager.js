class SettingsManager {
    constructor(storage, options = {}) {
        this._storage = storage;
        this._ttlMs = options.settingsTTLMs ?? 60000;
        this._maxSize = options.settingsMaxSize ?? 1000;
        this._cache = new Map();
        this._defaults = options.defaults ?? {};
        this._prefixDefault = options.defaultPrefix ?? ',';
    }

    _cacheKey(namespace, id) {
        return `${namespace}:${id}`;
    }

    _getCached(key) {
        const entry = this._cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.ts > this._ttlMs) {
            this._cache.delete(key);
            return null;
        }
        return entry.value;
    }

    _setCached(key, value) {
        if (this._cache.size >= this._maxSize) {
            const firstKey = this._cache.keys().next().value;
            this._cache.delete(firstKey);
        }
        this._cache.set(key, { value, ts: Date.now() });
    }

    async getGuild(guildId) {
        const key = this._cacheKey('guild', guildId);
        const cached = this._getCached(key);
        if (cached !== null) return cached;
        const data = {
            ...(this._defaults.guild ?? {}),
            ...((await this._storage.get('guild', guildId)) ?? {})
        };
        this._setCached(key, data);
        return data;
    }

    async setGuild(guildId, data) {
        const key = this._cacheKey('guild', guildId);
        await this._storage.set('guild', guildId, data);
        this._setCached(key, data);
    }

    async getUser(userId) {
        const key = this._cacheKey('user', userId);
        const cached = this._getCached(key);
        if (cached !== null) return cached;
        const data = {
            ...(this._defaults.user ?? {}),
            ...((await this._storage.get('user', userId)) ?? {})
        };
        this._setCached(key, data);
        return data;
    }

    async setUser(userId, data) {
        const key = this._cacheKey('user', userId);
        await this._storage.set('user', userId, data);
        this._setCached(key, data);
    }

    async patchGuild(guildId, patch) {
        const current = await this.getGuild(guildId);
        const next = {
            ...current,
            ...(typeof patch === 'function' ? await patch(current) : patch)
        };
        await this.setGuild(guildId, next);
        return next;
    }

    async patchUser(userId, patch) {
        const current = await this.getUser(userId);
        const next = {
            ...current,
            ...(typeof patch === 'function' ? await patch(current) : patch)
        };
        await this.setUser(userId, next);
        return next;
    }

    async getGuildPrefix(guildId, fallback = this._prefixDefault) {
        if (!guildId) return fallback;
        const guild = await this.getGuild(guildId);
        const prefix = guild?.prefix;
        if (typeof prefix !== 'string') return fallback;
        const normalized = prefix.trim();
        if (!normalized || normalized === '/') return fallback;
        return normalized;
    }

    async setGuildPrefix(guildId, prefix) {
        const normalized = String(prefix ?? '').trim();
        if (!guildId) throw new Error('guildId is required');
        if (!normalized) throw new Error('Prefix cannot be empty');
        if (normalized === '/') throw new Error('Slash cannot be used as a custom prefix');
        if (/\s/.test(normalized)) throw new Error('Prefix cannot contain whitespace');
        return this.patchGuild(guildId, { prefix: normalized });
    }

    async resetGuildPrefix(guildId) {
        if (!guildId) throw new Error('guildId is required');
        return this.patchGuild(guildId, { prefix: this._prefixDefault });
    }

    invalidate(namespace, id) {
        this._cache.delete(this._cacheKey(namespace, id));
    }

    clearCache() {
        this._cache.clear();
    }
}

module.exports = { SettingsManager };
