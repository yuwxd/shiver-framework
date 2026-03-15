const { EventEmitter } = require('events');

function createMockInteraction(overrides = {}) {
    const userId = overrides.userId ?? '123456789012345678';
    const guildId = overrides.guildId ?? '987654321098765432';
    const channelId = overrides.channelId ?? '111111111111111111';

    const replied = { value: false };
    const deferred = { value: false };

    return {
        id: overrides.id ?? '000000000000000001',
        commandName: overrides.commandName ?? 'test',
        guildId,
        channelId,
        user: { id: userId, username: 'TestUser', bot: false, ...overrides.user },
        member: overrides.member ?? { id: userId, permissions: { has: () => true } },
        guild: overrides.guild ?? { id: guildId, name: 'Test Guild' },
        channel: overrides.channel ?? { id: channelId, name: 'test-channel' },
        options: {
            getString: (name) => overrides.options?.[name] ?? null,
            getInteger: (name) => overrides.options?.[name] ?? null,
            getNumber: (name) => overrides.options?.[name] ?? null,
            getBoolean: (name) => overrides.options?.[name] ?? null,
            getUser: (name) => overrides.options?.[name] ?? null,
            getChannel: (name) => overrides.options?.[name] ?? null,
            getRole: (name) => overrides.options?.[name] ?? null,
            getAttachment: (name) => overrides.options?.[name] ?? null,
            getMentionable: (name) => overrides.options?.[name] ?? null,
            getSubcommand: (required) => overrides.subcommand ?? (required ? null : null),
            getSubcommandGroup: (required) => overrides.subcommandGroup ?? (required ? null : null),
            data: overrides.optionsData ?? []
        },
        get replied() { return replied.value; },
        get deferred() { return deferred.value; },
        isChatInputCommand: () => overrides.type === 'slash' || overrides.type === undefined,
        isButton: () => overrides.type === 'button',
        isStringSelectMenu: () => overrides.type === 'select',
        isModalSubmit: () => overrides.type === 'modal',
        isAutocomplete: () => overrides.type === 'autocomplete',
        isContextMenuCommand: () => overrides.type === 'contextMenu',
        isAnySelectMenu: () => overrides.type === 'select',
        customId: overrides.customId ?? null,
        values: overrides.values ?? [],
        fields: {
            getTextInputValue: (id) => overrides.fields?.[id] ?? ''
        },
        reply: async (payload) => {
            replied.value = true;
            if (overrides.onReply) overrides.onReply(payload);
            return payload;
        },
        editReply: async (payload) => {
            if (overrides.onEditReply) overrides.onEditReply(payload);
            return payload;
        },
        deferReply: async (opts) => {
            deferred.value = true;
            if (overrides.onDeferReply) overrides.onDeferReply(opts);
        },
        deferUpdate: async () => {
            deferred.value = true;
        },
        followUp: async (payload) => {
            if (overrides.onFollowUp) overrides.onFollowUp(payload);
            return payload;
        },
        fetchReply: async () => overrides.fetchReply ?? null,
        respond: async (choices) => {
            if (overrides.onRespond) overrides.onRespond(choices);
        },
        showModal: async (modal) => {
            if (overrides.onShowModal) overrides.onShowModal(modal);
        },
        update: async (payload) => {
            if (overrides.onUpdate) overrides.onUpdate(payload);
            return payload;
        },
        ...overrides.extra
    };
}

