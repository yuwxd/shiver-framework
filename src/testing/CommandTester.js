const { createHash } = require('crypto');
const { createMockInteraction, createMockMessage, createMockGuild, createMockClient, createMockChannel, createMockMember, MockStorage, MockEventBus } = require('./mocks');
const { Sandbox } = require('../sandbox/Sandbox');

class AssertionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AssertionError';
    }
}

class TestResult {
    constructor(opts) {
        this.ok = opts.ok;
        this.error = opts.error ?? null;
        this.replies = opts.replies ?? [];
        this.interaction = opts.interaction ?? null;
        this.message = opts.message ?? null;
        this.metadata = opts.metadata ?? {};
        this.eventLog = opts.eventLog ?? [];
        this._assertions = [];
    }

    expectReply() {
        const reply = this.replies.find(r => r.type === 'reply' || r.type === 'editReply');
        if (!reply) throw new AssertionError('Expected a reply but none was sent');
        return new ReplyAssertion(reply.payload, this);
    }

    expectFollowUp() {
        const followUp = this.replies.find(r => r.type === 'followUp');
        if (!followUp) throw new AssertionError('Expected a follow-up but none was sent');
        return new ReplyAssertion(followUp.payload, this);
    }

    expectDeferred() {
        const deferred = this.replies.find(r => r.type === 'deferReply');
        if (!deferred) throw new AssertionError('Expected interaction to be deferred but it was not');
        return this;
    }

    expectNotDeferred() {
        const deferred = this.replies.find(r => r.type === 'deferReply');
        if (deferred) throw new AssertionError('Expected interaction to NOT be deferred but it was');
        return this;
    }

    expectEphemeral() {
        const reply = this.replies.find(r => r.type === 'reply' || r.type === 'editReply' || r.type === 'deferReply');
        if (!reply) throw new AssertionError('Expected a reply but none was sent');
        const { MessageFlags } = require('discord.js');
        const flags = reply.payload?.flags;
        const isEphemeral = flags === MessageFlags.Ephemeral || flags === 64 || (typeof flags === 'object' && flags?.bitfield === 64n);
        if (!isEphemeral) throw new AssertionError('Expected reply to be ephemeral but it was not');
        return this;
    }

    expectNoError() {
        if (this.error) throw new AssertionError(`Expected no error but got: ${this.error.message}`);
        return this;
    }

    expectError(messageContains) {
        if (!this.error) throw new AssertionError('Expected an error but none was thrown');
        if (messageContains && !this.error.message?.includes(messageContains)) {
            throw new AssertionError(`Expected error to contain "${messageContains}" but got: ${this.error.message}`);
        }
        return this;
    }

    expectReplyCount(count) {
        if (this.replies.length !== count) {
            throw new AssertionError(`Expected ${count} reply/replies but got ${this.replies.length}`);
        }
        return this;
    }

    getReplies() { return this.replies; }
    getFirstReply() { return this.replies[0] ?? null; }
    getLastReply() { return this.replies[this.replies.length - 1] ?? null; }
    getEventLog() { return [...this.eventLog]; }
}

class ReplyAssertion {
    constructor(payload, result) {
        this._payload = payload;
        this._result = result;
    }

    withContent(text) {
        const content = this._payload?.content ?? '';
        if (!content.includes(text)) {
            throw new AssertionError(`Expected reply content to contain "${text}" but got: "${content}"`);
        }
        return this;
    }

    withContentMatching(regex) {
        const content = this._payload?.content ?? '';
        if (!regex.test(content)) {
            throw new AssertionError(`Expected reply content to match ${regex} but got: "${content}"`);
        }
        return this;
    }

    withEmbed() {
        const embeds = this._payload?.embeds ?? [];
        if (embeds.length === 0) throw new AssertionError('Expected reply to contain an embed but none found');
        return new EmbedAssertion(embeds[0], this._result);
    }

    withComponents() {
        const components = this._payload?.components ?? [];
        if (components.length === 0) throw new AssertionError('Expected reply to contain components but none found');
        return this._result;
    }

    withFiles() {
        const files = this._payload?.files ?? [];
        if (files.length === 0) throw new AssertionError('Expected reply to contain files but none found');
        return this._result;
    }

    withFlag(flag) {
        const flags = this._payload?.flags;
        const has = flags === flag || (typeof flags === 'number' && (flags & flag) !== 0);
        if (!has) throw new AssertionError(`Expected reply to have flag ${flag}`);
        return this._result;
    }

