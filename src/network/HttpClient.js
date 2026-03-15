const https = require('https');
const http = require('http');
const { URL } = require('url');
const { redactSecrets } = require('../security/redact');

class HttpError extends Error {
    constructor(message, opts = {}) {
        super(message);
        this.name = 'HttpError';
        this.statusCode = opts.statusCode ?? null;
        this.url = opts.url ?? null;
        this.method = opts.method ?? null;
        this.body = opts.body ?? null;
        this.retryable = opts.retryable ?? false;
    }
}

class CircuitBreakerState {
    constructor(opts = {}) {
        this.failureThreshold = opts.failureThreshold ?? 5;
        this.timeout = opts.timeout ?? 30000;
        this.state = 'CLOSED';
        this.failures = 0;
        this.lastFailure = null;
        this.nextAttempt = null;
    }

    canRequest() {
        if (this.state === 'CLOSED') return true;
        if (this.state === 'OPEN') {
            if (Date.now() >= this.nextAttempt) {
                this.state = 'HALF_OPEN';
                return true;
            }
            return false;
        }
        return true;
    }

    onSuccess() {
        this.failures = 0;
        this.state = 'CLOSED';
    }

    onFailure() {
        this.failures++;
        this.lastFailure = Date.now();
        if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
        }
    }
}

class HttpClient {
    constructor(opts = {}) {
        this._baseUrl = opts.baseUrl ?? '';
        this._defaultHeaders = opts.headers ?? {};
        this._timeout = opts.timeout ?? 10000;
        this._maxRetries = opts.maxRetries ?? 3;
        this._retryDelay = opts.retryDelay ?? 500;
        this._cache = opts.cache ?? null;
        this._cacheTtl = opts.cacheTtl ?? 60000;
        this._circuitBreakers = new Map();
        this._circuitBreakerOpts = opts.circuitBreaker ?? null;
        this._requestInterceptors = [];
        this._responseInterceptors = [];
        this._rateLimits = new Map();
        this._metrics = { requests: 0, errors: 0, retries: 0, cacheHits: 0, totalLatency: 0 };
        this._logger = opts.logger ?? null;
    }

    addRequestInterceptor(fn) {
        this._requestInterceptors.push(fn);
        return this;
    }

    addResponseInterceptor(fn) {
        this._responseInterceptors.push(fn);
        return this;
    }

    setRateLimit(host, opts) {
        this._rateLimits.set(host, { limit: opts.limit ?? 10, window: opts.window ?? 1000, timestamps: [] });
        return this;
    }

    _checkRateLimit(host) {
        const rl = this._rateLimits.get(host);
        if (!rl) return true;
        const now = Date.now();
        rl.timestamps = rl.timestamps.filter(t => t > now - rl.window);
        if (rl.timestamps.length >= rl.limit) return false;
        rl.timestamps.push(now);
        return true;
    }

    _getCircuitBreaker(host) {
        if (!this._circuitBreakerOpts) return null;
        if (!this._circuitBreakers.has(host)) {
            this._circuitBreakers.set(host, new CircuitBreakerState(this._circuitBreakerOpts));
        }
        return this._circuitBreakers.get(host);
    }

