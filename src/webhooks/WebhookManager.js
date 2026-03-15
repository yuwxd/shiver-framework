const { EventEmitter } = require('events');

class WebhookManager extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._client = null;
        this._cache = new Map();
        this._rateLimits = new Map();
        this._defaultAvatar = opts.defaultAvatar ?? null;
        this._defaultUsername = opts.defaultUsername ?? null;
        this._maxRetries = opts.maxRetries ?? 3;
        this._retryDelay = opts.retryDelay ?? 1000;
        this._queue = new Map();
        this._opts = opts;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    async create(channel, opts = {}) {
        const { name, avatar, reason } = opts;
        if (!name) throw new Error('Webhook name is required');
        const webhook = await channel.createWebhook({ name, avatar, reason });
        this._cache.set(webhook.id, webhook);
        this.emit('create', webhook);
        return webhook;
    }

    async fetch(webhookId, token) {
        const cached = this._cache.get(webhookId);
        if (cached) return cached;
        if (!this._client) throw new Error('Client not initialized');
        const webhook = token
            ? await this._client.fetchWebhook(webhookId, token)
            : await this._client.fetchWebhook(webhookId);
        this._cache.set(webhookId, webhook);
        return webhook;
    }

    async fetchForChannel(channel) {
        const webhooks = await channel.fetchWebhooks();
        for (const webhook of webhooks.values()) {
            this._cache.set(webhook.id, webhook);
        }
        return webhooks;
    }

    async fetchForGuild(guild) {
        const webhooks = await guild.fetchWebhooks();
        for (const webhook of webhooks.values()) {
            this._cache.set(webhook.id, webhook);
        }
        return webhooks;
    }

    async send(webhookOrId, payload, opts = {}) {
        let webhook;
        if (typeof webhookOrId === 'string') {
            webhook = await this.fetch(webhookOrId, opts.token);
        } else {
            webhook = webhookOrId;
        }

        const sendPayload = { ...payload };
        if (opts.username ?? this._defaultUsername) sendPayload.username = opts.username ?? this._defaultUsername;
        if (opts.avatarURL ?? this._defaultAvatar) sendPayload.avatarURL = opts.avatarURL ?? this._defaultAvatar;
        if (opts.threadId) sendPayload.threadId = opts.threadId;

        return this._sendWithRetry(webhook, sendPayload);
    }

    async _sendWithRetry(webhook, payload, attempt = 0) {
        try {
            const message = await webhook.send(payload);
            this.emit('send', webhook, message);
            return message;
        } catch (e) {
            if (e.status === 429 && attempt < this._maxRetries) {
                const retryAfter = (e.retryAfter ?? 1) * 1000;
                await new Promise(resolve => setTimeout(resolve, retryAfter));
                return this._sendWithRetry(webhook, payload, attempt + 1);
            }
            if ((e.status >= 500 || e.code === 'ECONNRESET') && attempt < this._maxRetries) {
                await new Promise(resolve => setTimeout(resolve, this._retryDelay * Math.pow(2, attempt)));
                return this._sendWithRetry(webhook, payload, attempt + 1);
            }
            this.emit('error', e, webhook);
            throw e;
        }
    }

    async edit(webhookOrId, opts = {}) {
        let webhook;
        if (typeof webhookOrId === 'string') {
            webhook = await this.fetch(webhookOrId, opts.token);
        } else {
            webhook = webhookOrId;
        }
        const edited = await webhook.edit(opts);
        this._cache.set(edited.id, edited);
        this.emit('edit', edited);
        return edited;
    }

    async editMessage(webhook, messageId, payload, opts = {}) {
        return webhook.editMessage(messageId, { ...payload, threadId: opts.threadId });
    }

    async deleteMessage(webhook, messageId, opts = {}) {
        return webhook.deleteMessage(messageId, opts.threadId);
    }

    async delete(webhookOrId, reason) {
        let webhook;
        if (typeof webhookOrId === 'string') {
            webhook = await this.fetch(webhookOrId);
        } else {
            webhook = webhookOrId;
        }
        await webhook.delete(reason);
        this._cache.delete(webhook.id);
        this.emit('delete', webhook);
    }

    async getOrCreate(channel, name, opts = {}) {
        const webhooks = await this.fetchForChannel(channel);
        const existing = webhooks.find(w => w.name === name && w.owner?.id === this._client?.user?.id);
        if (existing) return existing;
        return this.create(channel, { name, ...opts });
    }

    async sendToUrl(url, payload) {
        const { WebhookClient } = require('discord.js');
        const client = new WebhookClient({ url });
        try {
            return await client.send(payload);
        } finally {
            client.destroy();
        }
    }

    async sendBatch(webhook, messages, opts = {}) {
        const delay = opts.delay ?? 500;
        const results = [];
        for (const msg of messages) {
            const result = await this.send(webhook, msg, opts);
            results.push(result);
            if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        }
        return results;
    }

    invalidateCache(webhookId) {
        this._cache.delete(webhookId);
        return this;
    }

    clearCache() {
        this._cache.clear();
        return this;
    }

    getCached(webhookId) {
        return this._cache.get(webhookId) ?? null;
    }

    getStats() {
        return { cached: this._cache.size };
    }
}

module.exports = { WebhookManager };
