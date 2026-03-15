const { ShardingManager } = require('discord.js');
const { calculateShardCount } = require('../optimizations/GatewayOptimizer');

class ShardManager {
    constructor(scriptPath, opts = {}) {
        this._scriptPath = scriptPath;
        this._token = opts.token ?? process.env.DISCORD_TOKEN;
        this._guildsPerShard = opts.guildsPerShard ?? 1000;
        this._mode = opts.mode ?? 'process';
        this._respawn = opts.respawn !== false;
        this._stats = new Map();
        this._manager = null;
    }

    create(opts = {}) {
        this._manager = new ShardingManager(this._scriptPath, {
            token: opts.token ?? this._token,
            totalShards: opts.totalShards ?? 'auto',
            shardList: opts.shardList ?? 'auto',
            mode: opts.mode ?? this._mode,
            respawn: opts.respawn ?? this._respawn,
            ...opts.extra
        });

        this._manager.on('shardCreate', (shard) => {
            this._stats.set(shard.id, {
                id: shard.id,
                status: 'launching',
                launchedAt: Date.now(),
                guilds: 0,
                ping: null,
                memory: null
            });

            shard.on('ready', () => this._updateShard(shard.id, { status: 'ready' }));
            shard.on('disconnect', () => this._updateShard(shard.id, { status: 'disconnect' }));
            shard.on('death', () => this._updateShard(shard.id, { status: 'dead' }));
            shard.on('error', (error) => this._updateShard(shard.id, { status: 'error', error: error?.message ?? 'Unknown error' }));
        });

        return this._manager;
    }

    async spawn(opts = {}) {
        if (!this._manager) this.create(opts);
        return this._manager.spawn({ amount: opts.amount ?? this._manager.totalShards, delay: opts.delay ?? 5500, timeout: opts.timeout ?? -1 });
    }

    autoScale(guildCount) {
        return calculateShardCount(guildCount, this._guildsPerShard);
    }

    planScale(guildCount) {
        const recommendedShards = this.autoScale(guildCount);
        const currentShards = this._manager?.shards?.size ?? 0;
        return {
            guildCount,
            currentShards,
            recommendedShards,
            needsScaling: currentShards !== 0 && currentShards !== recommendedShards
        };
    }

    distributeLoad(items = [], shardCount = null) {
        const count = shardCount ?? this._manager?.shards?.size ?? 1;
        const buckets = Array.from({ length: Math.max(1, count) }, () => []);
        for (let i = 0; i < items.length; i++) {
            buckets[i % buckets.length].push(items[i]);
        }
        return buckets;
    }

    async syncCache(namespace, key, value) {
        if (!this._manager) return false;
        await this._manager.broadcastEval((client, context) => {
            const container = client?.container ?? client?.framework?.container;
            const cache = container?.get?.('cacheManager') ?? container?.get?.('cache');
            if (cache?.set) {
                return cache.set(context.namespace, context.key, context.value);
            }
            return null;
        }, { context: { namespace, key, value } });
        return true;
    }

    async mirrorEvent(eventName, payload) {
        if (!this._manager) return false;
        await this._manager.broadcastEval((client, context) => {
            const bus = client?.framework?.events ?? client?.container?.get?.('eventBus');
            if (bus?.emitSync) bus.emitSync(context.eventName, context.payload);
            return true;
        }, { context: { eventName, payload } });
        return true;
    }

    async fetchShardStats() {
        if (!this._manager) return this.getStats();

        const guildCounts = await this._manager.fetchClientValues('guilds.cache.size').catch(() => []);
        const pings = await this._manager.fetchClientValues('ws.ping').catch(() => []);
        const memories = await this._manager.broadcastEval(() => process.memoryUsage().rss).catch(() => []);

        for (let i = 0; i < this._manager.shards.size; i++) {
            this._updateShard(i, {
                guilds: guildCounts[i] ?? 0,
                ping: pings[i] ?? null,
                memory: memories[i] ?? null,
                status: this._stats.get(i)?.status ?? 'ready'
            });
        }

        return this.getStats();
    }

    getStats() {
        return [...this._stats.values()].sort((a, b) => a.id - b.id);
    }

    getManager() {
        return this._manager;
    }

    _updateShard(shardId, values) {
        const current = this._stats.get(shardId) ?? { id: shardId, launchedAt: Date.now() };
        this._stats.set(shardId, { ...current, ...values, updatedAt: Date.now() });
    }
}

module.exports = { ShardManager };
