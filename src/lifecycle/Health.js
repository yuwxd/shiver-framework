const { EventEmitter } = require('events');
const http = require('http');
const { safeError } = require('../security/redact');

const CIRCUIT_STATES = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' };

class CircuitBreaker extends EventEmitter {
    constructor(name, opts = {}) {
        super();
        this.name = name;
        this._failureThreshold = opts.failureThreshold ?? 5;
        this._successThreshold = opts.successThreshold ?? 2;
        this._timeout = opts.timeout ?? 30000;
        this._halfOpenRequests = opts.halfOpenRequests ?? 1;
        this._state = CIRCUIT_STATES.CLOSED;
        this._failures = 0;
        this._successes = 0;
        this._lastFailureTime = null;
        this._halfOpenCount = 0;
        this._stats = { totalRequests: 0, successfulRequests: 0, failedRequests: 0, rejectedRequests: 0 };
    }

    get state() { return this._state; }
    get isOpen() { return this._state === CIRCUIT_STATES.OPEN; }
    get isClosed() { return this._state === CIRCUIT_STATES.CLOSED; }
    get isHalfOpen() { return this._state === CIRCUIT_STATES.HALF_OPEN; }

    async execute(fn) {
        this._stats.totalRequests++;

        if (this._state === CIRCUIT_STATES.OPEN) {
            if (Date.now() - this._lastFailureTime >= this._timeout) {
                this._transition(CIRCUIT_STATES.HALF_OPEN);
            } else {
                this._stats.rejectedRequests++;
                throw new CircuitBreakerError(this.name, 'Circuit breaker is OPEN');
            }
        }

        if (this._state === CIRCUIT_STATES.HALF_OPEN) {
            if (this._halfOpenCount >= this._halfOpenRequests) {
                this._stats.rejectedRequests++;
                throw new CircuitBreakerError(this.name, 'Circuit breaker is HALF_OPEN: too many requests');
            }
            this._halfOpenCount++;
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (e) {
            this._onFailure();
            throw e;
        }
    }

    _onSuccess() {
        this._stats.successfulRequests++;
        if (this._state === CIRCUIT_STATES.HALF_OPEN) {
            this._successes++;
            if (this._successes >= this._successThreshold) {
                this._transition(CIRCUIT_STATES.CLOSED);
            }
        } else {
            this._failures = 0;
        }
    }

    _onFailure() {
        this._stats.failedRequests++;
        this._failures++;
        this._lastFailureTime = Date.now();
        if (this._state === CIRCUIT_STATES.HALF_OPEN) {
            this._transition(CIRCUIT_STATES.OPEN);
        } else if (this._failures >= this._failureThreshold) {
            this._transition(CIRCUIT_STATES.OPEN);
        }
    }

    _transition(newState) {
        const oldState = this._state;
        this._state = newState;
        if (newState === CIRCUIT_STATES.CLOSED) {
            this._failures = 0;
            this._successes = 0;
            this._halfOpenCount = 0;
        } else if (newState === CIRCUIT_STATES.HALF_OPEN) {
            this._successes = 0;
            this._halfOpenCount = 0;
        }
        this.emit('stateChange', oldState, newState);
    }

    reset() {
        this._transition(CIRCUIT_STATES.CLOSED);
        this._lastFailureTime = null;
    }

    getStats() {
        return { ...this._stats, state: this._state, failures: this._failures };
    }
}

class CircuitBreakerError extends Error {
    constructor(name, message) {
        super(message);
        this.name = 'CircuitBreakerError';
        this.circuitName = name;
    }
}

class HealthManager extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._client = null;
        this._httpServer = null;
        this._port = opts.port ?? 8080;
        this._host = opts.host ?? '0.0.0.0';
        this._enableHttp = opts.enableHttp ?? opts.enabled ?? false;
        this._checks = new Map();
        this._circuitBreakers = new Map();
        this._status = 'starting';
        this._startTime = Date.now();
        this._shutdownHandlers = [];
        this._shutdownTimeout = opts.shutdownTimeout ?? 10000;
        this._isShuttingDown = false;
        this._readinessChecks = new Map();
        this._livenessChecks = new Map();
        this._customRoutes = new Map();
        this._opts = opts;
    }

    addRoute(method, path, handler) {
        const key = `${(method || 'GET').toUpperCase()}:${path}`;
        this._customRoutes.set(key, handler);
        return this;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    addCheck(name, fn, opts = {}) {
        this._checks.set(name, { fn, critical: opts.critical ?? false, timeout: opts.timeout ?? 5000 });
        return this;
    }

    addReadinessCheck(name, fn) {
        this._readinessChecks.set(name, fn);
        return this;
    }

    addLivenessCheck(name, fn) {
        this._livenessChecks.set(name, fn);
        return this;
    }

    removeCheck(name) {
        this._checks.delete(name);
        return this;
    }

    createCircuitBreaker(name, opts = {}) {
        const cb = new CircuitBreaker(name, opts);
        this._circuitBreakers.set(name, cb);
        return cb;
    }

    getCircuitBreaker(name) {
        return this._circuitBreakers.get(name) ?? null;
    }

    onShutdown(handler) {
        this._shutdownHandlers.push(handler);
        return this;
    }

    async runChecks() {
        const results = {};
        let allHealthy = true;

        for (const [name, check] of this._checks) {
            try {
                const result = await Promise.race([
                    check.fn(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Check timed out')), check.timeout))
                ]);
                results[name] = { status: 'ok', result };
            } catch (e) {
                results[name] = { status: 'error', error: e.message };
                if (check.critical) allHealthy = false;
            }
        }

        return { healthy: allHealthy, checks: results };
    }

    async runReadinessChecks() {
        const results = {};
        let ready = true;
        for (const [name, fn] of this._readinessChecks) {
            try {
                const result = await fn();
                results[name] = { ready: result !== false, result };
                if (result === false) ready = false;
            } catch (e) {
                results[name] = { ready: false, error: e.message };
                ready = false;
            }
        }
        return { ready, checks: results };
    }

    async runLivenessChecks() {
        const results = {};
        let alive = true;
        for (const [name, fn] of this._livenessChecks) {
            try {
                const result = await fn();
                results[name] = { alive: result !== false, result };
                if (result === false) alive = false;
            } catch (e) {
                results[name] = { alive: false, error: e.message };
                alive = false;
            }
        }
        return { alive, checks: results };
    }

    getStatus() {
        return {
            status: this._status,
            uptime: Date.now() - this._startTime,
            uptimeFormatted: this._formatUptime(Date.now() - this._startTime),
            pid: process.pid,
            memory: process.memoryUsage(),
            circuitBreakers: Object.fromEntries(
                [...this._circuitBreakers.entries()].map(([k, v]) => [k, v.getStats()])
            )
        };
    }

    _formatUptime(ms) {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);
        return `${d}d ${h % 24}h ${m % 60}m ${s % 60}s`;
    }

    async startHttpServer() {
        if (!this._enableHttp) return;
        this._httpServer = http.createServer(async (req, res) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const pathname = url.pathname;
            const method = (req.method || 'GET').toUpperCase();
            const routeKey = `${method}:${pathname}`;
            const customHandler = this._customRoutes.get(routeKey) || this._customRoutes.get(`${method}:*`);
            if (customHandler) {
                res.setHeader('Content-Type', 'application/json');
                try {
                    const result = await Promise.resolve(customHandler(req, res, url));
                    if (result !== undefined && !res.writableEnded) {
                        res.statusCode = res.statusCode || 200;
                        res.end(typeof result === 'string' ? result : JSON.stringify(result));
                    }
                } catch (e) {
                    if (!res.writableEnded) {
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: 'Internal error' }));
                    }
                }
                return;
            }
            res.setHeader('Content-Type', 'application/json');

            if (pathname === '/health') {
                const result = await this.runChecks();
                res.statusCode = result.healthy ? 200 : 503;
                res.end(JSON.stringify({ ...result, ...this.getStatus() }));
            } else if (pathname === '/ready' || pathname === '/readiness') {
                const result = await this.runReadinessChecks();
                res.statusCode = result.ready ? 200 : 503;
                res.end(JSON.stringify(result));
            } else if (pathname === '/live' || pathname === '/liveness') {
                const result = await this.runLivenessChecks();
                res.statusCode = result.alive ? 200 : 503;
                res.end(JSON.stringify(result));
            } else if (pathname === '/metrics') {
                res.setHeader('Content-Type', 'text/plain');
                res.end(this._prometheusMetrics());
            } else if (pathname === '/status') {
                res.statusCode = 200;
                res.end(JSON.stringify(this.getStatus()));
            } else {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Not found' }));
            }
        });

        await new Promise((resolve, reject) => {
            this._httpServer.listen(this._port, this._host, resolve);
            this._httpServer.on('error', reject);
        });
    }

    _prometheusMetrics() {
        const status = this.getStatus();
        const mem = status.memory;
        const lines = [
            `# HELP shiver_uptime_seconds Bot uptime in seconds`,
            `# TYPE shiver_uptime_seconds gauge`,
            `shiver_uptime_seconds ${Math.floor(status.uptime / 1000)}`,
            `# HELP shiver_memory_heap_used_bytes Heap used bytes`,
            `# TYPE shiver_memory_heap_used_bytes gauge`,
            `shiver_memory_heap_used_bytes ${mem.heapUsed}`,
            `# HELP shiver_memory_heap_total_bytes Heap total bytes`,
            `# TYPE shiver_memory_heap_total_bytes gauge`,
            `shiver_memory_heap_total_bytes ${mem.heapTotal}`,
            `# HELP shiver_memory_rss_bytes RSS bytes`,
            `# TYPE shiver_memory_rss_bytes gauge`,
            `shiver_memory_rss_bytes ${mem.rss}`
        ];

        if (this._client) {
            lines.push(
                `# HELP shiver_guilds_total Total guilds`,
                `# TYPE shiver_guilds_total gauge`,
                `shiver_guilds_total ${this._client.guilds?.cache?.size ?? 0}`,
                `# HELP shiver_users_total Total cached users`,
                `# TYPE shiver_users_total gauge`,
                `shiver_users_total ${this._client.users?.cache?.size ?? 0}`,
                `# HELP shiver_ws_ping WebSocket ping in ms`,
                `# TYPE shiver_ws_ping gauge`,
                `shiver_ws_ping ${this._client.ws?.ping ?? -1}`
            );
        }

        for (const [name, cb] of this._circuitBreakers) {
            const stats = cb.getStats();
            lines.push(
                `shiver_circuit_breaker_state{name="${name}"} ${cb.isOpen ? 1 : 0}`,
                `shiver_circuit_breaker_failures_total{name="${name}"} ${stats.failedRequests}`,
                `shiver_circuit_breaker_successes_total{name="${name}"} ${stats.successfulRequests}`
            );
        }

        return lines.join('\n') + '\n';
    }

    setStatus(status) {
        this._status = status;
        this.emit('statusChange', status);
        return this;
    }

    markStarting() {
        return this.setStatus('starting');
    }

    markReady() {
        return this.setStatus('ready');
    }

    markShuttingDown() {
        return this.setStatus('shutting_down');
    }

    markStopped() {
        return this.setStatus('stopped');
    }

    get isReady() {
        return this._status === 'ready';
    }

    get isShuttingDown() {
        return this._isShuttingDown || this._status === 'shutting_down';
    }

    async shutdown(signal = 'SIGTERM') {
        if (this._isShuttingDown) return;
        this._isShuttingDown = true;
        this.markShuttingDown();
        this.emit('shutdown', signal);

        const timeout = setTimeout(() => {
            console.error('[Health] Shutdown timed out, forcing exit');
            process.exit(1);
        }, this._shutdownTimeout);

        try {
            for (const handler of this._shutdownHandlers) {
                await handler(signal);
            }
        } catch (e) {
            safeError('Health', e);
        }

        clearTimeout(timeout);
        if (this._httpServer) {
            await new Promise(resolve => this._httpServer.close(resolve));
        }
        this.markStopped();
    }

    setupProcessHandlers() {
        const handler = async (signal) => {
            console.log(`[Health] Received ${signal}, shutting down...`);
            await this.shutdown(signal);
            process.exit(0);
        };
        process.on('SIGTERM', () => handler('SIGTERM'));
        process.on('SIGINT', () => handler('SIGINT'));
        process.on('uncaughtException', (e) => {
            safeError('Health', e);
            this.emit('uncaughtException', e);
        });
        process.on('unhandledRejection', (reason) => {
            safeError('Health', reason);
            this.emit('unhandledRejection', reason);
        });
        return this;
    }
}

module.exports = { HealthManager, CircuitBreaker, CircuitBreakerError, CIRCUIT_STATES };
