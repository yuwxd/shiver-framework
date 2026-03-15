const { PermissionFlagsBits } = require('discord.js');

class InhibitorResult {
    constructor(ok, reason = null, data = {}) {
        this.ok = ok;
        this.reason = reason;
        this.data = data;
    }

    static ok() { return new InhibitorResult(true); }
    static fail(reason, data = {}) { return new InhibitorResult(false, reason, data); }
}

class Inhibitor {
    constructor(name, opts = {}) {
        this.name = name;
        this.priority = opts.priority ?? 0;
        this.enabled = opts.enabled ?? true;
    }

    async run(interaction, command, context) {
        throw new Error(`Inhibitor "${this.name}" does not implement run()`);
    }
}

class HasPermissionInhibitor extends Inhibitor {
    constructor(permissions, opts = {}) {
        super('HasPermission', opts);
        this._permissions = Array.isArray(permissions) ? permissions : [permissions];
    }

    async run(interaction) {
        const member = interaction.member;
        if (!member) return InhibitorResult.ok();
        const missing = this._permissions.filter(p => !member.permissions?.has(p));
        if (missing.length === 0) return InhibitorResult.ok();
        return InhibitorResult.fail('missing_permissions', { missing });
    }
}

class HasRoleInhibitor extends Inhibitor {
    constructor(roleIds, opts = {}) {
        super('HasRole', opts);
        this._roleIds = Array.isArray(roleIds) ? roleIds : [roleIds];
        this._requireAll = opts.requireAll ?? false;
    }

    async run(interaction) {
        const member = interaction.member;
        if (!member) return InhibitorResult.ok();
        const memberRoles = member.roles?.cache ?? new Map();
        const check = this._requireAll
            ? this._roleIds.every(id => memberRoles.has(id))
            : this._roleIds.some(id => memberRoles.has(id));
        if (check) return InhibitorResult.ok();
        return InhibitorResult.fail('missing_role', { required: this._roleIds });
    }
}

class BotHasPermissionInhibitor extends Inhibitor {
    constructor(permissions, opts = {}) {
        super('BotHasPermission', opts);
        this._permissions = Array.isArray(permissions) ? permissions : [permissions];
    }

    async run(interaction) {
        const guild = interaction.guild;
        if (!guild) return InhibitorResult.ok();
        const botMember = guild.members.me;
        if (!botMember) return InhibitorResult.fail('bot_member_not_found');
        const missing = this._permissions.filter(p => !botMember.permissions?.has(p));
        if (missing.length === 0) return InhibitorResult.ok();
        return InhibitorResult.fail('bot_missing_permissions', { missing });
    }
}

class IsOwnerInhibitor extends Inhibitor {
    constructor(ownerIds, opts = {}) {
        super('IsOwner', opts);
        this._ownerIds = Array.isArray(ownerIds) ? ownerIds : [ownerIds];
    }

    async run(interaction) {
        const userId = interaction.user?.id ?? interaction.author?.id;
        if (this._ownerIds.includes(userId)) return InhibitorResult.ok();
        return InhibitorResult.fail('not_owner');
    }
}

class IsGuildOwnerInhibitor extends Inhibitor {
    constructor(opts = {}) { super('IsGuildOwner', opts); }

    async run(interaction) {
        const guild = interaction.guild;
        if (!guild) return InhibitorResult.fail('not_in_guild');
        const userId = interaction.user?.id ?? interaction.author?.id;
        if (guild.ownerId === userId) return InhibitorResult.ok();
        return InhibitorResult.fail('not_guild_owner');
    }
}

class InThreadInhibitor extends Inhibitor {
    constructor(opts = {}) { super('InThread', opts); }

    async run(interaction) {
        if (interaction.channel?.isThread?.()) return InhibitorResult.ok();
        return InhibitorResult.fail('not_in_thread');
    }
}

class InVoiceInhibitor extends Inhibitor {
    constructor(opts = {}) { super('InVoice', opts); }

    async run(interaction) {
        const member = interaction.member;
        if (!member) return InhibitorResult.fail('not_in_guild');
        if (member.voice?.channel) return InhibitorResult.ok();
        return InhibitorResult.fail('not_in_voice');
    }
}

class InGuildInhibitor extends Inhibitor {
    constructor(opts = {}) { super('InGuild', opts); }

    async run(interaction) {
        if (interaction.guild) return InhibitorResult.ok();
        return InhibitorResult.fail('not_in_guild');
    }
}

class InDMInhibitor extends Inhibitor {
    constructor(opts = {}) { super('InDM', opts); }

    async run(interaction) {
        if (!interaction.guild) return InhibitorResult.ok();
        return InhibitorResult.fail('not_in_dm');
    }
}

class BlacklistInhibitor extends Inhibitor {
    constructor(checker, opts = {}) {
        super('Blacklist', opts);
        this._checker = checker;
    }

    async run(interaction) {
        const userId = interaction.user?.id ?? interaction.author?.id;
        const guildId = interaction.guild?.id;
        const isBlacklisted = await this._checker(userId, guildId, interaction);
        if (!isBlacklisted) return InhibitorResult.ok();
        return InhibitorResult.fail('blacklisted', { userId, guildId });
    }
}

