const { EventEmitter } = require('events');

const PRIORITY = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

class SmartCooldown {
    constructor(opts = {}) {
        this._windowMs = opts.windowMs ?? 60000;
        this._spammerThreshold = opts.spammerThreshold ?? 10;
        this._premiumMultiplier = opts.premiumMultiplier ?? 0.5;
        this._spammerMultiplier = opts.spammerMultiplier ?? 3;
        this._history = new Map();
    }

    record(userId, timestamp = Date.now()) {
        if (!userId) return 0;
        const history = this._history.get(userId) ?? [];
        history.push(timestamp);
        this._history.set(userId, history.filter(ts => ts >= timestamp - this._windowMs));
        return history.length;
    }

    getActivity(userId, now = Date.now()) {
        const history = this._history.get(userId) ?? [];
        const active = history.filter(ts => ts >= now - this._windowMs);
        this._history.set(userId, active);
        return active.length;
    }

    getCooldown(baseCooldownMs, context = {}) {
        const count = this.getActivity(context.userId, context.now);
        let multiplier = 1;
        if (count >= this._spammerThreshold) multiplier = this._spammerMultiplier;
        if (context.premium) multiplier = Math.min(multiplier, this._premiumMultiplier);
        return Math.max(0, Math.round(baseCooldownMs * multiplier));
    }

    getState(userId) {
        return {
            requestsInWindow: this.getActivity(userId),
            spammerThreshold: this._spammerThreshold,
            windowMs: this._windowMs
        };
    }
}

class RequestEntry {
    constructor(opts) {
        this.id = opts.id ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.route = opts.route;
        this.priority = opts.priority ?? PRIORITY.NORMAL;
        this.timestamp = opts.timestamp ?? Date.now();
        this.resolve = opts.resolve;
        this.reject = opts.reject;
        this.fn = opts.fn;
    }
}

class RouteTracker {
    constructor() {
        this._requests = [];
        this._window = 1000;
        this._remaining = null;
        this._limit = null;
        this._resetAt = null;
        this._globalReset = null;
    }

    record() {
        const now = Date.now();
        this._requests = this._requests.filter(t => t > now - this._window);
        this._requests.push(now);
    }

    get requestsInWindow() {
        const now = Date.now();
        this._requests = this._requests.filter(t => t > now - this._window);
        return this._requests.length;
    }

    updateFromHeaders(headers) {
        if (headers['x-ratelimit-remaining'] !== undefined) {
            this._remaining = parseInt(headers['x-ratelimit-remaining']);
        }
        if (headers['x-ratelimit-limit'] !== undefined) {
            this._limit = parseInt(headers['x-ratelimit-limit']);
        }
        if (headers['x-ratelimit-reset'] !== undefined) {
            this._resetAt = parseFloat(headers['x-ratelimit-reset']) * 1000;
        }
    }

    get isNearLimit() {
        if (this._remaining !== null && this._limit !== null) {
            return this._remaining <= Math.ceil(this._limit * 0.1);
        }
        return false;
    }

    get retryAfter() {
        if (this._resetAt) return Math.max(0, this._resetAt - Date.now());
        return 0;
    }
}