function createMockMessage(overrides = {}) {
    const userId = overrides.userId ?? '123456789012345678';
    const guildId = overrides.guildId ?? '987654321098765432';
    const channelId = overrides.channelId ?? '111111111111111111';

    const reactions = new Map();

    return {
        id: overrides.id ?? '000000000000000002',
        content: overrides.content ?? ',test',
        guildId,
        channelId,
        author: { id: userId, username: 'TestUser', bot: false, ...overrides.author },
        member: overrides.member ?? { id: userId, permissions: { has: () => true } },
        guild: overrides.guild ?? { id: guildId, name: 'Test Guild' },
        channel: overrides.channel ?? { id: channelId, name: 'test-channel', send: async (p) => createMockMessage({ content: typeof p === 'string' ? p : p?.content ?? '' }) },
        attachments: new Map(overrides.attachments ?? []),
        embeds: overrides.embeds ?? [],
        components: overrides.components ?? [],
        createdTimestamp: overrides.createdTimestamp ?? Date.now(),
        reactions: {
            cache: reactions,
            resolve: (emoji) => reactions.get(emoji) ?? null
        },
        reply: async (payload) => {
            if (overrides.onReply) overrides.onReply(payload);
            return createMockMessage({ content: typeof payload === 'string' ? payload : payload?.content ?? '' });
        },
        edit: async (payload) => {
            if (overrides.onEdit) overrides.onEdit(payload);
            return createMockMessage({ content: typeof payload === 'string' ? payload : payload?.content ?? '', id: overrides.id });
        },
        delete: async () => {
            if (overrides.onDelete) overrides.onDelete();
        },
        react: async (emoji) => {
            const existing = reactions.get(emoji) ?? { emoji: { name: emoji }, count: 0, users: { cache: new Map() } };
            existing.count++;
            reactions.set(emoji, existing);
            if (overrides.onReact) overrides.onReact(emoji);
            return existing;
        },
        pin: async () => { if (overrides.onPin) overrides.onPin(); },
        unpin: async () => { if (overrides.onUnpin) overrides.onUnpin(); },
        fetch: async () => createMockMessage(overrides),
        ...overrides.extra
    };
}

function createMockGuild(overrides = {}) {
    return {
        id: overrides.id ?? '987654321098765432',
        name: overrides.name ?? 'Test Guild',
        memberCount: overrides.memberCount ?? 100,
        ownerId: overrides.ownerId ?? '123456789012345678',
        premiumSubscriptionCount: overrides.premiumSubscriptionCount ?? 0,
        premiumTier: overrides.premiumTier ?? 0,
        members: {
            cache: new Map(overrides.members ?? []),
            fetch: async (id) => overrides.members?.find(([k]) => k === id)?.[1] ?? null
        },
        channels: {
            cache: new Map(overrides.channels ?? []),
            fetch: async (id) => overrides.channels?.find(([k]) => k === id)?.[1] ?? null,
            create: async (opts) => createMockChannel({ name: opts.name, type: opts.type })
        },
        roles: {
            cache: new Map(overrides.roles ?? []),
            fetch: async (id) => overrides.roles?.find(([k]) => k === id)?.[1] ?? null,
            create: async (opts) => createMockRole({ name: opts.name })
        },
        bans: {
            cache: new Map(),
            create: async (userId, opts) => ({ userId, ...opts }),
            delete: async (userId) => userId,
            fetch: async (userId) => null
        },
        invites: {
            create: async (channel, opts) => ({ code: 'TESTCODE', url: 'https://discord.gg/TESTCODE', ...opts }),
            fetch: async () => new Map()
        },
        voiceAdapterCreator: () => ({}),
        setVerificationLevel: async (level) => ({ ...createMockGuild(overrides), verificationLevel: level }),
        fetchAuditLogs: async (opts) => ({ entries: new Map() }),
        ...overrides.extra
    };
}

function createMockClient(overrides = {}) {
    return {
        user: { id: overrides.userId ?? '000000000000000000', username: 'TestBot', bot: true },
        ws: { ping: overrides.ping ?? 50, status: 0, shards: new Map() },
        guilds: { cache: new Map(overrides.guilds ?? []) },
        users: {
            cache: new Map(overrides.users ?? []),
            fetch: async (id) => ({ id, username: 'User', bot: false })
        },
        channels: {
            cache: new Map(overrides.channels ?? []),
            fetch: async (id) => null
        },
        application: { id: overrides.appId ?? '000000000000000000', commands: { set: async () => [], fetch: async () => new Map() } },
        shard: overrides.shard ?? null,
        on: () => {},
        once: () => {},
        off: () => {},
        emit: () => {},
        destroy: async () => {},
        login: async () => 'token',
        isReady: () => overrides.ready !== false,
        ...overrides.extra
    };
}

