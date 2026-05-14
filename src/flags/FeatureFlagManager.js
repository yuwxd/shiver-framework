class FeatureFlagManager {
    constructor(storage, opts = {}) {
        this._storage = storage;
        this._definitions = new Map();
        this._ns = opts.namespace ?? 'feature_flags';
    }

    define(name, opts = {}) {
        this._definitions.set(name, {
            default: opts.default ?? false,
            description: opts.description ?? ''
        });
        return this;
    }

    async isEnabled(name, scope = {}) {
        const def = this._definitions.get(name);
        const defaultVal = def?.default ?? false;

        if (this._storage) {
            const { userId, guildId, channelId } = scope;
            if (userId) {
                const val = await this._storage.get(this._ns, `user:${userId}:${name}`);
                if (val !== null && val !== undefined) return Boolean(val);
            }
            if (guildId) {
                const val = await this._storage.get(this._ns, `guild:${guildId}:${name}`);
                if (val !== null && val !== undefined) return Boolean(val);
            }
            if (channelId) {
                const val = await this._storage.get(this._ns, `channel:${channelId}:${name}`);
                if (val !== null && val !== undefined) return Boolean(val);
            }
            const global = await this._storage.get(this._ns, `global:${name}`);
            if (global !== null && global !== undefined) return Boolean(global);
        }

        return defaultVal;
    }

    async enable(name, scope = {}) {
        return this._set(name, true, scope);
    }

    async disable(name, scope = {}) {
        return this._set(name, false, scope);
    }

    async toggle(name, scope = {}) {
        const current = await this.isEnabled(name, scope);
        return this._set(name, !current, scope);
    }

    async _set(name, value, scope) {
        if (!this._storage) return;
        const { userId, guildId, channelId } = scope;
        const key = userId ? `user:${userId}:${name}`
            : guildId ? `guild:${guildId}:${name}`
            : channelId ? `channel:${channelId}:${name}`
            : `global:${name}`;
        await this._storage.set(this._ns, key, value);
    }

    async getAll(scope = {}) {
        const result = {};
        for (const name of this._definitions.keys()) {
            result[name] = await this.isEnabled(name, scope);
        }
        return result;
    }

    getDefinitions() {
        return Object.fromEntries(
            [...this._definitions.entries()].map(([k, v]) => [k, { ...v }])
        );
    }
}

module.exports = { FeatureFlagManager };
