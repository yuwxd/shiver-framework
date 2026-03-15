const { EventEmitter } = require('events');

class TokenBucket {
    constructor(opts = {}) {
        this._capacity = opts.capacity ?? 10;
        this._refillRate = opts.refillRate ?? 1;
        this._refillInterval = opts.refillInterval ?? 1000;
        this._tokens = opts.burst ?? this._capacity;
        this._lastRefill = Date.now();
    }

    _refill() {
        const now = Date.now();
        const elapsed = now - this._lastRefill;
        const tokensToAdd = Math.floor((elapsed / this._refillInterval) * this._refillRate);
        if (tokensToAdd > 0) {
            this._tokens = Math.min(this._capacity, this._tokens + tokensToAdd);
            this._lastRefill = now;
        }
    }

    consume(amount = 1) {
        this._refill();
        if (this._tokens >= amount) {
            this._tokens -= amount;
            return true;
        }
        return false;
    }

    get tokens() {
        this._refill();
        return this._tokens;
    }

    get retryAfter() {
        this._refill();
        if (this._tokens >= 1) return 0;
        const needed = 1 - this._tokens;
        return Math.ceil((needed / this._refillRate) * this._refillInterval);
    }

    reset() {
        this._tokens = this._capacity;
        this._lastRefill = Date.now();
    }
}

class SlidingWindowBucket {
    constructor(opts = {}) {
        this._limit = opts.limit ?? 10;
        this._window = opts.window ?? 60000;
        this._timestamps = [];
    }

    _cleanup() {
        const cutoff = Date.now() - this._window;
        this._timestamps = this._timestamps.filter(t => t > cutoff);
    }

    consume() {
        this._cleanup();
        if (this._timestamps.length < this._limit) {
            this._timestamps.push(Date.now());
            return true;
        }
        return false;
    }

    get count() {
        this._cleanup();
        return this._timestamps.length;
    }

    get remaining() {
        this._cleanup();
        return Math.max(0, this._limit - this._timestamps.length);
    }

    get retryAfter() {
        this._cleanup();
        if (this._timestamps.length < this._limit) return 0;
        const oldest = this._timestamps[0];
        return Math.max(0, oldest + this._window - Date.now());
    }

    reset() {
        this._timestamps = [];
    }
}

class FixedWindowBucket {
    constructor(opts = {}) {
        this._limit = opts.limit ?? 10;
        this._window = opts.window ?? 60000;
        this._count = 0;
        this._windowStart = Date.now();
    }

    _checkWindow() {
        const now = Date.now();
        if (now - this._windowStart >= this._window) {
            this._count = 0;
            this._windowStart = now;
        }
    }

    consume() {
        this._checkWindow();
        if (this._count < this._limit) {
            this._count++;
            return true;
        }
        return false;
    }

    get remaining() {
        this._checkWindow();
        return Math.max(0, this._limit - this._count);
    }

    get retryAfter() {
        this._checkWindow();
        if (this._count < this._limit) return 0;
        return Math.max(0, this._windowStart + this._window - Date.now());
    }

    reset() {
        this._count = 0;
        this._windowStart = Date.now();
    }
}

