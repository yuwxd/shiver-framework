class EventHandler {
    constructor(opts) {
        this.id = opts.id ?? `handler_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.event = opts.event;
        this.handler = opts.handler;
        this.priority = opts.priority ?? 0;
        this.filters = opts.filters ?? [];
        this.once = opts.once ?? false;
        this.middleware = opts.middleware ?? [];
        this._callCount = 0;
    }

    async matches(args) {
        for (const filter of this.filters) {
            try {
                const result = await filter(...args);
                if (!result) return false;
            } catch (_) {
                return false;
            }
        }
        return true;
    }
}

class EventRouter {
    constructor(opts = {}) {
        this._handlers = new Map();
        this._globalMiddleware = [];
        this._client = null;
        this._attached = new Set();
        this._stopped = new Set();
        this._opts = opts;
        this._concurrency = opts.concurrency ?? 10;
        this._activeDispatches = 0;
        this._dispatchQueue = [];
        this._lowLatencyMode = opts.lowLatency ?? false;
        this._compressionThreshold = opts.compressionThreshold ?? 100;
        this._compressionWindowMs = opts.compressionWindowMs ?? 1000;
        this._compressionState = new Map();
        this._autocompleteHandlers = new Map();
        this._autocompleteCache = new Map();
        this._autocompleteCacheTtl = opts.autocompleteCacheTtl ?? 10000;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    use(middleware) {
        this._globalMiddleware.push(middleware);
        return this;
    }

    on(event, handler, opts = {}) {
        return this._register(event, handler, { ...opts, once: false });
    }

    once(event, handler, opts = {}) {
        return this._register(event, handler, { ...opts, once: true });
    }

    _register(event, handler, opts) {
        const entry = new EventHandler({ event, handler, ...opts });

        if (!this._handlers.has(event)) this._handlers.set(event, []);
        this._handlers.get(event).push(entry);
        this._handlers.get(event).sort((a, b) => b.priority - a.priority);

        if (this._client && !this._attached.has(event)) {
            this._attachToClient(event);
        }

        return entry.id;
    }

    _attachToClient(event) {
        if (!this._client || this._attached.has(event)) return;
        this._attached.add(event);

        this._client.on(event, async (...args) => {
            await this.dispatch(event, args);
        });
    }

    async dispatch(event, args) {
        if (this._shouldCompress(event, args)) return;
        return this._enqueueDispatch(event, args);
    }

    async _enqueueDispatch(event, args, meta = {}) {
        if (this._activeDispatches >= this._concurrency) {
            return new Promise((resolve, reject) => {
                this._dispatchQueue.push({ event, args, meta, resolve, reject });
            });
        }
        return this._dispatch(event, args, meta);
    }

    async _dispatch(event, args, meta = {}) {
        this._activeDispatches++;
        const handlers = this._handlers.get(event);
        if (!handlers || handlers.length === 0) {
            this._activeDispatches--;
            this._drainQueue();
            return;
        }

        const ctx = {
            event,
            args,
            stopped: false,
            compressed: meta.compressed ?? false,
            compressionCount: meta.compressionCount ?? 1,
            lowLatency: this._lowLatencyMode,
            stop() { this.stopped = true; }
        };

        try {
            if (!this._lowLatencyMode) {
                for (const mw of this._globalMiddleware) {
                    try { await mw(ctx); } catch (_) {}
                    if (ctx.stopped) return;
                }
            }

            const toRemove = [];

            for (const entry of handlers) {
                if (ctx.stopped) break;

                const matches = await entry.matches(args);
                if (!matches) continue;

                let proceed = true;
                if (!this._lowLatencyMode) {
                    for (const mw of entry.middleware) {
                        try {
                            const result = await mw(ctx, ...args);
                            if (result === false) { proceed = false; break; }
                        } catch (_) {
                            proceed = false;
                            break;
                        }
                    }
                }

                if (!proceed) continue;

                try {
                    entry._callCount++;
                    await entry.handler(...args, ctx);
                } catch (err) {
                    if (this._opts.onError) this._opts.onError(err, event, entry);
                }

                if (entry.once) toRemove.push(entry.id);
            }

            for (const id of toRemove) this.off(event, id);
        } finally {
            this._activeDispatches--;
            this._drainQueue();
        }
    }

    _drainQueue() {
        while (this._dispatchQueue.length > 0 && this._activeDispatches < this._concurrency) {
            const entry = this._dispatchQueue.shift();
            this._dispatch(entry.event, entry.args, entry.meta)
                .then(entry.resolve)
                .catch(entry.reject);
        }
    }

    _shouldCompress(event, args) {
        const now = Date.now();
        const state = this._compressionState.get(event) ?? {
            count: 0,
            startedAt: now,
            timer: null,
            args: null
        };

        if (now - state.startedAt > this._compressionWindowMs) {
            state.count = 0;
            state.startedAt = now;
        }

        state.count++;
        state.args = args;
        this._compressionState.set(event, state);

        if (state.count < this._compressionThreshold) return false;
        if (state.timer) return true;

        state.timer = setTimeout(async () => {
            const queuedState = this._compressionState.get(event);
            if (!queuedState) return;
            queuedState.timer = null;
            queuedState.count = 0;
            queuedState.startedAt = Date.now();
            await this._enqueueDispatch(event, queuedState.args, {
                compressed: true,
                compressionCount: state.count
            });
        }, 25);

        if (state.timer.unref) state.timer.unref();
        return true;
    }

    off(event, handlerId) {
        const handlers = this._handlers.get(event);
        if (!handlers) return false;
        const idx = handlers.findIndex(h => h.id === handlerId);
        if (idx === -1) return false;
        handlers.splice(idx, 1);
        return true;
    }

    offAll(event) {
        this._handlers.delete(event);
    }

    attachAll(client) {
        this._client = client;
        for (const event of this._handlers.keys()) {
            this._attachToClient(event);
        }
        return this;
    }

    setConcurrency(concurrency) {
        this._concurrency = Math.max(1, concurrency);
        this._drainQueue();
        return this;
    }

    setLowLatency(enabled = true) {
        this._lowLatencyMode = enabled;
        return this;
    }

    registerAutocomplete(name, handler, opts = {}) {
        this._autocompleteHandlers.set(name, { handler, cache: opts.cache !== false });
        return this;
    }

    async resolveAutocomplete(name, query, context = {}) {
        const entry = this._autocompleteHandlers.get(name);
        if (!entry) return [];
        const cacheKey = `${name}:${query}`;
        const now = Date.now();
        const cached = this._autocompleteCache.get(cacheKey);
        if (entry.cache && cached && cached.expiresAt > now) return cached.value;

        const value = await entry.handler(query, context);
        if (entry.cache) {
            this._autocompleteCache.set(cacheKey, {
                value,
                expiresAt: now + this._autocompleteCacheTtl
            });
        }
        return value;
    }

    filter(event, filterFn, opts = {}) {
        return {
            on: (handler, handlerOpts = {}) => this.on(event, handler, { ...handlerOpts, ...opts, filters: [...(opts.filters ?? []), filterFn] }),
            once: (handler, handlerOpts = {}) => this.once(event, handler, { ...handlerOpts, ...opts, filters: [...(opts.filters ?? []), filterFn] })
        };
    }

    inGuild(guildId) {
        return {
            on: (event, handler, opts = {}) => this.on(event, handler, {
                ...opts,
                filters: [...(opts.filters ?? []), (...args) => {
                    const obj = args[0];
                    return (obj?.guildId ?? obj?.guild?.id) === guildId;
                }]
            })
        };
    }

    fromUser(userId) {
        return {
            on: (event, handler, opts = {}) => this.on(event, handler, {
                ...opts,
                filters: [...(opts.filters ?? []), (...args) => {
                    const obj = args[0];
                    return (obj?.author?.id ?? obj?.user?.id) === userId;
                }]
            })
        };
    }

    inChannel(channelId) {
        return {
            on: (event, handler, opts = {}) => this.on(event, handler, {
                ...opts,
                filters: [...(opts.filters ?? []), (...args) => {
                    const obj = args[0];
                    return (obj?.channelId ?? obj?.channel?.id) === channelId;
                }]
            })
        };
    }

    notFromBot() {
        return {
            on: (event, handler, opts = {}) => this.on(event, handler, {
                ...opts,
                filters: [...(opts.filters ?? []), (...args) => {
                    const obj = args[0];
                    return !(obj?.author?.bot ?? obj?.user?.bot ?? false);
                }]
            })
        };
    }

    getStats() {
        const stats = {};
        for (const [event, handlers] of this._handlers) {
            stats[event] = {
                count: handlers.length,
                totalCalls: handlers.reduce((s, h) => s + h._callCount, 0)
            };
        }
        return {
            events: stats,
            concurrency: this._concurrency,
            activeDispatches: this._activeDispatches,
            queuedDispatches: this._dispatchQueue.length,
            lowLatencyMode: this._lowLatencyMode,
            autocompleteHandlers: this._autocompleteHandlers.size
        };
    }

    destroy() {
        this._handlers.clear();
        this._globalMiddleware = [];
        this._dispatchQueue = [];
        this._autocompleteHandlers.clear();
        this._autocompleteCache.clear();
        for (const state of this._compressionState.values()) {
            if (state.timer) clearTimeout(state.timer);
        }
        this._compressionState.clear();
    }
}

module.exports = { EventRouter, EventHandler };
