class CacheManager {
    constructor(opts = {}) {
        this._primary = opts.primary ?? null;
        this._fallback = opts.fallback ?? null;
        this._namespaces = new Map();
        this._defaultTtl = opts.defaultTtl ?? null;
        this._stats = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0, fallbacks: 0, lazyLoads: 0, mirrored: 0, warmed: 0 };
        this._warmupFns = new Map();
        this._invalidationPatterns = new Map();
        this._webhooks = [];
        this._autoCacheBound = false;
        this._autoCacheState = { guilds: 0, users: 0, members: 0 };
    }

    setNamespaceTtl(namespace, ttlMs) {
        const config = this._namespaces.get(namespace) ?? {};
        config.ttl = ttlMs;
        this._namespaces.set(namespace, config);
        return this;
    }

    setNamespaceConfig(namespace, config) {
        this._namespaces.set(namespace, { ...this._namespaces.get(namespace), ...config });
        return this;
    }

    _getTtl(namespace, ttlMs) {
        if (ttlMs !== undefined) return ttlMs;
        const nsConfig = this._namespaces.get(namespace);
        if (nsConfig?.ttl !== undefined) return nsConfig.ttl;
        return this._defaultTtl;
    }

    async get(namespace, key) {
        const adapter = this._primary ?? this._fallback;
        if (!adapter) return null;

        try {
            const value = await adapter.get(namespace, key);
            if (value !== null && value !== undefined) {
                this._stats.hits++;
                return value;
            }
        } catch (err) {
            this._stats.errors++;
            if (this._fallback && this._primary) {
                try {
                    const fallbackValue = await this._fallback.get(namespace, key);
                    if (fallbackValue !== null && fallbackValue !== undefined) {
                        this._stats.hits++;
                        this._stats.fallbacks++;
                        return fallbackValue;
                    }
                } catch (_) {}
            }
        }

        this._stats.misses++;
        return null;
    }

    async set(namespace, key, value, ttlMs) {
        const effectiveTtl = this._getTtl(namespace, ttlMs);
        this._stats.sets++;

        const setToAdapter = async (adapter) => {
            if (!adapter) return;
            try {
                await adapter.set(namespace, key, value, effectiveTtl);
            } catch (err) {
                this._stats.errors++;
            }
        };

        await setToAdapter(this._primary);
        if (this._fallback && this._primary) await setToAdapter(this._fallback);
        await this._mirror('set', { namespace, key, ttlMs: effectiveTtl });
    }

    async delete(namespace, key) {
        this._stats.deletes++;
        const deleteFromAdapter = async (adapter) => {
            if (!adapter) return;
            try { await adapter.delete(namespace, key); } catch (_) {}
        };
        await deleteFromAdapter(this._primary);
        if (this._fallback && this._primary) await deleteFromAdapter(this._fallback);
        await this._mirror('delete', { namespace, key });
    }

    async has(namespace, key) {
        const adapter = this._primary ?? this._fallback;
        if (!adapter) return false;
        try { return await adapter.has(namespace, key); } catch (_) { return false; }
    }

    async getOrSet(namespace, key, factory, ttlMs) {
        const existing = await this.get(namespace, key);
        if (existing !== null) return existing;
        this._stats.lazyLoads++;
        const value = typeof factory === 'function' ? await factory() : factory;
        await this.set(namespace, key, value, ttlMs);
        return value;
    }

    async lazy(namespace, key, factory, ttlMs) {
        return this.getOrSet(namespace, key, factory, ttlMs);
    }

    async invalidate(namespace, pattern) {
        const adapters = [this._primary, this._fallback].filter(Boolean);
        for (const adapter of adapters) {
            try {
                if (adapter.deletePattern) {
                    await adapter.deletePattern(`${namespace}:${pattern}`);
                } else {
                    const keys = await adapter.keys(namespace).catch(() => []);
                    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                    for (const key of keys) {
                        if (regex.test(key)) await adapter.delete(namespace, key).catch(() => {});
                    }
                }
            } catch (_) {}
        }
    }

    async invalidateNamespace(namespace) {
        const adapters = [this._primary, this._fallback].filter(Boolean);
        for (const adapter of adapters) {
            try { await adapter.clear(namespace); } catch (_) {}
        }
    }

    registerWarmup(namespace, key, factory, ttlMs) {
        this._warmupFns.set(`${namespace}:${key}`, { namespace, key, factory, ttlMs });
        return this;
    }

    async warm() {
        const results = { loaded: 0, failed: 0 };
        for (const [, { namespace, key, factory, ttlMs }] of this._warmupFns) {
            try {
                const value = await factory();
                await this.set(namespace, key, value, ttlMs);
                results.loaded++;
                this._stats.warmed++;
            } catch (_) {
                results.failed++;
            }
        }
        return results;
    }

    async warmNamespace(namespace, entries = {}, ttlMs) {
        let loaded = 0;
        for (const [key, value] of Object.entries(entries)) {
            await this.set(namespace, key, value, ttlMs);
            loaded++;
            this._stats.warmed++;
        }
        return { namespace, loaded };
    }

    mirrorTo(webhook) {
        if (!webhook) return this;
        if (typeof webhook === 'string') {
            try {
                const { WebhookClient } = require('discord.js');
                this._webhooks.push(new WebhookClient({ url: webhook }));
            } catch (_) {}
            return this;
        }
        if (typeof webhook?.send === 'function') this._webhooks.push(webhook);
        return this;
    }

    async _mirror(action, payload) {
        if (this._webhooks.length === 0) return;
        this._stats.mirrored++;
        await Promise.all(this._webhooks.map(webhook => webhook.send({
            content: `\`cache.${action}\` ${JSON.stringify(payload).slice(0, 1800)}`
        }).catch(() => {})));
    }

    autoCache(client, opts = {}) {
        if (!client?.on || this._autoCacheBound) return this;
        this._autoCacheBound = true;
        const cacheMembers = opts.members !== false;

        client.on('guildCreate', async (guild) => {
            this._autoCacheState.guilds++;
            await this.set('discord.guilds', guild.id, {
                id: guild.id,
                name: guild.name,
                memberCount: guild.memberCount ?? 0
            }, opts.guildTtlMs);
        });

        client.on('guildDelete', async (guild) => {
            await this.delete('discord.guilds', guild.id);
        });

        client.on('userUpdate', async (_, user) => {
            this._autoCacheState.users++;
            await this.set('discord.users', user.id, {
                id: user.id,
                username: user.username,
                bot: user.bot ?? false
            }, opts.userTtlMs);
        });

        if (cacheMembers) {
            client.on('guildMemberAdd', async (member) => {
                this._autoCacheState.members++;
                await this.set('discord.members', `${member.guild.id}:${member.id}`, {
                    id: member.id,
                    guildId: member.guild.id,
                    username: member.user?.username ?? null
                }, opts.memberTtlMs);
            });
        }

        return this;
    }

    getStats() {
        const total = this._stats.hits + this._stats.misses;
        return {
            ...this._stats,
            hitRate: total > 0 ? (this._stats.hits / total) : 0,
            missRate: total > 0 ? (this._stats.misses / total) : 0,
            hasPrimary: !!this._primary,
            hasFallback: !!this._fallback,
            namespaces: [...this._namespaces.keys()],
            webhookMirrors: this._webhooks.length,
            autoCache: { ...this._autoCacheState }
        };
    }

    resetStats() {
        this._stats = { hits: 0, misses: 0, sets: 0, deletes: 0, errors: 0, fallbacks: 0, lazyLoads: 0, mirrored: 0, warmed: 0 };
    }

    async getMany(namespace, keys) {
        const result = {};
        await Promise.all(keys.map(async (k) => {
            result[k] = await this.get(namespace, k);
        }));
        return result;
    }

    async setMany(namespace, entries, ttlMs) {
        await Promise.all(
            Object.entries(entries).map(([k, v]) => this.set(namespace, k, v, ttlMs))
        );
    }
}

module.exports = { CacheManager };
