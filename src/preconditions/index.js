const { ChannelType, PermissionFlagsBits } = require('discord.js');

class PreconditionResult {
    constructor(ok, error = null) {
        this.ok = ok;
        this.error = error;
    }

    static ok() { return new PreconditionResult(true); }
    static err(error) { return new PreconditionResult(false, error); }
}

class Precondition {
    constructor(name) {
        this.name = name;
    }

    async run(interaction, command, context) {
        throw new Error(`Precondition "${this.name}" does not implement run()`);
    }
}

class BotOwnerPrecondition extends Precondition {
    constructor(ownerIds = []) {
        super('BotOwner');
        this._ownerIds = ownerIds;
    }

    async run(interaction) {
        const userId = interaction.user?.id ?? interaction.author?.id;
        if (this._ownerIds.includes(userId)) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'BotOwner', message: 'This command is restricted to bot owners.' });
    }
}

class GuildOwnerPrecondition extends Precondition {
    constructor() { super('GuildOwner'); }

    async run(interaction) {
        const guild = interaction.guild;
        if (!guild) return PreconditionResult.err({ identifier: 'GuildOnly', message: 'This command can only be used in a server.' });
        const userId = interaction.user?.id ?? interaction.author?.id;
        if (guild.ownerId === userId) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'GuildOwner', message: 'This command is restricted to the server owner.' });
    }
}

class GuildOnlyPrecondition extends Precondition {
    constructor() { super('GuildOnly'); }

    async run(interaction) {
        if (interaction.guild) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'GuildOnly', message: 'This command can only be used in a server.' });
    }
}

class DMOnlyPrecondition extends Precondition {
    constructor() { super('DMOnly'); }

    async run(interaction) {
        if (!interaction.guild) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'DMOnly', message: 'This command can only be used in direct messages.' });
    }
}

class NSFWPrecondition extends Precondition {
    constructor() { super('NSFW'); }

    async run(interaction) {
        const channel = interaction.channel;
        if (!channel) return PreconditionResult.err({ identifier: 'NSFW', message: 'Cannot determine channel type.' });
        if (!interaction.guild) return PreconditionResult.ok();
        if (channel.nsfw) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'NSFW', message: 'This command can only be used in NSFW channels.' });
    }
}

class VoiceOnlyPrecondition extends Precondition {
    constructor(opts = {}) {
        super('VoiceOnly');
        this._sameChannel = opts.sameChannel ?? false;
    }

    async run(interaction) {
        const member = interaction.member;
        if (!member) return PreconditionResult.err({ identifier: 'GuildOnly', message: 'This command can only be used in a server.' });
        if (!member.voice?.channel) {
            return PreconditionResult.err({ identifier: 'VoiceOnly', message: 'You must be in a voice channel to use this command.' });
        }
        if (this._sameChannel) {
            const botVoice = interaction.guild.members.me?.voice?.channel;
            if (botVoice && botVoice.id !== member.voice.channel.id) {
                return PreconditionResult.err({ identifier: 'SameVoiceChannel', message: 'You must be in the same voice channel as the bot.' });
            }
        }
        return PreconditionResult.ok();
    }
}

class ThreadOnlyPrecondition extends Precondition {
    constructor() { super('ThreadOnly'); }

    async run(interaction) {
        const channel = interaction.channel;
        if (channel?.isThread?.()) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'ThreadOnly', message: 'This command can only be used in a thread.' });
    }
}

class NotThreadPrecondition extends Precondition {
    constructor() { super('NotThread'); }

    async run(interaction) {
        const channel = interaction.channel;
        if (!channel?.isThread?.()) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'NotThread', message: 'This command cannot be used in a thread.' });
    }
}

class HasRolePrecondition extends Precondition {
    constructor(roleIds, opts = {}) {
        super('HasRole');
        this._roleIds = Array.isArray(roleIds) ? roleIds : [roleIds];
        this._requireAll = opts.requireAll ?? false;
    }

