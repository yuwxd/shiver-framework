async function withTimeout(fn, timeoutMs) {
    return new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
        try {
            const result = await fn();
            clearTimeout(timer);
            resolve(result);
        } catch (err) {
            clearTimeout(timer);
            reject(err);
        }
    });
}

async function withRetry(fn, retries = 3, delayMs = 500) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (i < retries) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        }
    }
    throw lastErr;
}

async function safeRun(fn, opts = {}) {
    const { retries = 0, timeoutMs, onError, fallback } = opts;
    const wrapped = timeoutMs ? () => withTimeout(fn, timeoutMs) : fn;
    try {
        if (retries > 0) return await withRetry(wrapped, retries, opts.delayMs ?? 300);
        return await wrapped();
    } catch (err) {
        if (typeof onError === 'function') onError(err);
        if (fallback !== undefined) return typeof fallback === 'function' ? fallback(err) : fallback;
        throw err;
    }
}

module.exports = { safeRun, withRetry, withTimeout };
