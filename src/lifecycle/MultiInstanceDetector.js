const path = require('path');

const KEY_PREFIX = 'fw:inst:';
const HEARTBEAT_TTL_SEC = 30;
const HEARTBEAT_INTERVAL_MS = 10000;
const CHECK_INTERVAL_MS = 15000;

function simpleHash(str) {
    if (!str || typeof str !== 'string') return 'default';
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h = ((h << 5) - h) + c;
        h = h & h;
    }
    return Math.abs(h).toString(36).slice(0, 12);
}

function getProcessMatchPattern(options) {
    const custom = options?.multiInstance?.processMatchPattern;
    if (typeof custom === 'string' && custom) return custom;
    const cwd = process.cwd();
    const cwdName = path.basename(cwd);
    if (cwdName) return cwdName;
    const main = process.argv[1] || '';
    return path.basename(main) || 'node';
}

class MultiInstanceDetector {
    constructor(framework) {
        this._framework = framework;
        this._options = framework.options || {};
        this._groupId = this._options?.multiInstance?.groupId || simpleHash(process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || '');
        this._pid = process.pid;
        this._multipleInstances = false;
        this._redis = undefined;
        this._redisTried = false;
        this._connected = false;
        this._heartbeatTimer = null;
        this._checkTimer = null;
        this._processMatchPattern = getProcessMatchPattern(this._options);
    }

    _getRedisUrl() {
        return (process.env.REDIS_URL || process.env.REDIS_URI || '').trim() || null;
    }

    async _ensureRedis() {
        if (this._redisTried) return this._connected;
        this._redisTried = true;
        const url = this._getRedisUrl();
        if (!url) {
            this._connected = false;
            return false;
        }
        try {
            const { createClient } = require('redis');
            this._redis = createClient({
                url,
                socket: {
                    connectTimeout: 5000,
                    reconnectStrategy: (retries) => (retries > 3 ? new Error('Max reconnects') : 1000)
                }
            });
            this._redis.on('error', () => {});
            await this._redis.connect();
            this._connected = true;
            return true;
        } catch (_) {
            this._redis = null;
            this._connected = false;
            return false;
        }
    }

    _heartbeatKey() {
        return `${KEY_PREFIX}${this._groupId}:${this._pid}`;
    }

    _keysPattern() {
        return `${KEY_PREFIX}${this._groupId}:*`;
    }

    async _sendHeartbeat() {
        if (!this._redis || !this._connected) return;
        try {
            await this._redis.set(this._heartbeatKey(), '1', { EX: HEARTBEAT_TTL_SEC });
        } catch (_) {}
    }

    async _checkCount() {
        if (!this._redis || !this._connected) return;
        try {
            const keys = await this._redis.keys(this._keysPattern());
            this._multipleInstances = keys.length > 1;
        } catch (_) {
            this._multipleInstances = false;
        }
    }

    start() {
        const run = async () => {
            const ok = await this._ensureRedis();
            if (!ok) return;
            await this._sendHeartbeat();
            this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
            this._heartbeatTimer.unref?.();
            await this._checkCount();
            this._checkTimer = setInterval(() => this._checkCount(), CHECK_INTERVAL_MS);
            this._checkTimer.unref?.();
        };
        run().catch(() => {});
    }

    stop() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        if (this._checkTimer) {
            clearInterval(this._checkTimer);
            this._checkTimer = null;
        }
        if (this._redis && this._connected) {
            this._redis.del(this._heartbeatKey()).catch(() => {});
            this._redis.quit().catch(() => {});
            this._redis = null;
            this._connected = false;
        }
    }

    isMultiple() {
        return this._multipleInstances === true;
    }

    logWarning() {
        const pattern = this._processMatchPattern.replace(/"/g, '\\"');
        const cmd = `pkill -f "node.*${pattern}"`;
        console.warn(
            '[ShiverFramework] Multiple bot instances detected. Only one instance should run. ' +
            `To stop all instances run: ${cmd} then start the bot again.`
        );
    }
}

function createMultiInstanceDetector(framework) {
    const opts = framework?.options?.multiInstance;
    if (!opts) return null;
    if (opts === false) return null;
    return new MultiInstanceDetector(framework);
}

module.exports = { MultiInstanceDetector, createMultiInstanceDetector, getProcessMatchPattern };