function createMockChannel(overrides = {}) {
    const channelId = overrides.id ?? '111111111111111111';
    const guildId = overrides.guildId ?? '987654321098765432';
    const messages = new Map(overrides.messages ?? []);

    const base = {
        id: channelId,
        name: overrides.name ?? 'test-channel',
        guildId,
        guild: overrides.guild ?? { id: guildId, name: 'Test Guild' },
        type: overrides.type ?? 0,
        parentId: overrides.parentId ?? null,
        topic: overrides.topic ?? null,
        nsfw: overrides.nsfw ?? false,
        rateLimitPerUser: overrides.rateLimitPerUser ?? 0,
        permissionOverwrites: {
            cache: new Map(overrides.permissionOverwrites ?? []),
            create: async (target, perms) => ({ target, perms }),
            delete: async (target) => target,
            edit: async (target, perms) => ({ target, perms })
        },
        messages: {
            cache: messages,
            fetch: async (idOrOpts) => {
                if (typeof idOrOpts === 'string') return messages.get(idOrOpts) ?? null;
                return new Map([...messages].slice(0, idOrOpts?.limit ?? 50));
            }
        },
        send: async (payload) => {
            if (overrides.onSend) overrides.onSend(payload);
            const msg = createMockMessage({ content: typeof payload === 'string' ? payload : payload?.content ?? '', channelId });
            messages.set(msg.id, msg);
            return msg;
        },
        bulkDelete: async (amount) => {
            const deleted = new Map();
            const entries = [...messages.entries()].slice(0, typeof amount === 'number' ? amount : amount.size);
            for (const [id] of entries) { deleted.set(id, messages.get(id)); messages.delete(id); }
            return deleted;
        },
        setRateLimitPerUser: async (limit) => ({ ...base, rateLimitPerUser: limit }),
        setName: async (name) => ({ ...base, name }),
        setTopic: async (topic) => ({ ...base, topic }),
        delete: async () => { if (overrides.onDelete) overrides.onDelete(); },
        isTextBased: () => [0, 2, 5, 10, 11, 12].includes(base.type),
        isVoiceBased: () => [2, 13].includes(base.type),
        isThread: () => [10, 11, 12].includes(base.type),
        isDMBased: () => [1, 3].includes(base.type),
        toString: () => `<#${channelId}>`,
        ...overrides.extra
    };

    if (base.isVoiceBased()) {
        base.members = new Map(overrides.voiceMembers ?? []);
        base.bitrate = overrides.bitrate ?? 64000;
        base.userLimit = overrides.userLimit ?? 0;
        base.rtcRegion = overrides.rtcRegion ?? null;
        base.setBitrate = async (b) => ({ ...base, bitrate: b });
        base.setUserLimit = async (l) => ({ ...base, userLimit: l });
    }

    if (base.isThread()) {
        base.archived = overrides.archived ?? false;
        base.locked = overrides.locked ?? false;
        base.autoArchiveDuration = overrides.autoArchiveDuration ?? 1440;
        base.members = { cache: new Map(), add: async (id) => id, remove: async (id) => id, fetch: async () => new Map() };
        base.setArchived = async (v) => ({ ...base, archived: v });
        base.setLocked = async (v) => ({ ...base, locked: v });
    }

    if (overrides.type === 15) {
        base.availableTags = overrides.availableTags ?? [];
        base.threads = { cache: new Map(), create: async (opts) => createMockChannel({ type: 11, name: opts.name }) };
    }

    return base;
}

function createMockRole(overrides = {}) {
    return {
        id: overrides.id ?? '222222222222222222',
        name: overrides.name ?? 'Test Role',
        color: overrides.color ?? 0,
        hoist: overrides.hoist ?? false,
        mentionable: overrides.mentionable ?? false,
        position: overrides.position ?? 1,
        permissions: {
            has: (perm) => overrides.permissions?.includes(perm) ?? false,
            toArray: () => overrides.permissions ?? []
        },
        guildId: overrides.guildId ?? '987654321098765432',
        managed: overrides.managed ?? false,
        tags: overrides.tags ?? null,
        setName: async (name) => createMockRole({ ...overrides, name }),
        setColor: async (color) => createMockRole({ ...overrides, color }),
        setHoist: async (hoist) => createMockRole({ ...overrides, hoist }),
        setMentionable: async (v) => createMockRole({ ...overrides, mentionable: v }),
        delete: async () => {},
        toString: () => `<@&${overrides.id ?? '222222222222222222'}>`,
        ...overrides.extra
    };
}

