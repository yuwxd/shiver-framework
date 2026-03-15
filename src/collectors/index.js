const { ComponentType } = require('discord.js');

class BaseCollector {
    constructor(opts = {}) {
        this._timeout = opts.timeout ?? 60000;
        this._idle = opts.idle ?? null;
        this._max = opts.max ?? null;
        this._maxProcessed = opts.maxProcessed ?? null;
        this._filter = opts.filter ?? (() => true);
        this._collected = new Map();
        this._ended = false;
        this._endReason = null;
        this._listeners = { collect: [], ignore: [], end: [], dispose: [] };
        this._timer = null;
        this._idleTimer = null;
        this._startTime = Date.now();
    }

    on(event, listener) {
        if (this._listeners[event]) this._listeners[event].push(listener);
        return this;
    }

    off(event, listener) {
        if (this._listeners[event]) {
            this._listeners[event] = this._listeners[event].filter(l => l !== listener);
        }
        return this;
    }

    once(event, listener) {
        const wrapper = (...args) => { listener(...args); this.off(event, wrapper); };
        return this.on(event, wrapper);
    }

    _emit(event, ...args) {
        for (const listener of (this._listeners[event] ?? [])) {
            listener(...args);
        }
    }

    _startTimers() {
        if (this._timeout) {
            this._timer = setTimeout(() => this.stop('time'), this._timeout);
        }
        if (this._idle) {
            this._resetIdleTimer();
        }
    }

    _resetIdleTimer() {
        if (this._idleTimer) clearTimeout(this._idleTimer);
        if (this._idle) {
            this._idleTimer = setTimeout(() => this.stop('idle'), this._idle);
        }
    }

    _clearTimers() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    }

    async _handleCollect(item) {
        let passed = false;
        try { passed = await this._filter(item); } catch (_) {}
        if (!passed) {
            this._emit('ignore', item);
            return;
        }
        this._collected.set(this._getKey(item), item);
        this._emit('collect', item, this._collected);
        this._resetIdleTimer();

        if (this._max && this._collected.size >= this._max) {
            this.stop('limit');
        }
    }

    _getKey(item) {
        return item.id ?? String(Date.now());
    }

    stop(reason = 'user') {
        if (this._ended) return;
        this._ended = true;
        this._endReason = reason;
        this._clearTimers();
        this._cleanup();
        this._emit('end', this._collected, reason);
    }

    _cleanup() {}

    get collected() { return new Map(this._collected); }
    get ended() { return this._ended; }
    get endReason() { return this._endReason; }
    get size() { return this._collected.size; }
    get first() { return this._collected.values().next().value ?? null; }
    get last() { return [...this._collected.values()].pop() ?? null; }

    toArray() { return [...this._collected.values()]; }

    await() {
        return new Promise((resolve) => {
            this.on('end', (collected, reason) => resolve({ collected, reason }));
        });
    }

    awaitFirst() {
        return new Promise((resolve, reject) => {
            this.once('collect', (item) => resolve(item));
            this.once('end', (_, reason) => {
                if (reason !== 'user') reject(new Error(`Collector ended: ${reason}`));
            });
        });
    }
}

class ComponentCollector extends BaseCollector {
    constructor(message, opts = {}) {
        super(opts);
        this._message = message;
        this._componentType = opts.componentType ?? null;
        this._handler = this._handleCollect.bind(this);
        this._message.client.on('interactionCreate', this._handler);
        this._startTimers();
    }

    async _handleCollect(interaction) {
        if (!interaction.isMessageComponent()) return;
        if (interaction.message.id !== this._message.id) return;
        if (this._componentType && interaction.componentType !== this._componentType) return;
        await super._handleCollect(interaction);
    }

    _getKey(interaction) {
        return interaction.id;
    }

    _cleanup() {
        this._message.client.removeListener('interactionCreate', this._handler);
    }

    static create(message, opts = {}) {
        return new ComponentCollector(message, opts);
    }

    static createButton(message, opts = {}) {
        return new ComponentCollector(message, { ...opts, componentType: ComponentType.Button });
    }

    static createSelect(message, opts = {}) {
        return new ComponentCollector(message, { ...opts, componentType: ComponentType.StringSelect });
    }

    static createModal(client, opts = {}) {
        return new ModalCollector(client, opts);
    }
}