    and() { return this._result; }
}

class EmbedAssertion {
    constructor(embed, result) {
        this._embed = embed;
        this._result = result;
    }

    withTitle(title) {
        const t = this._embed?.title ?? this._embed?.data?.title ?? '';
        if (!t.includes(title)) throw new AssertionError(`Expected embed title to contain "${title}" but got: "${t}"`);
        return this;
    }

    withDescription(text) {
        const d = this._embed?.description ?? this._embed?.data?.description ?? '';
        if (!d.includes(text)) throw new AssertionError(`Expected embed description to contain "${text}" but got: "${d}"`);
        return this;
    }

    withColor(color) {
        const c = this._embed?.color ?? this._embed?.data?.color;
        if (c !== color) throw new AssertionError(`Expected embed color to be ${color} but got: ${c}`);
        return this;
    }

    and() { return this._result; }
}

class CommandTester {
    constructor(opts = {}) {
        this._framework = opts.framework ?? null;
        this._client = opts.client ?? createMockClient();
        this._storage = opts.storage ?? new MockStorage();
        this._events = opts.events ?? new MockEventBus();
        this._defaultGuild = opts.guild ?? createMockGuild();
        this._defaultChannel = opts.channel ?? createMockChannel();
        this._defaultMember = opts.member ?? createMockMember();
        this._sandbox = opts.sandbox ?? new Sandbox(opts.sandboxOptions ?? {});
        this._recording = false;
        this._eventLog = [];
        this._resultCacheEnabled = opts.resultCache ?? false;
        this._resultCache = new Map();
        this._defaultSeed = opts.seed ?? 123456789;
        this._defaultNow = opts.now ?? 1700000000000;
    }

    static create(opts = {}) {
        return new CommandTester(opts);
    }

    async run(command, opts = {}) {
        const mode = opts.mode ?? 'slash';
        const cacheKey = this._createCacheKey(mode, command, opts);
        const cached = this._getCachedResult(cacheKey);
        if (cached) return cached;

        const interaction = createMockInteraction({
            commandName: command.name ?? command.data?.name,
            userId: opts.userId ?? '123456789012345678',
            guildId: opts.guildId ?? this._defaultGuild.id,
            options: opts.options ?? {},
            subcommand: opts.subcommand ?? null,
            guild: opts.guild ?? this._defaultGuild,
            member: opts.member ?? this._defaultMember,
            channel: opts.channel ?? this._defaultChannel,
            ...opts.interactionOverrides
        });

        const replies = [];
        this._decorateInteraction(interaction, replies, mode, opts);

        const client = opts.client ?? this._client;
        const eventLog = [];
        const metadata = {
            mode,
            deterministic: opts.deterministic !== false,
            sandbox: opts.useSandbox ?? false,
            cached: false,
            seed: opts.seed ?? this._defaultSeed,
            now: opts.now ?? this._defaultNow
        };

        if (opts.useSandbox) {
            metadata.sandboxProbe = await this._sandbox.run(`return { seed, now, mode };`, {
                seed: metadata.seed,
                now: metadata.now,
                mode
            });
        }

        try {
            await this._runDeterministic(async () => {
                await command.executeSlash(interaction, client);
            }, { ...opts, mode }, eventLog);
        } catch (err) {
            const result = new TestResult({ ok: false, error: err, replies, interaction, metadata, eventLog });
            this._storeCache(cacheKey, result, opts);
            return result;
        }

        const result = new TestResult({ ok: true, replies, interaction, metadata, eventLog });
        this._storeCache(cacheKey, result, opts);
        return result;
    }

