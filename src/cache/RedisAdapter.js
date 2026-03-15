const { EventEmitter } = require('events');

class RedisAdapter extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._url = opts.url ?? 'redis://localhost:6379';
        this._password = opts.password ?? null;
        this._db = opts.db ?? 0;
        this._keyPrefix = opts.keyPrefix ?? 'shiver:';
        this._defaultTtl = opts.defaultTtl ?? null;
        this._client = null;
        this._subscriber = null;
        this._subscriptions = new Map();
        this._opts = opts;
        this._connected = false;
    }

    async connect() {
        const { createClient } = require('redis');
        this._client = createClient({
            url: this._url,
            password: this._password ?? undefined,
            database: this._db,
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > 10) return new Error('Max reconnect attempts reached');
                    return Math.min(retries * 100, 3000);
                }
            }
        });

        this._client.on('error', (e) => this.emit('error', e));
        this._client.on('connect', () => { this._connected = true; this.emit('connect'); });
        this._client.on('disconnect', () => { this._connected = false; this.emit('disconnect'); });
        this._client.on('reconnecting', () => this.emit('reconnecting'));

        await this._client.connect();
        return this;
    }

    async disconnect() {
        if (this._subscriber) await this._subscriber.quit();
        if (this._client) await this._client.quit();
        this._connected = false;
    }

    _prefixKey(key) {
        return `${this._keyPrefix}${key}`;
    }

    _unprefixKey(key) {
        return key.startsWith(this._keyPrefix) ? key.slice(this._keyPrefix.length) : key;
    }

    async get(key) {
        const raw = await this._client.get(this._prefixKey(key));
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch (_) { return raw; }
    }

    async set(key, value, ttl) {
        const serialized = JSON.stringify(value);
        const effectiveTtl = ttl ?? this._defaultTtl;
        if (effectiveTtl) {
            await this._client.setEx(this._prefixKey(key), Math.ceil(effectiveTtl / 1000), serialized);
        } else {
            await this._client.set(this._prefixKey(key), serialized);
        }
    }

    async delete(key) {
        return this._client.del(this._prefixKey(key));
    }

    async has(key) {
        return (await this._client.exists(this._prefixKey(key))) > 0;
    }

    async ttl(key) {
        return this._client.ttl(this._prefixKey(key));
    }

    async expire(key, seconds) {
        return this._client.expire(this._prefixKey(key), seconds);
    }

    async persist(key) {
        return this._client.persist(this._prefixKey(key));
    }

    async keys(pattern = '*') {
        const keys = await this._client.keys(this._prefixKey(pattern));
        return keys.map(k => this._unprefixKey(k));
    }

    async deletePattern(pattern) {
        const keys = await this._client.keys(this._prefixKey(pattern));
        if (keys.length === 0) return 0;
        return this._client.del(keys);
    }

    async increment(key, amount = 1) {
        const prefixed = this._prefixKey(key);
        return amount === 1 ? this._client.incr(prefixed) : this._client.incrBy(prefixed, amount);
    }

    async decrement(key, amount = 1) {
        const prefixed = this._prefixKey(key);
        return amount === 1 ? this._client.decr(prefixed) : this._client.decrBy(prefixed, amount);
    }

    async getMany(keys) {
        const prefixed = keys.map(k => this._prefixKey(k));
        const values = await this._client.mGet(prefixed);
        return values.map(v => {
            if (v === null) return null;
            try { return JSON.parse(v); } catch (_) { return v; }
        });
    }

    async setMany(entries, ttl) {
        const pipeline = this._client.multi();
        const effectiveTtl = ttl ?? this._defaultTtl;
        for (const [key, value] of entries) {
            const serialized = JSON.stringify(value);
            if (effectiveTtl) {
                pipeline.setEx(this._prefixKey(key), Math.ceil(effectiveTtl / 1000), serialized);
            } else {
                pipeline.set(this._prefixKey(key), serialized);
            }
        }
        return pipeline.exec();
    }

    async hGet(key, field) {
        const raw = await this._client.hGet(this._prefixKey(key), field);
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch (_) { return raw; }
    }

    async hSet(key, field, value) {
        return this._client.hSet(this._prefixKey(key), field, JSON.stringify(value));
    }

    async hGetAll(key) {
        const data = await this._client.hGetAll(this._prefixKey(key));
        const result = {};
        for (const [field, value] of Object.entries(data)) {
            try { result[field] = JSON.parse(value); } catch (_) { result[field] = value; }
        }
        return result;
    }

    async hDelete(key, ...fields) {
        return this._client.hDel(this._prefixKey(key), ...fields);
    }

    async lPush(key, ...values) {
        return this._client.lPush(this._prefixKey(key), values.map(v => JSON.stringify(v)));
    }

    async rPush(key, ...values) {
        return this._client.rPush(this._prefixKey(key), values.map(v => JSON.stringify(v)));
    }

    async lPop(key) {
        const raw = await this._client.lPop(this._prefixKey(key));
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch (_) { return raw; }
    }

    async rPop(key) {
        const raw = await this._client.rPop(this._prefixKey(key));
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch (_) { return raw; }
    }

    async lRange(key, start, stop) {
        const values = await this._client.lRange(this._prefixKey(key), start, stop);
        return values.map(v => { try { return JSON.parse(v); } catch (_) { return v; } });
    }

    async lLen(key) {
        return this._client.lLen(this._prefixKey(key));
    }

    async sAdd(key, ...members) {
        return this._client.sAdd(this._prefixKey(key), members.map(m => JSON.stringify(m)));
    }

    async sMembers(key) {
        const members = await this._client.sMembers(this._prefixKey(key));
        return members.map(m => { try { return JSON.parse(m); } catch (_) { return m; } });
    }

    async sIsMember(key, member) {
        return this._client.sIsMember(this._prefixKey(key), JSON.stringify(member));
    }

    async sRemove(key, ...members) {
        return this._client.sRem(this._prefixKey(key), members.map(m => JSON.stringify(m)));
    }

    async zAdd(key, score, member) {
        return this._client.zAdd(this._prefixKey(key), [{ score, value: JSON.stringify(member) }]);
    }

    async zRange(key, start, stop, opts = {}) {
        const values = await this._client.zRange(this._prefixKey(key), start, stop, opts);
        return values.map(v => { try { return JSON.parse(v); } catch (_) { return v; } });
    }

    async zRangeWithScores(key, start, stop) {
        return this._client.zRangeWithScores(this._prefixKey(key), start, stop);
    }

    async zScore(key, member) {
        return this._client.zScore(this._prefixKey(key), JSON.stringify(member));
    }

    async zRank(key, member) {
        return this._client.zRank(this._prefixKey(key), JSON.stringify(member));
    }

    async publish(channel, message) {
        return this._client.publish(channel, JSON.stringify(message));
    }

    async subscribe(channel, handler) {
        if (!this._subscriber) {
            const { createClient } = require('redis');
            this._subscriber = this._client.duplicate();
            await this._subscriber.connect();
        }
        await this._subscriber.subscribe(channel, (message) => {
            let parsed = message;
            try { parsed = JSON.parse(message); } catch (_) {}
            handler(parsed, channel);
        });
        this._subscriptions.set(channel, handler);
        return this;
    }

    async unsubscribe(channel) {
        if (!this._subscriber) return;
        await this._subscriber.unsubscribe(channel);
        this._subscriptions.delete(channel);
    }

    async pSubscribe(pattern, handler) {
        if (!this._subscriber) {
            const { createClient } = require('redis');
            this._subscriber = this._client.duplicate();
            await this._subscriber.connect();
        }
        await this._subscriber.pSubscribe(pattern, (message, channel) => {
            let parsed = message;
            try { parsed = JSON.parse(message); } catch (_) {}
            handler(parsed, channel);
        });
        return this;
    }

    pipeline() {
        return this._client.multi();
    }

    async flush() {
        const keys = await this._client.keys(`${this._keyPrefix}*`);
        if (keys.length === 0) return 0;
        return this._client.del(keys);
    }

    async info() {
        return this._client.info();
    }

    async ping() {
        return this._client.ping();
    }

    get isConnected() { return this._connected; }
    get raw() { return this._client; }
}

module.exports = { RedisAdapter };
