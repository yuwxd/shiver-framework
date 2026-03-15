const { safeError } = require('../security/redact');

class EventBus {
    constructor() {
        this._handlers = new Map();
    }

    on(eventName, handler) {
        if (!this._handlers.has(eventName)) this._handlers.set(eventName, []);
        this._handlers.get(eventName).push({ fn: handler, once: false });
        return this;
    }

    once(eventName, handler) {
        if (!this._handlers.has(eventName)) this._handlers.set(eventName, []);
        this._handlers.get(eventName).push({ fn: handler, once: true });
        return this;
    }

    off(eventName, handler) {
        if (!this._handlers.has(eventName)) return this;
        const list = this._handlers.get(eventName).filter(h => h.fn !== handler);
        if (list.length === 0) this._handlers.delete(eventName);
        else this._handlers.set(eventName, list);
        return this;
    }

    async emit(eventName, payload) {
        if (!this._handlers.has(eventName)) return;
        const list = [...this._handlers.get(eventName)];
        const remaining = [];
        for (const entry of list) {
            try {
                await entry.fn(payload);
            } catch (err) {
                safeError('EventBus', err);
            }
            if (!entry.once) remaining.push(entry);
        }
        if (remaining.length === 0) this._handlers.delete(eventName);
        else this._handlers.set(eventName, remaining);
    }

    emitSync(eventName, payload) {
        if (!this._handlers.has(eventName)) return;
        const list = [...this._handlers.get(eventName)];
        const remaining = [];
        for (const entry of list) {
            try {
                entry.fn(payload);
            } catch (err) {
                safeError('EventBus', err);
            }
            if (!entry.once) remaining.push(entry);
        }
        if (remaining.length === 0) this._handlers.delete(eventName);
        else this._handlers.set(eventName, remaining);
    }

    removeAllListeners(eventName) {
        if (eventName) this._handlers.delete(eventName);
        else this._handlers.clear();
        return this;
    }
}

module.exports = { EventBus };
