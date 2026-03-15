const { MemoryCache } = require('../cache/MemoryCache');

class MessageEvents {
    constructor(framework) {
        this._framework = framework;
        this._deleteHandlers = [];
        this._updateHandlers = [];
        this._contentCache = null;
        this._registered = false;
    }

    onMessageDelete(handler, opts = {}) {
        this._deleteHandlers.push({ fn: handler, guildIds: opts.guildIds ?? null, channelIds: opts.channelIds ?? null, ignoreBots: opts.ignoreBots ?? false });
        return this;
    }

    onMessageUpdate(handler, opts = {}) {
        this._updateHandlers.push({ fn: handler, guildIds: opts.guildIds ?? null, channelIds: opts.channelIds ?? null, ignoreBots: opts.ignoreBots ?? false });
        return this;
    }

    registerListeners(client) {
        const opts = this._framework.options.messageEvents ?? {};

        if (opts.cacheEnabled) {
            this._contentCache = new MemoryCache({
                maxSize: opts.cacheMaxSize ?? 10000,
                ttlMs: opts.cacheTtlMs ?? 120000
            });

            client.on('messageCreate', (msg) => {
                if (msg.content) {
                    this._contentCache.set(msg.id, {
                        content: msg.content,
                        authorId: msg.author?.id,
                        channelId: msg.channelId,
                        timestamp: msg.createdTimestamp
                    });
                }
            });
        }

        if (this._deleteHandlers.length > 0) {
            client.on('messageDelete', (message) => {
                const cached = this._contentCache?.get(message.id) ?? null;
                if (cached) this._contentCache.delete(message.id);
                this._dispatch(this._deleteHandlers, message, null, cached);
            });
        }

        if (this._updateHandlers.length > 0) {
            client.on('messageUpdate', (oldMessage, newMessage) => {
                const cached = this._contentCache?.get(oldMessage.id) ?? null;
                if (newMessage.content && this._contentCache) {
                    this._contentCache.set(newMessage.id, {
                        content: newMessage.content,
                        authorId: newMessage.author?.id,
                        channelId: newMessage.channelId,
                        timestamp: newMessage.createdTimestamp
                    });
                }
                this._dispatch(this._updateHandlers, oldMessage, newMessage, cached);
            });
        }

        this._registered = true;
    }

    _dispatch(handlers, a, b, cached) {
        const runSync = this._framework.options.messageEvents?.runHandlersSync ?? false;
        for (const { fn, guildIds, channelIds, ignoreBots } of handlers) {
            const msg = a;
            if (ignoreBots && msg.author?.bot) continue;
            if (guildIds && !guildIds.includes(msg.guildId)) continue;
            if (channelIds && !channelIds.includes(msg.channelId)) continue;

            const run = async () => {
                try {
                    if (b !== null) {
                        await fn(a, b, cached);
                    } else {
                        await fn(a, cached);
                    }
                } catch (err) {
                    console.error('[MessageEvents] Handler error:', err?.message);
                }
            };

            if (runSync) {
                run();
            } else {
                setImmediate(() => run());
            }
        }
    }
}

module.exports = { MessageEvents };
