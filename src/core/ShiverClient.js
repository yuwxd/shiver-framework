const { Client, GatewayIntentBits, Options } = require('discord.js');

function buildDefaultSweepers(cacheOptions = {}) {
    const sweepIntervalMs = cacheOptions.sweepIntervalMs ?? 3600000;
    const sweepMessageLifetimeMs = cacheOptions.sweepMessageLifetimeMs ?? 3600000;
    const sweepThreadLifetimeMs = cacheOptions.sweepThreadLifetimeMs ?? sweepMessageLifetimeMs;

    return {
        messages: {
            interval: Math.max(60, Math.floor(sweepIntervalMs / 1000)),
            lifetime: Math.max(60, Math.floor(sweepMessageLifetimeMs / 1000))
        },
        threads: {
            interval: Math.max(60, Math.floor(sweepIntervalMs / 1000)),
            lifetime: Math.max(60, Math.floor(sweepThreadLifetimeMs / 1000))
        }
    };
}

function buildShiverClientOptions(options = {}) {
    const {
        intents = [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages
        ],
        makeCache,
        sweepers,
        rest = {},
        ws = {},
        cacheOptions = {},
        ...restOptions
    } = options;

    const messageCacheSize = cacheOptions.messageCacheSize ?? 200;
    const memberCacheSize = cacheOptions.memberCacheSize ?? 500;
    const userCacheSize = cacheOptions.userCacheSize ?? 1000;

    const defaultMakeCache = Options.cacheWithLimits({
        MessageManager: messageCacheSize,
        GuildMemberManager: memberCacheSize,
        UserManager: userCacheSize,
        PresenceManager: 0,
        GuildBanManager: 0,
        GuildInviteManager: 0,
        GuildScheduledEventManager: 0,
        StageInstanceManager: 0
    });

    return {
        intents,
        makeCache: makeCache || defaultMakeCache,
        sweepers: sweepers || buildDefaultSweepers(cacheOptions),
        rest: {
            timeout: 15000,
            ...rest
        },
        ws: {
            compress: true,
            large_threshold: 50,
            ...ws
        },
        ...restOptions
    };
}

class ShiverClient extends Client {
    constructor(options = {}) {
        super(buildShiverClientOptions(options));

        this._applicationIdCache = null;
    }

    get cachedApplicationId() {
        if (!this._applicationIdCache && this.application?.id) {
            this._applicationIdCache = this.application.id;
        }
        return this._applicationIdCache;
    }
}

module.exports = { ShiverClient, buildShiverClientOptions };
