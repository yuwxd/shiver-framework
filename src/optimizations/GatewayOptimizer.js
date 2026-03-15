const { GatewayIntentBits } = require('discord.js');

const INTENT_EVENT_MAP = {
    [GatewayIntentBits.Guilds]: ['guildCreate', 'guildUpdate', 'guildDelete', 'channelCreate', 'channelUpdate', 'channelDelete', 'roleCreate', 'roleUpdate', 'roleDelete', 'threadCreate', 'threadUpdate', 'threadDelete', 'stageInstanceCreate', 'stageInstanceUpdate', 'stageInstanceDelete'],
    [GatewayIntentBits.GuildMembers]: ['guildMemberAdd', 'guildMemberUpdate', 'guildMemberRemove', 'threadMembersUpdate'],
    [GatewayIntentBits.GuildModeration]: ['guildBanAdd', 'guildBanRemove', 'guildAuditLogEntryCreate'],
    [GatewayIntentBits.GuildEmojisAndStickers]: ['emojiCreate', 'emojiUpdate', 'emojiDelete', 'stickerCreate', 'stickerUpdate', 'stickerDelete'],
    [GatewayIntentBits.GuildIntegrations]: ['integrationCreate', 'integrationUpdate', 'integrationDelete'],
    [GatewayIntentBits.GuildWebhooks]: ['webhooksUpdate'],
    [GatewayIntentBits.GuildInvites]: ['inviteCreate', 'inviteDelete'],
    [GatewayIntentBits.GuildVoiceStates]: ['voiceStateUpdate'],
    [GatewayIntentBits.GuildPresences]: ['presenceUpdate'],
    [GatewayIntentBits.GuildMessages]: ['messageCreate', 'messageUpdate', 'messageDelete', 'messageDeleteBulk'],
    [GatewayIntentBits.GuildMessageReactions]: ['messageReactionAdd', 'messageReactionRemove', 'messageReactionRemoveAll', 'messageReactionRemoveEmoji'],
    [GatewayIntentBits.GuildMessageTyping]: ['typingStart'],
    [GatewayIntentBits.DirectMessages]: ['messageCreate', 'messageUpdate', 'messageDelete', 'channelPinsUpdate'],
    [GatewayIntentBits.DirectMessageReactions]: ['messageReactionAdd', 'messageReactionRemove'],
    [GatewayIntentBits.DirectMessageTyping]: ['typingStart'],
    [GatewayIntentBits.MessageContent]: [],
    [GatewayIntentBits.GuildScheduledEvents]: ['guildScheduledEventCreate', 'guildScheduledEventUpdate', 'guildScheduledEventDelete', 'guildScheduledEventUserAdd', 'guildScheduledEventUserRemove'],
    [GatewayIntentBits.AutoModerationConfiguration]: ['autoModerationRuleCreate', 'autoModerationRuleUpdate', 'autoModerationRuleDelete'],
    [GatewayIntentBits.AutoModerationExecution]: ['autoModerationActionExecution']
};

function calculateMinimalIntents(registeredEvents = []) {
    const eventSet = new Set(registeredEvents);
    const required = new Set([GatewayIntentBits.Guilds]);

    for (const [intent, events] of Object.entries(INTENT_EVENT_MAP)) {
        if (events.some(e => eventSet.has(e))) {
            required.add(Number(intent));
        }
    }

    return [...required];
}

function calculateShardCount(guildCount, guildsPerShard = 1000) {
    if (guildCount <= 0) return 1;
    return Math.max(1, Math.ceil(guildCount / guildsPerShard));
}

function buildGatewayOptions(gatewayOptions = {}) {
    return {
        compress: gatewayOptions.compress !== false,
        large_threshold: gatewayOptions.large_threshold ?? 50,
        ...(gatewayOptions.version ? { version: gatewayOptions.version } : {})
    };
}

function buildRestOptions(restOptions = {}) {
    return {
        timeout: restOptions.timeout ?? 15000,
        ...(restOptions.agent ? { agent: restOptions.agent } : {})
    };
}

class ShardLatencyMonitor {
    constructor() {
        this._latencies = new Map();
        this._history = new Map();
        this._maxHistory = 60;
    }

    record(shardId, ping) {
        this._latencies.set(shardId, ping);
        const hist = this._history.get(shardId) ?? [];
        hist.push({ ping, ts: Date.now() });
        if (hist.length > this._maxHistory) hist.shift();
        this._history.set(shardId, hist);
    }

    get(shardId) {
        return this._latencies.get(shardId) ?? -1;
    }

