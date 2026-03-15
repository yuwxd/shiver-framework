const REST_PING_TIMEOUT_MS = 5000;
const GATEWAY_STALE_MS = 45000;

function readGatewayPing(client) {
    if (!client?.ws) return null;
    const ws = client.ws;
    const shards = ws.shards;
    if (shards?.size > 0) {
        let sum = 0;
        let count = 0;
        const raw = typeof ws.ping === 'number' && !Number.isNaN(ws.ping) ? ws.ping : null;
        if (raw != null && raw >= 0) return Math.round(raw);
        for (const [, shard] of shards) {
            const p = shard?.ping;
            if (typeof p === 'number' && p >= 0 && !Number.isNaN(p)) {
                sum += p;
                count++;
            }
        }
        if (count > 0) return Math.round(sum / count);
    }
    return typeof ws.ping === 'number' && ws.ping >= 0 ? Math.round(ws.ping) : null;
}

async function measureRestPing(timeoutMs = REST_PING_TIMEOUT_MS) {
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);
        const start = Date.now();
        await fetch('https://discord.com/api/v10/gateway', { signal: controller.signal });
        clearTimeout(t);
        const ms = Date.now() - start;
        return ms >= 0 ? Math.round(ms) : null;
    } catch (_) {
        return null;
    }
}

function formatLatency(ms) {
    if (ms === null || ms === undefined || typeof ms !== 'number') return null;
    const n = Math.round(Number(ms));
    return Number.isNaN(n) || n < 0 ? null : n;
}

class PingHelper {
    constructor(client) {
        this._client = client;
        this._lastGateway = null;
        this._lastGatewayAt = 0;
        this._cachedRest = null;
        this._cachedRestAt = 0;
        this._restCacheMs = 30000;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    getGatewayMs() {
        return readGatewayPing(this._client);
    }

    getGatewayMsStaleAware(maxStaleMs = GATEWAY_STALE_MS) {
        const gw = readGatewayPing(this._client);
        const now = Date.now();
        if (gw !== null) {
            this._lastGateway = gw;
            this._lastGatewayAt = now;
            return gw;
        }
        if (now - this._lastGatewayAt <= maxStaleMs && this._lastGateway !== null) {
            return this._lastGateway;
        }
        return null;
    }

    async getRestMs(useCache = true) {
        const now = Date.now();
        if (useCache && this._cachedRest !== null && now - this._cachedRestAt < this._restCacheMs) {
            return this._cachedRest;
        }
        const ms = await measureRestPing();
        if (ms !== null) {
            this._cachedRest = ms;
            this._cachedRestAt = now;
        }
        return ms;
    }

    async getFullPing() {
        const [gateway, rest] = await Promise.all([
            Promise.resolve(this.getGatewayMs()),
            this.getRestMs(true)
        ]);
        return { gateway: formatLatency(gateway), rest: formatLatency(rest) };
    }

    setRestCacheMs(ms) {
        this._restCacheMs = ms;
        return this;
    }
}

module.exports = { PingHelper, readGatewayPing, measureRestPing, formatLatency };