    async runPrefix(command, opts = {}) {
        const mode = 'prefix';
        const cacheKey = this._createCacheKey(mode, command, opts);
        const cached = this._getCachedResult(cacheKey);
        if (cached) return cached;

        const message = createMockMessage({
            content: opts.content ?? `,${command.name ?? command.data?.name}`,
            userId: opts.userId ?? '123456789012345678',
            guildId: opts.guildId ?? this._defaultGuild.id,
            guild: opts.guild ?? this._defaultGuild,
            member: opts.member ?? this._defaultMember,
            channel: opts.channel ?? this._defaultChannel,
            ...opts.messageOverrides
        });

        const replies = [];
        this._decorateMessage(message, replies, mode, opts);

        const client = opts.client ?? this._client;
        const args = opts.args ?? [];
        const eventLog = [];
        const metadata = {
            mode,
            deterministic: opts.deterministic !== false,
            cached: false,
            seed: opts.seed ?? this._defaultSeed,
            now: opts.now ?? this._defaultNow
        };

        try {
            await this._runDeterministic(async () => {
                await command.executePrefix(message, args, client, command.name ?? command.data?.name);
            }, { ...opts, mode }, eventLog);
        } catch (err) {
            const result = new TestResult({ ok: false, error: err, replies, message, metadata, eventLog });
            this._storeCache(cacheKey, result, opts);
            return result;
        }

        const result = new TestResult({ ok: true, replies, message, metadata, eventLog });
        this._storeCache(cacheKey, result, opts);
        return result;
    }

    async runButton(command, opts = {}) {
        const mode = 'button';
        const cacheKey = this._createCacheKey(mode, command, opts);
        const cached = this._getCachedResult(cacheKey);
        if (cached) return cached;

        if (typeof command.handleButton !== 'function') {
            throw new Error(`Command "${command.name}" does not have a handleButton method`);
        }

        const interaction = createMockInteraction({
            type: 'button',
            customId: opts.customId ?? `${command.name}_btn`,
            userId: opts.userId ?? '123456789012345678',
            guildId: opts.guildId ?? this._defaultGuild.id,
            guild: opts.guild ?? this._defaultGuild,
            member: opts.member ?? this._defaultMember,
            channel: opts.channel ?? this._defaultChannel,
            ...opts.interactionOverrides
        });

        const replies = [];
        this._decorateInteraction(interaction, replies, mode, opts);

        const client = opts.client ?? this._client;
        const eventLog = [];
        const metadata = {
            mode,
            deterministic: opts.deterministic !== false,
            cached: false,
            seed: opts.seed ?? this._defaultSeed,
            now: opts.now ?? this._defaultNow
        };

        try {
            await this._runDeterministic(async () => {
                await command.handleButton(interaction, client);
            }, { ...opts, mode }, eventLog);
        } catch (err) {
            const result = new TestResult({ ok: false, error: err, replies, interaction, metadata, eventLog });
            this._storeCache(cacheKey, result, opts);
            return result;
        }

        const result = new TestResult({ ok: true, replies, interaction, metadata, eventLog });
        this._storeCache(cacheKey, result, opts);
        return result;
    }

    async sandbox(command, opts = {}) {
        return this.run(command, { ...opts, useSandbox: true, deterministic: true });
    }

    async replay(source, command, opts = {}) {
        const events = Array.isArray(source)
            ? source
            : source?.getEventLog?.() ?? source?.eventLog ?? [];
        const first = events[0] ?? {};
        const mode = opts.mode ?? first.mode ?? 'slash';

        if (mode === 'prefix') {
            return this.runPrefix(command, {
                ...opts,
                content: first.content ?? opts.content,
                userId: first.userId ?? opts.userId,
                guildId: first.guildId ?? opts.guildId,
                args: first.args ?? opts.args,
                deterministic: true
            });
        }

        if (mode === 'button') {
            return this.runButton(command, {
                ...opts,
                customId: first.customId ?? opts.customId,
                userId: first.userId ?? opts.userId,
                guildId: first.guildId ?? opts.guildId,
                deterministic: true
            });
        }

        return this.run(command, {
            ...opts,
            options: first.options ?? opts.options,
            subcommand: first.subcommand ?? opts.subcommand,
            userId: first.userId ?? opts.userId,
            guildId: first.guildId ?? opts.guildId,
            deterministic: true
        });
    }

    record(enabled = true) {
        this._recording = enabled;
        if (!enabled) this._eventLog = [];
        return this;
    }

    getRecordedEvents() {
        return [...this._eventLog];
    }

    clearRecordedEvents() {
        this._eventLog = [];
        return this;
    }

    enableResultCache() {
        this._resultCacheEnabled = true;
        return this;
    }

    disableResultCache() {
        this._resultCacheEnabled = false;
        return this;
    }

    clearResultCache() {
        this._resultCache.clear();
        return this;
    }