    getHistory(shardId) {
        return this._history.get(shardId) ?? [];
    }

    getAverage(shardId) {
        const hist = this._history.get(shardId);
        if (!hist || hist.length === 0) return -1;
        return hist.reduce((s, e) => s + e.ping, 0) / hist.length;
    }

    getAll() {
        return Object.fromEntries(this._latencies);
    }

    getSlowest(n = 3) {
        return [...this._latencies.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([shardId, ping]) => ({ shardId, ping }));
    }
}

class HeartbeatMonitor {
    constructor(opts = {}) {
        this._timeout = opts.timeout ?? 60000;
        this._onMissed = opts.onMissed ?? null;
        this._beats = new Map();
        this._timers = new Map();
    }

    attach(client) {
        client.ws.on('heartbeat', (shardId) => this.beat(shardId));
        client.ws.on('shardReady', (shardId) => this.beat(shardId));
        client.ws.on('shardDisconnect', (event, shardId) => this._clearTimer(shardId));
        client.ws.on('shardReconnecting', (shardId) => this._clearTimer(shardId));
    }

    beat(shardId) {
        this._beats.set(shardId, Date.now());
        this._resetTimer(shardId);
    }

    _resetTimer(shardId) {
        this._clearTimer(shardId);
        const timer = setTimeout(() => {
            if (this._onMissed) this._onMissed(shardId);
        }, this._timeout);
        if (timer.unref) timer.unref();
        this._timers.set(shardId, timer);
    }

    _clearTimer(shardId) {
        if (this._timers.has(shardId)) {
            clearTimeout(this._timers.get(shardId));
            this._timers.delete(shardId);
        }
    }

    getLastBeat(shardId) {
        return this._beats.get(shardId) ?? null;
    }

    getTimeSinceLastBeat(shardId) {
        const last = this._beats.get(shardId);
        return last ? Date.now() - last : null;
    }

    destroy() {
        for (const timer of this._timers.values()) clearTimeout(timer);
        this._timers.clear();
    }
}

class AutoReconnectManager {
    constructor(opts = {}) {
        this._maxAttempts = opts.maxAttempts ?? 10;
        this._baseDelay = opts.baseDelay ?? 1000;
        this._maxDelay = opts.maxDelay ?? 30000;
        this._jitter = opts.jitter !== false;
        this._attempts = new Map();
        this._timers = new Map();
        this._onReconnect = opts.onReconnect ?? null;
        this._onGiveUp = opts.onGiveUp ?? null;
    }

    attach(client) {
        client.ws.on('shardDisconnect', (event, shardId) => {
            if (event.code === 1000) return;
            this._scheduleReconnect(shardId, client);
        });

        client.ws.on('shardReady', (shardId) => {
            this._attempts.delete(shardId);
            const timer = this._timers.get(shardId);
            if (timer) {
                clearTimeout(timer);
                this._timers.delete(shardId);
            }
        });
    }

    _scheduleReconnect(shardId, client) {
        const attempts = (this._attempts.get(shardId) ?? 0) + 1;
        this._attempts.set(shardId, attempts);

        if (attempts > this._maxAttempts) {
            if (this._onGiveUp) this._onGiveUp(shardId, attempts);
            return;
        }

        let delay = Math.min(this._baseDelay * Math.pow(2, attempts - 1), this._maxDelay);
        if (this._jitter) delay = delay * (0.5 + Math.random() * 0.5);

        const timer = setTimeout(async () => {
            this._timers.delete(shardId);
            try {
                await client.ws.shards.get(shardId)?.connect();
                if (this._onReconnect) this._onReconnect(shardId, attempts);
            } catch (err) {
                this._scheduleReconnect(shardId, client);
            }
        }, delay);

        if (timer.unref) timer.unref();
        this._timers.set(shardId, timer);
    }

    getAttempts(shardId) {
        return this._attempts.get(shardId) ?? 0;
    }

    reset(shardId) {
        this._attempts.delete(shardId);
        const timer = this._timers.get(shardId);
        if (timer) {
            clearTimeout(timer);
            this._timers.delete(shardId);
        }
    }

    destroy() {
        for (const timer of this._timers.values()) clearTimeout(timer);
        this._timers.clear();
    }
}

module.exports = {
    buildGatewayOptions,
    buildRestOptions,
    calculateMinimalIntents,
    calculateShardCount,
    ShardLatencyMonitor,
    HeartbeatMonitor,
    AutoReconnectManager,
    INTENT_EVENT_MAP
};