function createMockMember(overrides = {}) {
    const userId = overrides.userId ?? '123456789012345678';
    const guildId = overrides.guildId ?? '987654321098765432';
    const roles = new Map(overrides.roles ?? []);

    return {
        id: userId,
        user: { id: userId, username: overrides.username ?? 'TestUser', bot: overrides.bot ?? false, ...overrides.user },
        guild: overrides.guild ?? { id: guildId, name: 'Test Guild' },
        guildId,
        displayName: overrides.displayName ?? overrides.username ?? 'TestUser',
        nickname: overrides.nickname ?? null,
        joinedTimestamp: overrides.joinedTimestamp ?? (Date.now() - 86400000),
        premiumSinceTimestamp: overrides.premiumSinceTimestamp ?? null,
        pending: overrides.pending ?? false,
        communicationDisabledUntilTimestamp: overrides.communicationDisabledUntilTimestamp ?? null,
        permissions: {
            has: (perm) => overrides.permissions?.includes(perm) ?? true,
            toArray: () => overrides.permissions ?? []
        },
        roles: {
            cache: roles,
            add: async (roleId) => { roles.set(typeof roleId === 'string' ? roleId : roleId.id, createMockRole({ id: typeof roleId === 'string' ? roleId : roleId.id })); },
            remove: async (roleId) => { roles.delete(typeof roleId === 'string' ? roleId : roleId.id); },
            resolve: (id) => roles.get(id) ?? null
        },
        voice: {
            channel: overrides.voiceChannel ?? null,
            channelId: overrides.voiceChannelId ?? null,
            selfMute: overrides.selfMute ?? false,
            selfDeaf: overrides.selfDeaf ?? false,
            serverMute: overrides.serverMute ?? false,
            serverDeaf: overrides.serverDeaf ?? false,
            streaming: overrides.streaming ?? false
        },
        ban: async (opts) => { if (overrides.onBan) overrides.onBan(opts); },
        kick: async (reason) => { if (overrides.onKick) overrides.onKick(reason); },
        timeout: async (duration, reason) => { if (overrides.onTimeout) overrides.onTimeout(duration, reason); },
        disableCommunicationUntil: async (date, reason) => { if (overrides.onTimeout) overrides.onTimeout(date, reason); },
        setNickname: async (nick) => { if (overrides.onSetNickname) overrides.onSetNickname(nick); },
        send: async (payload) => {
            if (overrides.onSend) overrides.onSend(payload);
            return createMockMessage({ content: typeof payload === 'string' ? payload : payload?.content ?? '' });
        },
        fetch: async () => createMockMember(overrides),
        toString: () => `<@${userId}>`,
        ...overrides.extra
    };
}

function createMockReaction(overrides = {}) {
    return {
        emoji: overrides.emoji ?? { name: '⭐', id: null, identifier: '⭐' },
        count: overrides.count ?? 1,
        me: overrides.me ?? false,
        message: overrides.message ?? createMockMessage(),
        users: {
            cache: new Map(overrides.users ?? []),
            fetch: async (opts) => new Map(overrides.users ?? []),
            remove: async (userId) => {}
        },
        remove: async () => {},
        fetch: async () => createMockReaction(overrides),
        ...overrides.extra
    };
}

function createMockEmoji(overrides = {}) {
    const id = overrides.id ?? null;
    return {
        id,
        name: overrides.name ?? '⭐',
        animated: overrides.animated ?? false,
        available: overrides.available ?? true,
        managed: overrides.managed ?? false,
        requiresColons: overrides.requiresColons ?? (id !== null),
        guild: overrides.guild ?? null,
        identifier: id ? `${overrides.animated ? 'a:' : ''}${overrides.name ?? 'emoji'}:${id}` : (overrides.name ?? '⭐'),
        toString: () => id ? `<${overrides.animated ? 'a' : ''}:${overrides.name ?? 'emoji'}:${id}>` : (overrides.name ?? '⭐'),
        ...overrides.extra
    };
}