class RateLimiter extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._algorithm = opts.algorithm ?? 'sliding';
        this._bucketOpts = opts;
        this._buckets = new Map();
        this._strategy = opts.strategy ?? 'drop';
        this._waitQueue = new Map();
        this._redis = opts.redis ?? null;
        this._keyPrefix = opts.keyPrefix ?? 'rl:';
        this._scope = opts.scope ?? 'user';
        this._cleanupInterval = setInterval(() => this._cleanup(), 300000);
        if (this._cleanupInterval.unref) this._cleanupInterval.unref();
    }

    _createBucket() {
        if (this._algorithm === 'token') return new TokenBucket(this._bucketOpts);
        if (this._algorithm === 'fixed') return new FixedWindowBucket(this._bucketOpts);
        return new SlidingWindowBucket(this._bucketOpts);
    }

    _getBucket(key) {
        if (!this._buckets.has(key)) this._buckets.set(key, { bucket: this._createBucket(), lastAccess: Date.now() });
        const entry = this._buckets.get(key);
        entry.lastAccess = Date.now();
        return entry.bucket;
    }

    _buildKey(context) {
        const { userId, guildId, channelId, commandName } = context;
        if (this._scope === 'user') return userId ?? 'global';
        if (this._scope === 'guild') return guildId ?? 'global';
        if (this._scope === 'channel') return channelId ?? 'global';
        if (this._scope === 'command') return `${commandName}:${userId ?? 'global'}`;
        if (this._scope === 'global') return 'global';
        return userId ?? 'global';
    }

    async check(context) {
        const key = this._buildKey(context);
        const bucket = this._getBucket(key);
        const allowed = bucket.consume();
        const retryAfter = allowed ? 0 : bucket.retryAfter;

        if (!allowed) {
            this.emit('rateLimited', { key, context, retryAfter });

            if (this._strategy === 'wait') {
                return this._waitForSlot(key, bucket, retryAfter);
            }

            return { allowed: false, retryAfter, key };
        }

        return { allowed: true, retryAfter: 0, key };
    }

    async _waitForSlot(key, bucket, retryAfter) {
        return new Promise((resolve) => {
            const timer = setTimeout(async () => {
                const result = await this.check({ _key: key });
                resolve(result);
                this.emit('rateLimitReset', { key });
            }, retryAfter);
            if (timer.unref) timer.unref();
        });
    }

    reset(context) {
        const key = typeof context === 'string' ? context : this._buildKey(context);
        const entry = this._buckets.get(key);
        if (entry) {
            entry.bucket.reset();
            this.emit('rateLimitReset', { key });
        }
    }

    resetAll() {
        for (const [key, entry] of this._buckets) {
            entry.bucket.reset();
            this.emit('rateLimitReset', { key });
        }
    }

    getInfo(context) {
        const key = typeof context === 'string' ? context : this._buildKey(context);
        const entry = this._buckets.get(key);
        if (!entry) return { key, exists: false, remaining: this._bucketOpts.limit ?? this._bucketOpts.capacity ?? 10, retryAfter: 0 };
        const bucket = entry.bucket;
        return {
            key,
            exists: true,
            remaining: bucket.remaining ?? bucket.tokens,
            retryAfter: bucket.retryAfter
        };
    }

    _cleanup() {
        const cutoff = Date.now() - 600000;
        for (const [key, entry] of this._buckets) {
            if (entry.lastAccess < cutoff) this._buckets.delete(key);
        }
    }

    getStats() {
        return {
            activeBuckets: this._buckets.size,
            algorithm: this._algorithm,
            strategy: this._strategy,
            scope: this._scope
        };
    }

    destroy() {
        clearInterval(this._cleanupInterval);
        this._buckets.clear();
    }
}

class MultiScopeRateLimiter {
    constructor(configs = {}) {
        this._limiters = new Map();
        for (const [name, opts] of Object.entries(configs)) {
            this._limiters.set(name, new RateLimiter({ ...opts, scope: name }));
        }
    }

    async check(context) {
        const results = {};
        for (const [name, limiter] of this._limiters) {
            results[name] = await limiter.check(context);
        }

        const blocked = Object.entries(results).find(([, r]) => !r.allowed);
        if (blocked) {
            return { allowed: false, blockedBy: blocked[0], retryAfter: blocked[1].retryAfter, results };
        }

        return { allowed: true, results };
    }

    get(name) {
        return this._limiters.get(name);
    }

    reset(context) {
        for (const limiter of this._limiters.values()) limiter.reset(context);
    }

    destroy() {
        for (const limiter of this._limiters.values()) limiter.destroy();
    }
}

module.exports = { RateLimiter, MultiScopeRateLimiter, TokenBucket, SlidingWindowBucket, FixedWindowBucket };
