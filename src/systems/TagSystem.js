class TagSystem {
    constructor(storage, opts = {}) {
        this._storage = storage;
        this._ns = opts.namespace ?? 'tags';
    }

    async create(guildId, name, content, userId) {
        const key = `${guildId}:${name.toLowerCase()}`;
        const existing = await this._storage.get(this._ns, key);
        if (existing) return { ok: false, reason: 'already_exists' };
        await this._storage.set(this._ns, key, { name: name.toLowerCase(), content, createdBy: userId, createdAt: Date.now(), uses: 0 });
        return { ok: true };
    }

    async get(guildId, name) {
        const key = `${guildId}:${name.toLowerCase()}`;
        return this._storage.get(this._ns, key);
    }

    async use(guildId, name, vars = {}) {
        const tag = await this.get(guildId, name);
        if (!tag) return null;
        tag.uses++;
        await this._storage.set(this._ns, `${guildId}:${name.toLowerCase()}`, tag);
        return this._interpolate(tag.content, vars);
    }

    async update(guildId, name, content) {
        const key = `${guildId}:${name.toLowerCase()}`;
        const tag = await this._storage.get(this._ns, key);
        if (!tag) return { ok: false, reason: 'not_found' };
        tag.content = content;
        tag.updatedAt = Date.now();
        await this._storage.set(this._ns, key, tag);
        return { ok: true };
    }

    async delete(guildId, name) {
        const key = `${guildId}:${name.toLowerCase()}`;
        const exists = await this._storage.get(this._ns, key);
        if (!exists) return false;
        await this._storage.delete(this._ns, key);
        return true;
    }

    async list(guildId) {
        const keys = await this._storage.keys(this._ns);
        const prefix = `${guildId}:`;
        const tags = [];
        for (const key of keys.filter(k => k.startsWith(prefix))) {
            const tag = await this._storage.get(this._ns, key);
            if (tag) tags.push(tag);
        }
        return tags.sort((a, b) => a.name.localeCompare(b.name));
    }

    async search(guildId, query) {
        const all = await this.list(guildId);
        const q = query.toLowerCase();
        return all.filter(t => t.name.includes(q) || t.content.toLowerCase().includes(q));
    }

    _interpolate(content, vars) {
        return content.replace(/\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? String(vars[key]) : `{${key}}`);
    }
}

module.exports = { TagSystem };
