const { redactSecrets } = require('../security/redact');

const DEFAULT_TIMEOUT_MS = 10000;

async function pushJson(url, payload, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const method = (opts.method || 'POST').toUpperCase();
    const headers = {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
    };
    if (opts.authHeader) headers['Authorization'] = opts.authHeader;
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method,
            headers,
            body: method !== 'GET' ? body : undefined,
            signal: controller.signal
        });
        clearTimeout(t);
        const text = await res.text();
        if (!res.ok && opts.logErrors !== false) {
            console.error('[httpPush]', redactSecrets(` ${method} ${url} ${res.status}: ${text?.slice(0, 200)}`));
        }
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (_) {}
        return { ok: res.ok, status: res.status, data, text };
    } catch (err) {
        clearTimeout(t);
        if (opts.logErrors !== false) {
            console.error('[httpPush]', redactSecrets(err?.message || String(err)));
        }
        return { ok: false, status: null, error: err?.message || 'Request failed', data: null, text: null };
    }
}

module.exports = { pushJson };
