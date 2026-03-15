const { EventEmitter } = require('events');

class AntiSpam extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._maxMessages = opts.maxMessages ?? 5;
        this._interval = opts.interval ?? 5000;
        this._punishmentType = opts.punishmentType ?? 'mute';
        this._muteDuration = opts.muteDuration ?? 60000;
        this._warnThreshold = opts.warnThreshold ?? 3;
        this._deleteMessages = opts.deleteMessages ?? true;
        this._ignoreBots = opts.ignoreBots ?? true;
        this._ignoredUsers = new Set(opts.ignoredUsers ?? []);
        this._ignoredRoles = new Set(opts.ignoredRoles ?? []);
        this._ignoredChannels = new Set(opts.ignoredChannels ?? []);
        this._ignoredGuilds = new Set(opts.ignoredGuilds ?? []);
        this._muteRoleId = opts.muteRoleId ?? null;
        this._moderationAPI = opts.moderationAPI ?? null;
        this._buckets = new Map();
        this._cleanupInterval = setInterval(() => this._cleanup(), 30000);
    }

    setModerationAPI(api) {
        this._moderationAPI = api;
        return this;
    }

    _getKey(message) {
        return `${message.guild?.id ?? 'dm'}:${message.author.id}`;
    }

    _isIgnored(message) {
        if (this._ignoreBots && message.author.bot) return true;
        if (this._ignoredUsers.has(message.author.id)) return true;
        if (this._ignoredChannels.has(message.channel.id)) return true;
        if (message.guild && this._ignoredGuilds.has(message.guild.id)) return true;
        if (message.member) {
            for (const roleId of this._ignoredRoles) {
                if (message.member.roles.cache.has(roleId)) return true;
            }
        }
        return false;
    }

    async check(message) {
        if (this._isIgnored(message)) return { spam: false };

        const key = this._getKey(message);
        const now = Date.now();
        const bucket = this._buckets.get(key) ?? { messages: [], warned: false };

        bucket.messages.push({ id: message.id, timestamp: now, channelId: message.channel.id });
        bucket.messages = bucket.messages.filter(m => now - m.timestamp < this._interval);

        this._buckets.set(key, bucket);

        if (bucket.messages.length >= this._warnThreshold && !bucket.warned) {
            bucket.warned = true;
            this.emit('warn', message, bucket.messages.length);
        }

        if (bucket.messages.length >= this._maxMessages) {
            const spamMessages = [...bucket.messages];
            bucket.messages = [];
            bucket.warned = false;
            this._buckets.set(key, bucket);

            this.emit('spam', message, spamMessages);

            if (this._deleteMessages) {
                await this._deleteSpamMessages(message, spamMessages);
            }

            await this._punish(message);

            return { spam: true, messages: spamMessages };
        }

        return { spam: false, count: bucket.messages.length };
    }

    async _deleteSpamMessages(message, spamMessages) {
        const channelGroups = new Map();
        for (const msg of spamMessages) {
            if (!channelGroups.has(msg.channelId)) channelGroups.set(msg.channelId, []);
            channelGroups.get(msg.channelId).push(msg.id);
        }
        for (const [channelId, ids] of channelGroups) {
            try {
                const channel = message.guild?.channels?.cache?.get(channelId);
                if (channel?.bulkDelete) {
                    await channel.bulkDelete(ids, true).catch(() => {});
                }
            } catch (_) {}
        }
    }

    async _punish(message) {
        if (!message.guild || !this._moderationAPI) return;
        const guild = message.guild;
        const userId = message.author.id;
        const botId = message.client.user?.id ?? 'bot';

        try {
            switch (this._punishmentType) {
                case 'mute':
                    if (this._muteRoleId) {
                        await this._moderationAPI.mute(guild, userId, this._muteRoleId, {
                            reason: 'Anti-spam: excessive messages',
                            moderatorId: botId,
                            duration: this._muteDuration
                        });
                    } else {
                        await this._moderationAPI.timeout(guild, userId, this._muteDuration, {
                            reason: 'Anti-spam: excessive messages',
                            moderatorId: botId
                        });
                    }
                    break;
                case 'kick':
                    await this._moderationAPI.kick(guild, userId, {
                        reason: 'Anti-spam: excessive messages',
                        moderatorId: botId
                    });
                    break;
                case 'ban':
                    await this._moderationAPI.ban(guild, userId, {
                        reason: 'Anti-spam: excessive messages',
                        moderatorId: botId
                    });
                    break;
                case 'warn':
                    await this._moderationAPI.warn(guild, userId, {
                        reason: 'Anti-spam: excessive messages',
                        moderatorId: botId
                    });
                    break;
            }
        } catch (e) {
            this.emit('error', e);
        }
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, bucket] of this._buckets) {
            const active = bucket.messages.filter(m => now - m.timestamp < this._interval);
            if (active.length === 0) {
                this._buckets.delete(key);
            } else {
                bucket.messages = active;
            }
        }
    }

    addIgnoredUser(userId) { this._ignoredUsers.add(userId); return this; }
    removeIgnoredUser(userId) { this._ignoredUsers.delete(userId); return this; }
    addIgnoredChannel(channelId) { this._ignoredChannels.add(channelId); return this; }
    removeIgnoredChannel(channelId) { this._ignoredChannels.delete(channelId); return this; }
    addIgnoredRole(roleId) { this._ignoredRoles.add(roleId); return this; }
    removeIgnoredRole(roleId) { this._ignoredRoles.delete(roleId); return this; }

    getStats() {
        return {
            trackedUsers: this._buckets.size,
            totalMessages: [...this._buckets.values()].reduce((sum, b) => sum + b.messages.length, 0)
        };
    }

    destroy() {
        clearInterval(this._cleanupInterval);
        this._buckets.clear();
    }
}

module.exports = { AntiSpam };
