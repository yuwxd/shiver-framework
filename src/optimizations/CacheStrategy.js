const { Options } = require('discord.js');

function buildMakeCacheOptions(cacheOptions = {}) {
    return Options.cacheWithLimits({
        MessageManager: cacheOptions.messageCacheSize ?? 200,
        GuildMemberManager: cacheOptions.memberCacheSize ?? 500,
        UserManager: cacheOptions.userCacheSize ?? 1000,
        PresenceManager: cacheOptions.presenceCacheSize ?? 0,
        GuildBanManager: cacheOptions.banCacheSize ?? 0,
        GuildInviteManager: cacheOptions.inviteCacheSize ?? 0,
        GuildScheduledEventManager: cacheOptions.scheduledEventCacheSize ?? 0,
        StageInstanceManager: cacheOptions.stageInstanceCacheSize ?? 0
    });
}

function buildSweepersOptions(cacheOptions = {}) {
    const sweepIntervalSec = Math.floor((cacheOptions.sweepIntervalMs ?? 3600000) / 1000);
    const messageLifetimeSec = Math.floor((cacheOptions.sweepMessageLifetimeMs ?? 3600000) / 1000);
    const memberLifetimeSec = Math.floor((cacheOptions.sweepMemberLifetimeMs ?? 3600000) / 1000);

    return {
        ...Options.DefaultSweeperSettings,
        messages: {
            interval: sweepIntervalSec,
            lifetime: messageLifetimeSec
        },
        guildMembers: {
            interval: sweepIntervalSec,
            filter: Options.filterByLifetime({ lifetime: memberLifetimeSec })
        }
    };
}

module.exports = { buildMakeCacheOptions, buildSweepersOptions };
