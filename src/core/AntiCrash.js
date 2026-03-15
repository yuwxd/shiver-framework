const { EventEmitter } = require('events');

class AntiCrash extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._framework = null;
        this._enabled = opts.enabled !== false;
        this._exitOnCritical = opts.exitOnCritical ?? false;
        this._memoryThreshold = opts.memoryThreshold ?? 512 * 1024 * 1024;
        this._memoryCheckInterval = opts.memoryCheckInterval ?? 30000;
        this._listenerThreshold = opts.listenerThreshold ?? 25;
        this._watchEmitters = opts.watchEmitters ?? [];
        this._errors = [];
        this._maxErrors = opts.maxErrors ?? 200;
        this._memoryAlerts = [];
        this._listenerAlerts = [];
        this._memoryTimer = null;
        this._rejectionHandler = (reason) => this._handleError('unhandledRejection', reason);
        this._exceptionHandler = (error) => this._handleError('uncaughtException', error);
        this._webhook = this._resolveWebhook(opts.webhook);
    }

    attach(framework) {
        this.detach();
        this._framework = framework ?? null;
        if (!this._enabled) return this;

        process.on('unhandledRejection', this._rejectionHandler);
        process.on('uncaughtException', this._exceptionHandler);

        this._memoryTimer = setInterval(() => {
            this._checkMemory();
            this._checkListenerLeaks();
        }, this._memoryCheckInterval);

        if (this._memoryTimer.unref) this._memoryTimer.unref();
        return this;
    }

    detach() {
        process.off('unhandledRejection', this._rejectionHandler);
        process.off('uncaughtException', this._exceptionHandler);
        if (this._memoryTimer) clearInterval(this._memoryTimer);
        this._memoryTimer = null;
        this._framework = null;
        return this;
    }

    enable() {
        this._enabled = true;
        return this;
    }

    disable() {
        this._enabled = false;
        this.detach();
        return this;
    }

    watchEmitter(emitter, name = 'emitter') {
        this._watchEmitters.push({ emitter, name });
        return this;
    }

    getStats() {
        return {
            enabled: this._enabled,
            errorsCaptured: this._errors.length,
            memoryAlerts: this._memoryAlerts.length,
            listenerAlerts: this._listenerAlerts.length,
            lastError: this._errors[this._errors.length - 1] ?? null,
            lastMemoryAlert: this._memoryAlerts[this._memoryAlerts.length - 1] ?? null,
            lastListenerAlert: this._listenerAlerts[this._listenerAlerts.length - 1] ?? null
        };
    }

    _handleError(type, error) {
        const entry = {
            id: `crash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type,
            timestamp: Date.now(),
            message: error?.message ?? String(error ?? 'Unknown error'),
            stack: error?.stack ?? null,
            traceId: error?.traceId ?? null
        };

        this._errors.push(entry);
        if (this._errors.length > this._maxErrors) this._errors.shift();

        if (this._framework?.stats?.recordError) {
            this._framework.stats.recordError(type, error, { traceId: entry.traceId, type });
        }

        this.emit('errorCaptured', entry);
        this._sendWebhook('errorCaptured', entry);

        if (this._exitOnCritical) {
            setImmediate(() => process.exit(1));
        }
    }

    _checkMemory() {
        const usage = process.memoryUsage();
        if (usage.heapUsed < this._memoryThreshold) return;

        const alert = {
            timestamp: Date.now(),
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            rss: usage.rss,
            external: usage.external
        };

        this._memoryAlerts.push(alert);
        if (this._memoryAlerts.length > this._maxErrors) this._memoryAlerts.shift();
        this.emit('memoryLeakDetected', alert);
        this._sendWebhook('memoryLeakDetected', alert);
    }

    _checkListenerLeaks() {
        const emitters = [];
        if (this._framework?.events) emitters.push({ emitter: this._framework.events, name: 'framework.events' });
        if (this._framework?.client) emitters.push({ emitter: this._framework.client, name: 'framework.client' });
        emitters.push(...this._watchEmitters);

        for (const item of emitters) {
            if (!item?.emitter?.eventNames) continue;
            for (const eventName of item.emitter.eventNames()) {
                const count = item.emitter.listenerCount(eventName);
                if (count <= this._listenerThreshold) continue;

                const alert = {
                    timestamp: Date.now(),
                    emitter: item.name,
                    eventName,
                    listenerCount: count,
                    threshold: this._listenerThreshold
                };

                this._listenerAlerts.push(alert);
                if (this._listenerAlerts.length > this._maxErrors) this._listenerAlerts.shift();
                this.emit('listenerLeakDetected', alert);
                this._sendWebhook('listenerLeakDetected', alert);
            }
        }
    }

    _resolveWebhook(webhook) {
        if (!webhook) return null;
        if (typeof webhook?.send === 'function') return webhook;
        if (typeof webhook === 'string') {
            try {
                const { WebhookClient } = require('discord.js');
                return new WebhookClient({ url: webhook });
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    _sendWebhook(event, payload) {
        if (!this._webhook?.send) return;
        this._webhook.send({
            content: `\`${event}\` ${JSON.stringify(payload).slice(0, 1800)}`
        }).catch(() => {});
    }
}

module.exports = { AntiCrash };