    async request(method, url, opts = {}) {
        const fullUrl = url.startsWith('http') ? url : `${this._baseUrl}${url}`;
        const parsed = new URL(fullUrl);
        const host = parsed.hostname;

        const cb = this._getCircuitBreaker(host);
        if (cb && !cb.canRequest()) {
            throw new HttpError(`Circuit breaker OPEN for ${host}`, { url: fullUrl, method, retryable: false });
        }

        if (!this._checkRateLimit(host)) {
            throw new HttpError(`Rate limit exceeded for ${host}`, { url: fullUrl, method, retryable: true });
        }

        const cacheKey = method === 'GET' && this._cache ? `http:${fullUrl}:${JSON.stringify(opts.params ?? {})}` : null;
        if (cacheKey) {
            const cached = await this._cache.get('http', cacheKey).catch(() => null);
            if (cached !== null) {
                this._metrics.cacheHits++;
                return cached;
            }
        }

        let reqOpts = {
            method: method.toUpperCase(),
            headers: { ...this._defaultHeaders, ...opts.headers },
            body: opts.body,
            timeout: opts.timeout ?? this._timeout,
            params: opts.params
        };

        for (const interceptor of this._requestInterceptors) {
            reqOpts = await interceptor(reqOpts) ?? reqOpts;
        }

        let lastError;
        const maxAttempts = 1 + (opts.retries ?? this._maxRetries);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const start = Date.now();
            try {
                this._metrics.requests++;
                const response = await this._doRequest(fullUrl, reqOpts);
                const latency = Date.now() - start;
                this._metrics.totalLatency += latency;

                let processedResponse = response;
                for (const interceptor of this._responseInterceptors) {
                    processedResponse = await interceptor(processedResponse, reqOpts) ?? processedResponse;
                }

                if (cb) cb.onSuccess();

                if (cacheKey && processedResponse.ok) {
                    await this._cache.set('http', cacheKey, processedResponse, this._cacheTtl).catch(() => {});
                }

                return processedResponse;
            } catch (err) {
                lastError = err;
                this._metrics.errors++;
                if (cb) cb.onFailure();

                const isRetryable = err.retryable !== false && (
                    err.statusCode == null ||
                    err.statusCode >= 500 ||
                    err.statusCode === 429 ||
                    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)
                );

                if (!isRetryable || attempt >= maxAttempts) break;

                this._metrics.retries++;
                const delay = this._retryDelay * Math.pow(2, attempt - 1);
                await new Promise(r => setTimeout(r, delay));
            }
        }

        throw lastError;
    }

    _doRequest(url, opts) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const isHttps = parsed.protocol === 'https:';
            const lib = isHttps ? https : http;

            if (opts.params) {
                for (const [k, v] of Object.entries(opts.params)) {
                    parsed.searchParams.set(k, v);
                }
            }

            const headers = { ...opts.headers };
            let bodyData = null;

            if (opts.body !== undefined && opts.body !== null) {
                if (typeof opts.body === 'object') {
                    bodyData = JSON.stringify(opts.body);
                    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
                    headers['Content-Length'] = Buffer.byteLength(bodyData);
                } else {
                    bodyData = String(opts.body);
                    headers['Content-Length'] = Buffer.byteLength(bodyData);
                }
            }

            const reqOpts = {
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: opts.method,
                headers
            };

            const req = lib.request(reqOpts, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    let body = raw;
                    try {
                        const ct = res.headers['content-type'] ?? '';
                        if (ct.includes('application/json')) body = JSON.parse(raw);
                    } catch (_) {}

                    const response = {
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        headers: res.headers,
                        body,
                        raw,
                        url
                    };

                    if (!response.ok) {
                        const err = new HttpError(`HTTP ${res.statusCode} ${res.statusMessage}`, {
                            statusCode: res.statusCode,
                            url,
                            method: opts.method,
                            body,
                            retryable: res.statusCode >= 500 || res.statusCode === 429
                        });
                        reject(err);
                    } else {
                        resolve(response);
                    }
                });
                res.on('error', reject);
            });

            const timer = setTimeout(() => {
                req.destroy();
                reject(new HttpError(`Request timeout after ${opts.timeout}ms`, { url, method: opts.method, retryable: true }));
            }, opts.timeout);

            req.on('error', (err) => {
                clearTimeout(timer);
                const httpErr = new HttpError(err.message, { url, method: opts.method, retryable: true });
                httpErr.code = err.code;
                reject(httpErr);
            });

            req.on('response', () => clearTimeout(timer));

            if (bodyData) req.write(bodyData);
            req.end();
        });
    }

    async get(url, opts = {}) { return this.request('GET', url, opts); }
    async post(url, body, opts = {}) { return this.request('POST', url, { ...opts, body }); }
    async put(url, body, opts = {}) { return this.request('PUT', url, { ...opts, body }); }
    async patch(url, body, opts = {}) { return this.request('PATCH', url, { ...opts, body }); }
    async delete(url, opts = {}) { return this.request('DELETE', url, opts); }

    getMetrics() {
        return {
            ...this._metrics,
            avgLatency: this._metrics.requests > 0 ? Math.round(this._metrics.totalLatency / this._metrics.requests) : 0,
            cacheHitRate: this._metrics.requests > 0 ? this._metrics.cacheHits / this._metrics.requests : 0,
            circuitBreakers: Object.fromEntries(
                [...this._circuitBreakers.entries()].map(([host, cb]) => [host, { state: cb.state, failures: cb.failures }])
            )
        };
    }

    resetMetrics() {
        this._metrics = { requests: 0, errors: 0, retries: 0, cacheHits: 0, totalLatency: 0 };
    }
}

module.exports = { HttpClient, HttpError };
