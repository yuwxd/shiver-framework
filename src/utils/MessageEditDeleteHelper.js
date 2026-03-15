const { safeEdit, safeDelete } = require('./Helpers');

const DEFAULT_DEBOUNCE_MS = 120;

class MessageEditDeleteHelper {
    constructor(opts = {}) {
        this._debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this._pending = new Map();
        this._timers = new Map();
    }

    async edit(message, payload, opts = {}) {
        if (!message || payload == null) return null;
        const useDebounce = opts.debounce !== false && this._debounceMs > 0;
        const key = message.id ?? message;

        if (useDebounce) {
            this._pending.set(key, { message, payload, opts });
            if (!this._timers.has(key)) {
                const t = setTimeout(() => {
                    this._timers.delete(key);
                    const entry = this._pending.get(key);
                    this._pending.delete(key);
                    if (entry) this._flushEdit(entry.message, entry.payload, entry.opts);
                }, this._debounceMs);
                this._timers.set(key, t);
            }
            return Promise.resolve(null);
        }

        return safeEdit(message, payload, opts);
    }

    _flushEdit(message, payload, opts) {
        if (typeof message.edit !== 'function') return;
        safeEdit(message, payload, opts).catch(() => {});
    }

    async delete(message, opts = {}) {
        if (!message) return false;
        const key = message.id ?? message;
        this._pending.delete(key);
        const t = this._timers.get(key);
        if (t) {
            clearTimeout(t);
            this._timers.delete(key);
        }
        return safeDelete(message, opts);
    }

    flush(keyOrMessage) {
        const key = typeof keyOrMessage === 'string' ? keyOrMessage : keyOrMessage?.id;
        if (key == null) return;
        const t = this._timers.get(key);
        if (t) {
            clearTimeout(t);
            this._timers.delete(key);
        }
        const entry = this._pending.get(key);
        this._pending.delete(key);
        if (entry) this._flushEdit(entry.message, entry.payload, entry.opts);
    }

    flushAll() {
        for (const key of this._timers.keys()) this.flush(key);
    }

    destroy() {
        for (const t of this._timers.values()) clearTimeout(t);
        this._timers.clear();
        this._pending.clear();
    }
}

function createMessageEditDeleteHelper(opts) {
    return new MessageEditDeleteHelper(opts);
}

module.exports = {
    MessageEditDeleteHelper,
    createMessageEditDeleteHelper
};