class RateLimitInhibitor extends Inhibitor {
    constructor(opts = {}) {
        super('RateLimit', opts);
        this._limit = opts.limit ?? 5;
        this._window = opts.window ?? 10000;
        this._scope = opts.scope ?? 'user';
        this._buckets = new Map();
        this._cleanupInterval = setInterval(() => this._cleanup(), 30000);
    }

    _getKey(interaction) {
        const userId = interaction.user?.id ?? interaction.author?.id ?? 'unknown';
        const guildId = interaction.guild?.id ?? 'dm';
        switch (this._scope) {
            case 'user': return userId;
            case 'guild': return guildId;
            case 'channel': return interaction.channel?.id ?? userId;
            case 'member': return `${guildId}:${userId}`;
            default: return userId;
        }
    }

    async run(interaction) {
        const key = this._getKey(interaction);
        const now = Date.now();
        const bucket = this._buckets.get(key) ?? { count: 0, windowStart: now };

        if (now - bucket.windowStart > this._window) {
            bucket.count = 0;
            bucket.windowStart = now;
        }

        if (bucket.count < this._limit) {
            bucket.count++;
            this._buckets.set(key, bucket);
            return InhibitorResult.ok();
        }

        const resetAt = bucket.windowStart + this._window;
        return InhibitorResult.fail('rate_limited', { resetAt, remaining: resetAt - now });
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, bucket] of this._buckets) {
            if (now - bucket.windowStart > this._window * 2) this._buckets.delete(key);
        }
    }

    destroy() {
        clearInterval(this._cleanupInterval);
        this._buckets.clear();
    }
}

class DisabledCommandInhibitor extends Inhibitor {
    constructor(checker, opts = {}) {
        super('DisabledCommand', opts);
        this._checker = checker;
    }

    async run(interaction, command) {
        const commandName = command?.name ?? 'unknown';
        const guildId = interaction.guild?.id;
        const isDisabled = await this._checker(commandName, guildId, interaction);
        if (!isDisabled) return InhibitorResult.ok();
        return InhibitorResult.fail('command_disabled', { commandName });
    }
}

class NSFWChannelInhibitor extends Inhibitor {
    constructor(opts = {}) { super('NSFWChannel', opts); }

    async run(interaction) {
        const channel = interaction.channel;
        if (!channel || !interaction.guild) return InhibitorResult.ok();
        if (channel.nsfw) return InhibitorResult.ok();
        return InhibitorResult.fail('not_nsfw_channel');
    }
}

class BotInVoiceInhibitor extends Inhibitor {
    constructor(opts = {}) { super('BotInVoice', opts); }

    async run(interaction) {
        const botVoice = interaction.guild?.members?.me?.voice?.channel;
        if (botVoice) return InhibitorResult.ok();
        return InhibitorResult.fail('bot_not_in_voice');
    }
}

class SameVoiceChannelInhibitor extends Inhibitor {
    constructor(opts = {}) { super('SameVoiceChannel', opts); }

    async run(interaction) {
        const member = interaction.member;
        if (!member) return InhibitorResult.fail('not_in_guild');
        const memberVoice = member.voice?.channel;
        const botVoice = interaction.guild?.members?.me?.voice?.channel;
        if (!memberVoice) return InhibitorResult.fail('user_not_in_voice');
        if (!botVoice) return InhibitorResult.fail('bot_not_in_voice');
        if (memberVoice.id === botVoice.id) return InhibitorResult.ok();
        return InhibitorResult.fail('different_voice_channels');
    }
}

class InhibitorStore {
    constructor() {
        this._inhibitors = new Map();
    }

    register(inhibitor) {
        this._inhibitors.set(inhibitor.name, inhibitor);
        return this;
    }

    unregister(name) {
        this._inhibitors.delete(name);
        return this;
    }

    get(name) {
        return this._inhibitors.get(name) ?? null;
    }

    async runAll(interaction, command, context) {
        const sorted = [...this._inhibitors.values()]
            .filter(i => i.enabled)
            .sort((a, b) => b.priority - a.priority);

        for (const inhibitor of sorted) {
            const result = await inhibitor.run(interaction, command, context);
            if (!result.ok) return result;
        }
        return InhibitorResult.ok();
    }

    destroy() {
        for (const inhibitor of this._inhibitors.values()) {
            if (typeof inhibitor.destroy === 'function') inhibitor.destroy();
        }
    }
}

module.exports = {
    Inhibitor, InhibitorResult, InhibitorStore,
    HasPermissionInhibitor, HasRoleInhibitor, BotHasPermissionInhibitor,
    IsOwnerInhibitor, IsGuildOwnerInhibitor, InThreadInhibitor,
    InVoiceInhibitor, InGuildInhibitor, InDMInhibitor,
    BlacklistInhibitor, RateLimitInhibitor, DisabledCommandInhibitor,
    NSFWChannelInhibitor, BotInVoiceInhibitor, SameVoiceChannelInhibitor
};