    async run(interaction) {
        const member = interaction.member;
        if (!member) return PreconditionResult.err({ identifier: 'GuildOnly', message: 'This command can only be used in a server.' });
        const memberRoles = member.roles?.cache ?? new Map();
        if (this._requireAll) {
            const hasAll = this._roleIds.every(id => memberRoles.has(id));
            if (hasAll) return PreconditionResult.ok();
            return PreconditionResult.err({ identifier: 'HasRole', message: 'You are missing required roles.' });
        }
        const hasAny = this._roleIds.some(id => memberRoles.has(id));
        if (hasAny) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'HasRole', message: 'You are missing required roles.' });
    }
}

class MissingRolePrecondition extends Precondition {
    constructor(roleIds) {
        super('MissingRole');
        this._roleIds = Array.isArray(roleIds) ? roleIds : [roleIds];
    }

    async run(interaction) {
        const member = interaction.member;
        if (!member) return PreconditionResult.err({ identifier: 'GuildOnly', message: 'This command can only be used in a server.' });
        const memberRoles = member.roles?.cache ?? new Map();
        const hasAny = this._roleIds.some(id => memberRoles.has(id));
        if (!hasAny) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'MissingRole', message: 'You have a role that prevents you from using this command.' });
    }
}

class UserPermissionsPrecondition extends Precondition {
    constructor(permissions) {
        super('UserPermissions');
        this._permissions = Array.isArray(permissions) ? permissions : [permissions];
    }

    async run(interaction) {
        const member = interaction.member;
        if (!member) return PreconditionResult.err({ identifier: 'GuildOnly', message: 'This command can only be used in a server.' });
        const missing = this._permissions.filter(p => !member.permissions?.has(p));
        if (missing.length === 0) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'UserPermissions', message: `You are missing permissions: ${missing.join(', ')}`, missing });
    }
}

class BotPermissionsPrecondition extends Precondition {
    constructor(permissions) {
        super('BotPermissions');
        this._permissions = Array.isArray(permissions) ? permissions : [permissions];
    }

    async run(interaction) {
        const guild = interaction.guild;
        if (!guild) return PreconditionResult.err({ identifier: 'GuildOnly', message: 'This command can only be used in a server.' });
        const botMember = guild.members.me;
        if (!botMember) return PreconditionResult.err({ identifier: 'BotPermissions', message: 'Could not determine bot permissions.' });
        const missing = this._permissions.filter(p => !botMember.permissions?.has(p));
        if (missing.length === 0) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'BotPermissions', message: `Bot is missing permissions: ${missing.join(', ')}`, missing });
    }
}

class CooldownPrecondition extends Precondition {
    constructor(opts = {}) {
        super('Cooldown');
        this._duration = opts.duration ?? 5000;
        this._limit = opts.limit ?? 1;
        this._scope = opts.scope ?? 'user';
        this._buckets = new Map();
        this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
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
        const bucket = this._buckets.get(key) ?? { uses: 0, resetAt: now + this._duration };

        if (now > bucket.resetAt) {
            bucket.uses = 0;
            bucket.resetAt = now + this._duration;
        }

        if (bucket.uses < this._limit) {
            bucket.uses++;
            this._buckets.set(key, bucket);
            return PreconditionResult.ok();
        }

        const remaining = bucket.resetAt - now;
        return PreconditionResult.err({
            identifier: 'Cooldown',
            message: `You are on cooldown. Please wait ${(remaining / 1000).toFixed(1)} seconds.`,
            remaining,
            resetAt: bucket.resetAt
        });
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, bucket] of this._buckets) {
            if (now > bucket.resetAt + this._duration) this._buckets.delete(key);
        }
    }

    destroy() {
        clearInterval(this._cleanupInterval);
        this._buckets.clear();
    }
}

class PremiumPrecondition extends Precondition {
    constructor(checker) {
        super('Premium');
        this._checker = checker;
    }

    async run(interaction) {
        const userId = interaction.user?.id ?? interaction.author?.id;
        const guildId = interaction.guild?.id;
        const result = await this._checker(userId, guildId, interaction);
        if (result) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'Premium', message: 'This command requires a premium subscription.' });
    }
}

class BlacklistPrecondition extends Precondition {
    constructor(checker) {
        super('Blacklist');
        this._checker = checker;
    }

    async run(interaction) {
        const userId = interaction.user?.id ?? interaction.author?.id;
        const guildId = interaction.guild?.id;
        const isBlacklisted = await this._checker(userId, guildId, interaction);
        if (!isBlacklisted) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'Blacklist', message: 'You are blacklisted from using this bot.' });
    }
}