    withGuild(guild) { this._defaultGuild = guild; return this; }
    withChannel(channel) { this._defaultChannel = channel; return this; }
    withMember(member) { this._defaultMember = member; return this; }
    withClient(client) { this._client = client; return this; }
    withStorage(storage) { this._storage = storage; return this; }

    _decorateInteraction(interaction, replies, mode, opts) {
        const record = (type, payload) => {
            replies.push({ type, payload });
            this._pushEvent({
                mode,
                type,
                payload,
                commandName: interaction.commandName,
                customId: interaction.customId,
                userId: interaction.user?.id,
                guildId: interaction.guildId,
                options: opts.options ?? {},
                subcommand: opts.subcommand ?? null
            });
        };

        interaction.reply = async (payload) => { record('reply', payload); return payload; };
        interaction.editReply = async (payload) => { record('editReply', payload); return payload; };
        interaction.followUp = async (payload) => { record('followUp', payload); return payload; };
        interaction.deferReply = async (payload) => { record('deferReply', payload ?? {}); };
        interaction.deferUpdate = async () => { record('deferUpdate', {}); };
        interaction.update = async (payload) => { record('update', payload); return payload; };
    }

    _decorateMessage(message, replies, mode, opts) {
        const record = (type, payload) => {
            replies.push({ type, payload });
            this._pushEvent({
                mode,
                type,
                payload,
                commandName: opts.commandName ?? null,
                content: message.content,
                args: opts.args ?? [],
                userId: message.author?.id,
                guildId: message.guildId
            });
        };

        message.reply = async (payload) => {
            record('reply', payload);
            return createMockMessage({ content: typeof payload === 'string' ? payload : payload?.content ?? '' });
        };
        message.channel.send = async (payload) => {
            record('send', payload);
            return createMockMessage({ content: typeof payload === 'string' ? payload : payload?.content ?? '' });
        };
    }

    async _runDeterministic(fn, opts, eventLog) {
        const deterministic = opts.deterministic !== false;
        if (!deterministic) {
            await fn();
            return;
        }

        const originalNow = Date.now;
        const originalRandom = Math.random;
        const fixedNow = opts.now ?? this._defaultNow;
        let seed = opts.seed ?? this._defaultSeed;
        const random = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            return seed / 4294967296;
        };

        Date.now = () => fixedNow;
        Math.random = random;

        try {
            eventLog.push({
                mode: opts.mode ?? 'unknown',
                timestamp: fixedNow,
                seed: opts.seed ?? this._defaultSeed,
                userId: opts.userId ?? '123456789012345678',
                guildId: opts.guildId ?? this._defaultGuild.id,
                options: opts.options ?? {},
                args: opts.args ?? [],
                subcommand: opts.subcommand ?? null,
                content: opts.content ?? null,
                customId: opts.customId ?? null
            });
            await fn();
        } finally {
            Date.now = originalNow;
            Math.random = originalRandom;
        }
    }

    _pushEvent(event) {
        if (!this._recording) return;
        this._eventLog.push({ ...event, timestamp: Date.now() });
    }

    _createCacheKey(mode, command, opts) {
        const payload = {
            mode,
            commandName: command?.name ?? command?.data?.name ?? 'unknown',
            userId: opts.userId ?? '123456789012345678',
            guildId: opts.guildId ?? this._defaultGuild.id,
            options: opts.options ?? {},
            args: opts.args ?? [],
            subcommand: opts.subcommand ?? null,
            customId: opts.customId ?? null,
            content: opts.content ?? null,
            seed: opts.seed ?? this._defaultSeed,
            now: opts.now ?? this._defaultNow
        };
        return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
    }

    _getCachedResult(cacheKey) {
        if (!this._resultCacheEnabled) return null;
        const cached = this._resultCache.get(cacheKey);
        if (!cached) return null;
        return new TestResult({
            ...cached,
            metadata: { ...cached.metadata, cached: true },
            eventLog: [...(cached.eventLog ?? [])]
        });
    }

    _storeCache(cacheKey, result, opts = {}) {
        if (!this._resultCacheEnabled && !opts.cacheResult) return;
        this._resultCache.set(cacheKey, {
            ok: result.ok,
            error: result.error,
            replies: result.replies,
            interaction: result.interaction,
            message: result.message,
            metadata: { ...result.metadata, cached: false },
            eventLog: [...result.eventLog]
        });
    }
}

module.exports = { CommandTester, TestResult, ReplyAssertion, EmbedAssertion, AssertionError };
