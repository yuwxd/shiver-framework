class AlertManager {
    constructor(stats, opts = {}) {
        this._stats = stats;
        this._alerts = new Map();
        this._lastTriggered = new Map();
        this._timer = null;
    }

    define(name, getter, threshold, handler, opts = {}) {
        this._alerts.set(name, {
            getter,
            threshold,
            handler,
            cooldownMs: opts.cooldownMs ?? 300000,
            compare: opts.compare ?? 'gt'
        });
        return this;
    }

    async checkAll() {
        for (const [name, alert] of this._alerts) {
            try {
                const value = typeof alert.getter === 'function'
                    ? await alert.getter(this._stats)
                    : alert.getter;

                const triggered = this._compare(value, alert.threshold, alert.compare);
                if (!triggered) continue;

                const lastAt = this._lastTriggered.get(name) ?? 0;
                if (Date.now() - lastAt < alert.cooldownMs) continue;

                this._lastTriggered.set(name, Date.now());
                await alert.handler({ name, value, threshold: alert.threshold });
            } catch (err) {
                console.error(`[AlertManager] Error checking alert "${name}":`, err?.message);
            }
        }
    }

    _compare(value, threshold, compare) {
        switch (compare) {
            case 'gt': return value > threshold;
            case 'gte': return value >= threshold;
            case 'lt': return value < threshold;
            case 'lte': return value <= threshold;
            case 'eq': return value === threshold;
            default: return value > threshold;
        }
    }

    startPolling(intervalMs = 60000) {
        this.stopPolling();
        this._timer = setInterval(() => this.checkAll(), intervalMs);
        return this;
    }

    stopPolling() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        return this;
    }

    destroy() {
        this.stopPolling();
        this._alerts.clear();
    }
}

module.exports = { AlertManager };