class ChannelTypePrecondition extends Precondition {
    constructor(types) {
        super('ChannelType');
        this._types = Array.isArray(types) ? types : [types];
    }

    async run(interaction) {
        const channel = interaction.channel;
        if (!channel) return PreconditionResult.err({ identifier: 'ChannelType', message: 'Cannot determine channel type.' });
        if (this._types.includes(channel.type)) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'ChannelType', message: `This command can only be used in specific channel types.` });
    }
}

class GuildBoostPrecondition extends Precondition {
    constructor(minTier = 1) {
        super('GuildBoost');
        this._minTier = minTier;
    }

    async run(interaction) {
        const guild = interaction.guild;
        if (!guild) return PreconditionResult.err({ identifier: 'GuildOnly', message: 'This command can only be used in a server.' });
        if (guild.premiumTier >= this._minTier) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'GuildBoost', message: `This command requires server boost tier ${this._minTier}.` });
    }
}

class MemberAgePrecondition extends Precondition {
    constructor(minAge) {
        super('MemberAge');
        this._minAge = minAge;
    }

    async run(interaction) {
        const member = interaction.member;
        if (!member) return PreconditionResult.err({ identifier: 'GuildOnly', message: 'This command can only be used in a server.' });
        const joinedAt = member.joinedAt;
        if (!joinedAt) return PreconditionResult.err({ identifier: 'MemberAge', message: 'Could not determine join date.' });
        const age = Date.now() - joinedAt.getTime();
        if (age >= this._minAge) return PreconditionResult.ok();
        const remaining = this._minAge - age;
        return PreconditionResult.err({
            identifier: 'MemberAge',
            message: `You must have been in this server for longer to use this command.`,
            remaining
        });
    }
}

class AccountAgePrecondition extends Precondition {
    constructor(minAge) {
        super('AccountAge');
        this._minAge = minAge;
    }

    async run(interaction) {
        const user = interaction.user ?? interaction.author;
        if (!user) return PreconditionResult.err({ identifier: 'AccountAge', message: 'Could not determine user.' });
        const age = Date.now() - user.createdAt.getTime();
        if (age >= this._minAge) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'AccountAge', message: 'Your account is too new to use this command.' });
    }
}

class EnabledPrecondition extends Precondition {
    constructor(checker) {
        super('Enabled');
        this._checker = checker;
    }

    async run(interaction, command) {
        const guildId = interaction.guild?.id;
        const commandName = command?.name ?? 'unknown';
        const enabled = await this._checker(commandName, guildId, interaction);
        if (enabled !== false) return PreconditionResult.ok();
        return PreconditionResult.err({ identifier: 'Disabled', message: 'This command is currently disabled.' });
    }
}

class PreconditionContainer {
    constructor(preconditions = [], opts = {}) {
        this._preconditions = preconditions;
        this._mode = opts.mode ?? 'and';
    }

    add(precondition) {
        this._preconditions.push(precondition);
        return this;
    }

    async run(interaction, command, context) {
        if (this._mode === 'and') {
            for (const precondition of this._preconditions) {
                const result = await precondition.run(interaction, command, context);
                if (!result.ok) return result;
            }
            return PreconditionResult.ok();
        }

        const errors = [];
        for (const precondition of this._preconditions) {
            const result = await precondition.run(interaction, command, context);
            if (result.ok) return PreconditionResult.ok();
            errors.push(result.error);
        }
        return PreconditionResult.err(errors[0]);
    }
}

module.exports = {
    Precondition, PreconditionResult, PreconditionContainer,
    BotOwnerPrecondition, GuildOwnerPrecondition, GuildOnlyPrecondition,
    DMOnlyPrecondition, NSFWPrecondition, VoiceOnlyPrecondition,
    ThreadOnlyPrecondition, NotThreadPrecondition, HasRolePrecondition,
    MissingRolePrecondition, UserPermissionsPrecondition, BotPermissionsPrecondition,
    CooldownPrecondition, PremiumPrecondition, BlacklistPrecondition,
    ChannelTypePrecondition, GuildBoostPrecondition, MemberAgePrecondition,
    AccountAgePrecondition, EnabledPrecondition
};