class MockStorage {
    constructor() {
        this._data = new Map();
        this._ttls = new Map();
    }

    _key(namespace, key) { return `${namespace}::${key}`; }

    _isExpired(fullKey) {
        const exp = this._ttls.get(fullKey);
        if (exp && Date.now() > exp) {
            this._data.delete(fullKey);
            this._ttls.delete(fullKey);
            return true;
        }
        return false;
    }

    async get(namespace, key) {
        const k = this._key(namespace, key);
        if (this._isExpired(k)) return null;
        return this._data.get(k) ?? null;
    }

    async set(namespace, key, value, ttlMs) {
        const k = this._key(namespace, key);
        this._data.set(k, value);
        if (ttlMs) this._ttls.set(k, Date.now() + ttlMs);
        return value;
    }

    async delete(namespace, key) {
        const k = this._key(namespace, key);
        this._data.delete(k);
        this._ttls.delete(k);
    }

    async has(namespace, key) {
        const k = this._key(namespace, key);
        if (this._isExpired(k)) return false;
        return this._data.has(k);
    }

    async keys(namespace) {
        const prefix = `${namespace}::`;
        return [...this._data.keys()]
            .filter(k => k.startsWith(prefix) && !this._isExpired(k))
            .map(k => k.slice(prefix.length));
    }

    async values(namespace) {
        const keys = await this.keys(namespace);
        return Promise.all(keys.map(k => this.get(namespace, k)));
    }

    async entries(namespace) {
        const keys = await this.keys(namespace);
        const entries = [];
        for (const k of keys) {
            const v = await this.get(namespace, k);
            if (v !== null) entries.push([k, v]);
        }
        return entries;
    }

    async clear(namespace) {
        const prefix = `${namespace}::`;
        for (const k of [...this._data.keys()]) {
            if (k.startsWith(prefix)) { this._data.delete(k); this._ttls.delete(k); }
        }
    }

    async getMany(namespace, keys) {
        const result = {};
        for (const k of keys) result[k] = await this.get(namespace, k);
        return result;
    }

    async setMany(namespace, entries) {
        for (const [k, v] of Object.entries(entries)) await this.set(namespace, k, v);
    }

    async deleteMany(namespace, keys) {
        for (const k of keys) await this.delete(namespace, k);
    }

    async increment(namespace, key, amount = 1) {
        const current = (await this.get(namespace, key)) ?? 0;
        const next = current + amount;
        await this.set(namespace, key, next);
        return next;
    }

    async decrement(namespace, key, amount = 1) {
        return this.increment(namespace, key, -amount);
    }

    async push(namespace, key, value) {
        const arr = (await this.get(namespace, key)) ?? [];
        arr.push(value);
        await this.set(namespace, key, arr);
        return arr;
    }

    async pull(namespace, key, predicate) {
        const arr = (await this.get(namespace, key)) ?? [];
        const next = arr.filter(v => !predicate(v));
        await this.set(namespace, key, next);
        return next;
    }

    async update(namespace, key, updater, defaultValue = {}) {
        const current = (await this.get(namespace, key)) ?? defaultValue;
        const updated = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
        await this.set(namespace, key, updated);
        return updated;
    }

    async getOrSet(namespace, key, factory) {
        const existing = await this.get(namespace, key);
        if (existing !== null) return existing;
        const value = typeof factory === 'function' ? await factory() : factory;
        await this.set(namespace, key, value);
        return value;
    }

    async size(namespace) {
        return (await this.keys(namespace)).length;
    }

    async toObject(namespace) {
        const entries = await this.entries(namespace);
        return Object.fromEntries(entries);
    }

    async fromObject(namespace, obj) {
        for (const [k, v] of Object.entries(obj)) await this.set(namespace, k, v);
    }

    snapshot() {
        return new Map(this._data);
    }

    reset() {
        this._data.clear();
        this._ttls.clear();
    }
}

class MockEventBus extends EventEmitter {
    constructor() {
        super();
        this._emitted = [];
        this._assertions = [];
    }

    emit(event, ...args) {
        this._emitted.push({ event, args, ts: Date.now() });
        return super.emit(event, ...args);
    }

    getEmitted(event) {
        return this._emitted.filter(e => e.event === event);
    }

