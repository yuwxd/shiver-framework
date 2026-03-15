async function withRetry(fn, options = {}) {
    const maxRetries = options.maxRetries ?? 3;
    const maxDelayMs = options.maxDelayMs ?? 30000;
    const retryOn5xx = options.retryOn5xx !== false;
    const retryOn429 = options.retryOn429 !== false;
    const onRetry = options.onRetry ?? null;
    const shouldRetry = options.shouldRetry ?? null;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastError = err;
            const status = err?.status ?? err?.httpStatus ?? err?.code;
            const is5xx = typeof status === 'number' && status >= 500 && status < 600;
            const is429 = status === 429;
            const isNetworkError = err?.code === 'ECONNRESET' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT';

            const shouldRetryThis = shouldRetry
                ? shouldRetry(err, attempt)
                : ((is429 && retryOn429) || (is5xx && retryOn5xx) || isNetworkError);

            if (shouldRetryThis && attempt < maxRetries) {
                const retryAfterMs = is429 ? (err?.retryAfter ?? 5) * 1000 : 1000;
                const jitter = Math.random() * 1000;
                const delay = Math.min(retryAfterMs * Math.pow(2, attempt) + jitter, maxDelayMs);

                if (typeof onRetry === 'function') {
                    onRetry({ attempt: attempt + 1, error: err, delayMs: delay });
                }

                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            throw err;
        }
    }

    throw lastError;
}

class RequestQueue {
    constructor(opts = {}) {
        this._concurrency = opts.concurrency ?? 5;
        this._queue = [];
        this._active = 0;
        this._paused = false;
    }

    async add(fn, priority = 0) {
        return new Promise((resolve, reject) => {
            this._queue.push({ fn, priority, resolve, reject });
            this._queue.sort((a, b) => b.priority - a.priority);
            this._process();
        });
    }

    _process() {
        if (this._paused || this._active >= this._concurrency || this._queue.length === 0) return;
        const { fn, resolve, reject } = this._queue.shift();
        this._active++;
        fn().then(resolve).catch(reject).finally(() => {
            this._active--;
            this._process();
        });
    }

    pause() { this._paused = true; return this; }
    resume() { this._paused = false; this._process(); return this; }
    clear() { this._queue.forEach(item => item.reject(new Error('Queue cleared'))); this._queue = []; return this; }
    get size() { return this._queue.length; }
    get activeCount() { return this._active; }
}

module.exports = { withRetry, RequestQueue };
