const { EventEmitter } = require('events');

class LevelingSystem extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._storage = opts.storage ?? null;
        this._client = null;
        this._xpPerMessage = opts.xpPerMessage ?? [15, 25];
        this._xpCooldown = opts.xpCooldown ?? 60000;
        this._levelUpMessage = opts.levelUpMessage ?? '{user} leveled up to level **{level}**!';
        this._levelUpChannelId = opts.levelUpChannelId ?? null;
        this._levelUpDM = opts.levelUpDM ?? false;
        this._stackRoles = opts.stackRoles ?? true;
        this._ignoreBots = opts.ignoreBots ?? true;
        this._ignoredChannels = new Set(opts.ignoredChannels ?? []);
        this._ignoredRoles = new Set(opts.ignoredRoles ?? []);
        this._multipliers = new Map();
        this._cooldowns = new Map();
        this._levelRoles = new Map(Object.entries(opts.levelRoles ?? {}));
        this._xpMultiplier = opts.xpMultiplier ?? 1;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    setStorage(storage) {
        this._storage = storage;
        return this;
    }

    _xpForLevel(level) {
        return Math.floor(100 * Math.pow(level, 1.5));
    }

    _levelFromXp(xp) {
        let level = 0;
        let totalXp = 0;
        while (totalXp + this._xpForLevel(level + 1) <= xp) {
            totalXp += this._xpForLevel(level + 1);
            level++;
        }
        return level;
    }

    _xpToNextLevel(level) {
        return this._xpForLevel(level + 1);
    }

    async getUserData(guildId, userId) {
        if (!this._storage) return { xp: 0, level: 0, messages: 0 };
        const data = await this._storage.get('leveling', `${guildId}:${userId}`);
        return data ?? { xp: 0, level: 0, messages: 0 };
    }

    async setUserData(guildId, userId, data) {
        if (!this._storage) return;
        await this._storage.set('leveling', `${guildId}:${userId}`, data);
    }

    async addXp(guildId, userId, amount) {
        const data = await this.getUserData(guildId, userId);
        const oldLevel = data.level;
        data.xp += amount;
        data.level = this._levelFromXp(data.xp);
        await this.setUserData(guildId, userId, data);
        return { ...data, oldLevel, leveledUp: data.level > oldLevel };
    }

    async removeXp(guildId, userId, amount) {
        const data = await this.getUserData(guildId, userId);
        data.xp = Math.max(0, data.xp - amount);
        data.level = this._levelFromXp(data.xp);
        await this.setUserData(guildId, userId, data);
        return data;
    }

    async setLevel(guildId, userId, level) {
        const data = await this.getUserData(guildId, userId);
        let xp = 0;
        for (let i = 1; i <= level; i++) xp += this._xpForLevel(i);
        data.xp = xp;
        data.level = level;
        await this.setUserData(guildId, userId, data);
        return data;
    }

    async resetUser(guildId, userId) {
        await this.setUserData(guildId, userId, { xp: 0, level: 0, messages: 0 });
    }

    async getLeaderboard(guildId, opts = {}) {
        if (!this._storage) return [];
        const entries = await this._storage.entries('leveling');
        const guildEntries = entries
            .filter(([k]) => k.startsWith(`${guildId}:`))
            .map(([k, v]) => ({ userId: k.split(':')[1], ...v }))
            .sort((a, b) => b.xp - a.xp);
        const limit = opts.limit ?? 10;
        const offset = opts.offset ?? 0;
        return guildEntries.slice(offset, offset + limit);
    }

    async getRank(guildId, userId) {
        const leaderboard = await this.getLeaderboard(guildId, { limit: Infinity });
        const index = leaderboard.findIndex(e => e.userId === userId);
        return index === -1 ? null : index + 1;
    }

    _getMultiplier(message) {
        let multiplier = this._xpMultiplier;
        if (message.member) {
            for (const [roleId, mult] of this._multipliers) {
                if (message.member.roles.cache.has(roleId)) {
                    multiplier = Math.max(multiplier, mult);
                }
            }
        }
        return multiplier;
    }

    setRoleMultiplier(roleId, multiplier) {
        this._multipliers.set(roleId, multiplier);
        return this;
    }

    setLevelRole(level, roleId) {
        this._levelRoles.set(String(level), roleId);
        return this;
    }

    async _assignLevelRoles(member, level) {
        if (!member || this._levelRoles.size === 0) return;
        const earnedRoles = [];
        for (const [lvl, roleId] of this._levelRoles) {
            if (parseInt(lvl) <= level) earnedRoles.push(roleId);
        }
        if (!this._stackRoles) {
            const highestLevel = Math.max(...[...this._levelRoles.keys()].map(Number).filter(l => l <= level));
            const highestRole = this._levelRoles.get(String(highestLevel));
            if (highestRole) {
                for (const [, roleId] of this._levelRoles) {
                    if (roleId !== highestRole && member.roles.cache.has(roleId)) {
                        await member.roles.remove(roleId).catch(() => {});
                    }
                }
                if (!member.roles.cache.has(highestRole)) {
                    await member.roles.add(highestRole).catch(() => {});
                }
            }
        } else {
            for (const roleId of earnedRoles) {
                if (!member.roles.cache.has(roleId)) {
                    await member.roles.add(roleId).catch(() => {});
                }
            }
        }
    }

    async onMessage(message) {
        if (this._ignoreBots && message.author?.bot) return null;
        if (!message.guild) return null;
        if (this._ignoredChannels.has(message.channel.id)) return null;
        if (message.member) {
            for (const roleId of this._ignoredRoles) {
                if (message.member.roles.cache.has(roleId)) return null;
            }
        }

        const cooldownKey = `${message.guild.id}:${message.author.id}`;
        const lastMessage = this._cooldowns.get(cooldownKey) ?? 0;
        if (Date.now() - lastMessage < this._xpCooldown) return null;
        this._cooldowns.set(cooldownKey, Date.now());

        const [min, max] = this._xpPerMessage;
        const baseXp = Math.floor(Math.random() * (max - min + 1)) + min;
        const multiplier = this._getMultiplier(message);
        const xpGained = Math.floor(baseXp * multiplier);

        const result = await this.addXp(message.guild.id, message.author.id, xpGained);
        result.messages = (result.messages ?? 0) + 1;
        await this.setUserData(message.guild.id, message.author.id, result);

        if (result.leveledUp) {
            this.emit('levelUp', message.member ?? message.author, result.level, result.oldLevel);
            await this._assignLevelRoles(message.member, result.level);

            const levelUpText = this._levelUpMessage
                .replace(/{user}/g, `<@${message.author.id}>`)
                .replace(/{level}/g, String(result.level))
                .replace(/{xp}/g, String(result.xp));

            const channelId = this._levelUpChannelId ?? message.channel.id;
            const channel = message.guild.channels.cache.get(channelId);
            if (channel?.isTextBased()) {
                await channel.send({ content: levelUpText }).catch(() => {});
            }

            if (this._levelUpDM) {
                await message.author.send({ content: levelUpText }).catch(() => {});
            }
        }

        return { xpGained, ...result };
    }

    getProgress(xp, level) {
        const levelXp = this._xpForLevel(level + 1);
        let currentLevelXp = 0;
        for (let i = 1; i <= level; i++) currentLevelXp += this._xpForLevel(i);
        const progress = xp - currentLevelXp;
        return { current: progress, required: levelXp, percentage: Math.floor((progress / levelXp) * 100) };
    }
}

module.exports = { LevelingSystem };