    wasEmitted(event) {
        return this._emitted.some(e => e.event === event);
    }

    getEmittedCount(event) {
        return this._emitted.filter(e => e.event === event).length;
    }

    getLastEmitted(event) {
        const events = this._emitted.filter(e => e.event === event);
        return events[events.length - 1] ?? null;
    }

    assertEmitted(event, times) {
        const count = this.getEmittedCount(event);
        if (times !== undefined && count !== times) {
            throw new Error(`Expected event "${event}" to be emitted ${times} time(s), but was emitted ${count} time(s)`);
        }
        if (times === undefined && count === 0) {
            throw new Error(`Expected event "${event}" to be emitted at least once, but it was never emitted`);
        }
    }

    assertNotEmitted(event) {
        const count = this.getEmittedCount(event);
        if (count > 0) {
            throw new Error(`Expected event "${event}" to not be emitted, but it was emitted ${count} time(s)`);
        }
    }

    reset() {
        this._emitted = [];
        this.removeAllListeners();
    }
}

class TestFramework {
    constructor(opts = {}) {
        this.options = opts;
        this.storage = opts.storage ?? new MockStorage();
        this.events = opts.events ?? new MockEventBus();
        this.container = new Map();
        this._client = null;
        this._replies = [];
        this._deferred = false;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    get client() { return this._client; }

    container = {
        _map: new Map(),
        set(key, value) { this._map.set(key, value); },
        get(key) { return this._map.get(key); },
        has(key) { return this._map.has(key); },
        clear() { this._map.clear(); }
    };

    async runCommand(command, opts = {}) {
        const interaction = createMockInteraction({
            commandName: command.name ?? command.data?.name,
            userId: opts.userId ?? '123456789012345678',
            guildId: opts.guildId ?? '987654321098765432',
            options: opts.options ?? {},
            subcommand: opts.subcommand ?? null,
            guild: opts.guild ?? createMockGuild(),
            member: opts.member ?? createMockMember({ userId: opts.userId }),
            channel: opts.channel ?? createMockChannel(),
            ...opts.interactionOverrides
        });

        const replies = [];
        interaction.reply = async (p) => { replies.push({ type: 'reply', payload: p }); return p; };
        interaction.editReply = async (p) => { replies.push({ type: 'editReply', payload: p }); return p; };
        interaction.followUp = async (p) => { replies.push({ type: 'followUp', payload: p }); return p; };
        interaction.deferReply = async (p) => { replies.push({ type: 'deferReply', payload: p }); };

        const client = this._client ?? createMockClient();

        try {
            await command.executeSlash(interaction, client);
        } catch (err) {
            return { ok: false, error: err, replies };
        }

        return { ok: true, replies, interaction };
    }

    async runPrefixCommand(command, opts = {}) {
        const message = createMockMessage({
            content: opts.content ?? `,${command.name}`,
            userId: opts.userId ?? '123456789012345678',
            guildId: opts.guildId ?? '987654321098765432',
            guild: opts.guild ?? createMockGuild(),
            member: opts.member ?? createMockMember({ userId: opts.userId }),
            channel: opts.channel ?? createMockChannel(),
            ...opts.messageOverrides
        });

        const replies = [];
        message.reply = async (p) => { replies.push({ type: 'reply', payload: p }); return createMockMessage({ content: typeof p === 'string' ? p : p?.content ?? '' }); };
        message.channel.send = async (p) => { replies.push({ type: 'send', payload: p }); return createMockMessage({ content: typeof p === 'string' ? p : p?.content ?? '' }); };

        const client = this._client ?? createMockClient();
        const args = opts.args ?? [];

        try {
            await command.executePrefix(message, args, client, command.name);
        } catch (err) {
            return { ok: false, error: err, replies };
        }

        return { ok: true, replies, message };
    }

    reset() {
        this.storage.reset();
        this.events.reset();
    }
}

module.exports = {
    createMockInteraction,
    createMockMessage,
    createMockGuild,
    createMockClient,
    createMockChannel,
    createMockRole,
    createMockMember,
    createMockReaction,
    createMockEmoji,
    MockStorage,
    MockEventBus,
    TestFramework
};