class RateLimitGuard extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._maxRequestsPerSecond = opts.maxRequestsPerSecond ?? 50;
        this._maxConcurrent = opts.maxConcurrent ?? 10;
        this._alertThreshold = opts.alertThreshold ?? 0.8;
        this._queue = [];
        this._active = 0;
        this._routeTrackers = new Map();
        this._globalTracker = new RouteTracker();
        this._globalRateLimited = false;
        this._globalResetAt = null;
        this._paused = false;
        this._metrics = { total: 0, queued: 0, dropped: 0, rateLimited: 0, globalRateLimited: 0 };
        this._processTimer = null;
        this._smartCooldown = opts.smartCooldown ?? new SmartCooldown(opts.smartCooldownOptions);
        this._usageHistory = new Map();
        this._anomalies = [];
        this._maxAnomalies = opts.maxAnomalies ?? 200;
        this._stats = opts.stats ?? null;
    }

    async execute(fn, opts = {}) {
        const route = opts.route ?? 'global';
        this._metrics.total++;
        this._trackUsage(opts);

        const cooldownMs = this.getCooldown(opts.baseCooldownMs ?? 0, opts);
        if (cooldownMs > 0) {
            this.emit('cooldownApplied', { route, cooldownMs, userId: opts.userId ?? null });
            if (this._stats?.incrementCustomMetric) this._stats.incrementCustomMetric('rate_limit.cooldowns');
            await new Promise(resolve => setTimeout(resolve, cooldownMs));
        }

        if (this._globalRateLimited) {
            const delay = this._globalResetAt ? Math.max(0, this._globalResetAt - Date.now()) : 1000;
            await new Promise(r => setTimeout(r, delay));
            this._globalRateLimited = false;
        }

        if (this._active >= this._maxConcurrent || this._paused || this._isNearGlobalLimit()) {
            this._metrics.queued++;
            return this._enqueue(fn, opts);
        }

        return this._run(fn, route);
    }

    _isNearGlobalLimit() {
        const rate = this._globalTracker.requestsInWindow;
        return rate >= this._maxRequestsPerSecond * this._alertThreshold;
    }

    async _run(fn, route) {
        this._active++;
        const tracker = this._getTracker(route);
        tracker.record();
        this._globalTracker.record();

        const rate = this._globalTracker.requestsInWindow;
        if (rate >= this._maxRequestsPerSecond * this._alertThreshold) {
            this.emit('nearLimit', { route, requestsPerSecond: rate, limit: this._maxRequestsPerSecond });
            if (this._stats?.incrementCustomMetric) this._stats.incrementCustomMetric('rate_limit.near_limit');
        }

        try {
            const result = await fn();
            if (result?.headers) tracker.updateFromHeaders(result.headers);
            return result;
        } catch (err) {
            if (err?.status === 429) {
                this._metrics.rateLimited++;
                const retryAfter = err?.headers?.['retry-after'] ? parseFloat(err.headers['retry-after']) * 1000 : 1000;
                const isGlobal = err?.headers?.['x-ratelimit-global'] === 'true';

                if (isGlobal) {
                    this._metrics.globalRateLimited++;
                    this._globalRateLimited = true;
                    this._globalResetAt = Date.now() + retryAfter;
                    this.emit('globalRateLimit', { retryAfter });
                    if (this._stats?.incrementCustomMetric) this._stats.incrementCustomMetric('rate_limit.global');
                } else {
                    tracker._resetAt = Date.now() + retryAfter;
                    this.emit('routeRateLimit', { route, retryAfter });
                    if (this._stats?.incrementCustomMetric) this._stats.incrementCustomMetric('rate_limit.route');
                }

                await new Promise(r => setTimeout(r, retryAfter));
                return this._run(fn, route);
            }
            throw err;
        } finally {
            this._active--;
            this._processQueue();
        }
    }

    _enqueue(fn, opts) {
        return new Promise((resolve, reject) => {
            const entry = new RequestEntry({
                route: opts.route ?? 'global',
                priority: opts.priority ?? PRIORITY.NORMAL,
                fn,
                resolve,
                reject
            });

            this._queue.push(entry);
            this._queue.sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp);

            if (!this._processTimer) {
                this._processTimer = setTimeout(() => {
                    this._processTimer = null;
                    this._processQueue();
                }, 100);
                if (this._processTimer.unref) this._processTimer.unref();
            }
        });
    }

    _processQueue() {
        while (this._queue.length > 0 && this._active < this._maxConcurrent && !this._paused) {
            const entry = this._queue.shift();
            this._run(entry.fn, entry.route)
                .then(entry.resolve)
                .catch(entry.reject);
        }
    }

    _getTracker(route) {
        if (!this._routeTrackers.has(route)) this._routeTrackers.set(route, new RouteTracker());
        return this._routeTrackers.get(route);
    }

    pause() { this._paused = true; return this; }
    resume() { this._paused = false; this._processQueue(); return this; }

    getCooldown(baseCooldownMs, opts = {}) {
        if (!baseCooldownMs) return 0;
        return this._smartCooldown.getCooldown(baseCooldownMs, {
            userId: opts.userId ?? null,
            premium: opts.premium ?? false,
            now: opts.now ?? Date.now()
        });
    }

    getStatus() {
        return {
            ...this.getMetrics(),
            anomalies: [...this._anomalies],
            globalResetAt: this._globalResetAt,
            paused: this._paused
        };
    }

    getMetrics() {
        return {
            ...this._metrics,
            active: this._active,
            queued: this._queue.length,
            requestsPerSecond: this._globalTracker.requestsInWindow,
            limit: this._maxRequestsPerSecond,
            utilization: this._globalTracker.requestsInWindow / this._maxRequestsPerSecond,
            globalRateLimited: this._globalRateLimited,
            routes: Object.fromEntries(
                [...this._routeTrackers.entries()].map(([route, tracker]) => [
                    route, { requestsInWindow: tracker.requestsInWindow, remaining: tracker._remaining, limit: tracker._limit }
                ])
            ),
            anomalyCount: this._anomalies.length
        };
    }

    _trackUsage(opts = {}) {
        const userId = opts.userId ?? null;
        const guildId = opts.guildId ?? null;
        const commandName = opts.commandName ?? null;
        const now = Date.now();

        if (userId) this._smartCooldown.record(userId, now);

        const bucketKey = `${guildId ?? 'global'}:${commandName ?? 'unknown'}`;
        const bucket = this._usageHistory.get(bucketKey) ?? [];
        bucket.push({ userId, timestamp: now });
        const active = bucket.filter(entry => entry.timestamp >= now - 10000);
        this._usageHistory.set(bucketKey, active);

        const uniqueUsers = new Set(active.map(entry => entry.userId).filter(Boolean));
        if (uniqueUsers.size >= 10 && active.length >= 20) {
            const anomaly = {
                id: `anomaly_${now}_${Math.random().toString(36).slice(2, 8)}`,
                timestamp: now,
                guildId,
                commandName,
                uniqueUsers: uniqueUsers.size,
                requests: active.length
            };
            this._anomalies.push(anomaly);
            if (this._anomalies.length > this._maxAnomalies) this._anomalies.shift();
            this.emit('anomalyDetected', anomaly);
            if (this._stats?.incrementCustomMetric) this._stats.incrementCustomMetric('rate_limit.anomalies');
        }
    }

    destroy() {
        if (this._processTimer) clearTimeout(this._processTimer);
        for (const entry of this._queue) entry.reject(new Error('RateLimitGuard destroyed'));
        this._queue = [];
        this._usageHistory.clear();
        this._anomalies = [];
    }
}

module.exports = { RateLimitGuard, RouteTracker, PRIORITY, SmartCooldown };