class MessageCollector extends BaseCollector {
    constructor(channel, opts = {}) {
        super(opts);
        this._channel = channel;
        this._handler = this._handleCollect.bind(this);
        this._deleteHandler = this._handleDelete.bind(this);
        this._channel.client.on('messageCreate', this._handler);
        if (opts.dispose) this._channel.client.on('messageDelete', this._deleteHandler);
        this._startTimers();
    }

    async _handleCollect(message) {
        if (message.channel.id !== this._channel.id) return;
        await super._handleCollect(message);
    }

    _handleDelete(message) {
        if (!this._collected.has(message.id)) return;
        this._collected.delete(message.id);
        this._emit('dispose', message, this._collected);
    }

    _getKey(message) {
        return message.id;
    }

    _cleanup() {
        this._channel.client.removeListener('messageCreate', this._handler);
        this._channel.client.removeListener('messageDelete', this._deleteHandler);
    }

    static create(channel, opts = {}) {
        return new MessageCollector(channel, opts);
    }

    static awaitMessage(channel, opts = {}) {
        const collector = new MessageCollector(channel, { max: 1, ...opts });
        return collector.awaitFirst();
    }
}

class ReactionCollector extends BaseCollector {
    constructor(message, opts = {}) {
        super(opts);
        this._message = message;
        this._addHandler = this._handleAdd.bind(this);
        this._removeHandler = this._handleRemove.bind(this);
        this._message.client.on('messageReactionAdd', this._addHandler);
        if (opts.dispose) this._message.client.on('messageReactionRemove', this._removeHandler);
        this._startTimers();
    }

    async _handleAdd(reaction, user) {
        if (reaction.message.id !== this._message.id) return;
        if (user.bot && !this._opts?.allowBots) return;
        await super._handleCollect({ reaction, user, id: `${reaction.emoji.name ?? reaction.emoji.id}:${user.id}` });
    }

    _handleRemove(reaction, user) {
        if (reaction.message.id !== this._message.id) return;
        const key = `${reaction.emoji.name ?? reaction.emoji.id}:${user.id}`;
        if (!this._collected.has(key)) return;
        this._collected.delete(key);
        this._emit('dispose', { reaction, user }, this._collected);
    }

    _getKey(item) {
        return item.id;
    }

    _cleanup() {
        this._message.client.removeListener('messageReactionAdd', this._addHandler);
        this._message.client.removeListener('messageReactionRemove', this._removeHandler);
    }

    static create(message, opts = {}) {
        return new ReactionCollector(message, opts);
    }
}

class ModalCollector extends BaseCollector {
    constructor(client, opts = {}) {
        super(opts);
        this._client = client;
        this._customId = opts.customId ?? null;
        this._userId = opts.userId ?? null;
        this._handler = this._handleCollect.bind(this);
        this._client.on('interactionCreate', this._handler);
        this._startTimers();
    }

    async _handleCollect(interaction) {
        if (!interaction.isModalSubmit()) return;
        if (this._customId && interaction.customId !== this._customId) return;
        if (this._userId && interaction.user.id !== this._userId) return;
        await super._handleCollect(interaction);
    }

    _getKey(interaction) {
        return interaction.id;
    }

    _cleanup() {
        this._client.removeListener('interactionCreate', this._handler);
    }

    static create(client, opts = {}) {
        return new ModalCollector(client, opts);
    }

    static await(client, opts = {}) {
        const collector = new ModalCollector(client, { max: 1, ...opts });
        return collector.awaitFirst();
    }
}

async function awaitComponent(message, opts = {}) {
    return new Promise((resolve, reject) => {
        const collector = new ComponentCollector(message, { max: 1, ...opts });
        collector.once('collect', resolve);
        collector.once('end', (_, reason) => {
            if (reason !== 'user') reject(new Error(`Collector ended: ${reason}`));
        });
    });
}

async function awaitMessage(channel, opts = {}) {
    return MessageCollector.awaitMessage(channel, opts);
}

async function awaitReaction(message, opts = {}) {
    return new Promise((resolve, reject) => {
        const collector = new ReactionCollector(message, { max: 1, ...opts });
        collector.once('collect', resolve);
        collector.once('end', (_, reason) => {
            if (reason !== 'user') reject(new Error(`Collector ended: ${reason}`));
        });
    });
}

module.exports = {
    BaseCollector, ComponentCollector, MessageCollector,
    ReactionCollector, ModalCollector,
    awaitComponent, awaitMessage, awaitReaction
};
