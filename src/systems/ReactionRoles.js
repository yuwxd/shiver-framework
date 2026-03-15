const { EventEmitter } = require('events');

class ReactionRoles extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._storage = opts.storage ?? null;
        this._client = null;
        this._cache = new Map();
        this._exclusive = opts.exclusive ?? false;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    setStorage(storage) {
        this._storage = storage;
        return this;
    }

    _cacheKey(guildId, channelId, messageId) {
        return `${guildId}:${channelId}:${messageId}`;
    }

    async addReactionRole(guildId, channelId, messageId, emoji, roleId, opts = {}) {
        const key = this._cacheKey(guildId, channelId, messageId);
        const existing = await this._getMessageConfig(key) ?? { roles: [] };
        const emojiKey = this._normalizeEmoji(emoji);
        existing.roles = existing.roles.filter(r => r.emoji !== emojiKey);
        existing.roles.push({
            emoji: emojiKey,
            roleId,
            exclusive: opts.exclusive ?? this._exclusive,
            requiredRole: opts.requiredRole ?? null,
            maxUsers: opts.maxUsers ?? null
        });
        await this._setMessageConfig(key, existing);
        this._cache.set(key, existing);
        return this;
    }

    async removeReactionRole(guildId, channelId, messageId, emoji) {
        const key = this._cacheKey(guildId, channelId, messageId);
        const config = await this._getMessageConfig(key);
        if (!config) return this;
        const emojiKey = this._normalizeEmoji(emoji);
        config.roles = config.roles.filter(r => r.emoji !== emojiKey);
        await this._setMessageConfig(key, config);
        this._cache.set(key, config);
        return this;
    }

    async removeMessage(guildId, channelId, messageId) {
        const key = this._cacheKey(guildId, channelId, messageId);
        if (this._storage) await this._storage.delete('reaction_roles', key);
        this._cache.delete(key);
        return this;
    }

    _normalizeEmoji(emoji) {
        if (typeof emoji === 'string') return emoji;
        if (emoji.id) return `${emoji.animated ? 'a:' : ''}${emoji.name}:${emoji.id}`;
        return emoji.name;
    }

    async _getMessageConfig(key) {
        const cached = this._cache.get(key);
        if (cached) return cached;
        if (!this._storage) return null;
        const data = await this._storage.get('reaction_roles', key);
        if (data) this._cache.set(key, data);
        return data;
    }

    async _setMessageConfig(key, config) {
        if (!this._storage) return;
        await this._storage.set('reaction_roles', key, config);
    }

    async onReactionAdd(reaction, user) {
        if (user.bot) return;
        const message = reaction.message;
        const guild = message.guild;
        if (!guild) return;

        const key = this._cacheKey(guild.id, message.channel.id, message.id);
        const config = await this._getMessageConfig(key);
        if (!config || !config.roles.length) return;

        const emojiKey = this._normalizeEmoji(reaction.emoji);
        const roleConfig = config.roles.find(r => r.emoji === emojiKey);
        if (!roleConfig) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        if (roleConfig.requiredRole && !member.roles.cache.has(roleConfig.requiredRole)) {
            await reaction.users.remove(user.id).catch(() => {});
            this.emit('requirementNotMet', member, roleConfig);
            return;
        }

        if (roleConfig.maxUsers) {
            const role = guild.roles.cache.get(roleConfig.roleId);
            if (role && role.members.size >= roleConfig.maxUsers) {
                await reaction.users.remove(user.id).catch(() => {});
                this.emit('maxUsersReached', member, roleConfig);
                return;
            }
        }

        if (roleConfig.exclusive) {
            for (const otherRole of config.roles) {
                if (otherRole.emoji !== emojiKey && member.roles.cache.has(otherRole.roleId)) {
                    await member.roles.remove(otherRole.roleId).catch(() => {});
                    const otherReaction = message.reactions.cache.find(r =>
                        this._normalizeEmoji(r.emoji) === otherRole.emoji
                    );
                    if (otherReaction) await otherReaction.users.remove(user.id).catch(() => {});
                }
            }
        }

        await member.roles.add(roleConfig.roleId, 'Reaction role').catch(() => {});
        this.emit('roleAdded', member, roleConfig.roleId, reaction);
    }

    async onReactionRemove(reaction, user) {
        if (user.bot) return;
        const message = reaction.message;
        const guild = message.guild;
        if (!guild) return;

        const key = this._cacheKey(guild.id, message.channel.id, message.id);
        const config = await this._getMessageConfig(key);
        if (!config || !config.roles.length) return;

        const emojiKey = this._normalizeEmoji(reaction.emoji);
        const roleConfig = config.roles.find(r => r.emoji === emojiKey);
        if (!roleConfig) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        await member.roles.remove(roleConfig.roleId, 'Reaction role removed').catch(() => {});
        this.emit('roleRemoved', member, roleConfig.roleId, reaction);
    }

    async getAll(guildId) {
        if (!this._storage) return [];
        const entries = await this._storage.entries('reaction_roles');
        return entries
            .filter(([k]) => k.startsWith(`${guildId}:`))
            .map(([k, v]) => {
                const [, channelId, messageId] = k.split(':');
                return { channelId, messageId, ...v };
            });
    }
}

module.exports = { ReactionRoles };
