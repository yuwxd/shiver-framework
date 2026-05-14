class ConversationContext {
    constructor(opts = {}) {
        this._maxMessages = opts.maxMessages ?? 50;
        this._ttlMs = opts.ttlMs ?? 3600000;
        this._store = new Map();
        this._cleanupInterval = setInterval(() => this._cleanup(), 300000);
    }

    add(channelId, message) {
        const entry = this._getOrCreate(channelId);
        entry.messages.push({
            role: message.role ?? 'user',
            content: message.content,
            userId: message.userId ?? null,
            timestamp: message.timestamp ?? Date.now()
        });
        if (entry.messages.length > this._maxMessages) {
            entry.messages = entry.messages.slice(-this._maxMessages);
        }
        entry.updatedAt = Date.now();
    }

    get(channelId, limit) {
        const entry = this._store.get(channelId);
        if (!entry || this._isExpired(entry)) return [];
        const msgs = entry.messages;
        return limit ? msgs.slice(-limit) : [...msgs];
    }

    toMessages(channelId, limit) {
        return this.get(channelId, limit).map(({ role, content }) => ({ role, content }));
    }

    clear(channelId) {
        if (channelId) {
            this._store.delete(channelId);
        } else {
            this._store.clear();
        }
    }

    size(channelId) {
        return this.get(channelId).length;
    }

    _getOrCreate(channelId) {
        let entry = this._store.get(channelId);
        if (!entry || this._isExpired(entry)) {
            entry = { messages: [], updatedAt: Date.now() };
            this._store.set(channelId, entry);
        }
        return entry;
    }

    _isExpired(entry) {
        return Date.now() - entry.updatedAt > this._ttlMs;
    }

    _cleanup() {
        for (const [id, entry] of this._store) {
            if (this._isExpired(entry)) this._store.delete(id);
        }
    }

    destroy() {
        clearInterval(this._cleanupInterval);
        this._store.clear();
    }
}

module.exports = { ConversationContext };
