const { AuditLogEvent } = require('discord.js');

const CASE_TYPES = {
    BAN: 'ban',
    UNBAN: 'unban',
    KICK: 'kick',
    MUTE: 'mute',
    UNMUTE: 'unmute',
    WARN: 'warn',
    SOFTBAN: 'softban',
    TIMEOUT: 'timeout',
    UNTIMEOUT: 'untimeout',
    NOTE: 'note',
    SLOWMODE: 'slowmode',
    PURGE: 'purge',
    LOCK: 'lock',
    UNLOCK: 'unlock'
};

class ModerationCase {
    constructor(data) {
        this.id = data.id;
        this.type = data.type;
        this.guildId = data.guildId;
        this.userId = data.userId;
        this.moderatorId = data.moderatorId;
        this.reason = data.reason ?? 'No reason provided.';
        this.createdAt = data.createdAt ?? new Date();
        this.expiresAt = data.expiresAt ?? null;
        this.active = data.active ?? true;
        this.metadata = data.metadata ?? {};
        this.logMessageId = data.logMessageId ?? null;
        this.dmSent = data.dmSent ?? false;
    }

    toJSON() {
        return {
            id: this.id, type: this.type, guildId: this.guildId,
            userId: this.userId, moderatorId: this.moderatorId,
            reason: this.reason, createdAt: this.createdAt.toISOString(),
            expiresAt: this.expiresAt?.toISOString() ?? null,
            active: this.active, metadata: this.metadata,
            logMessageId: this.logMessageId, dmSent: this.dmSent
        };
    }
}

class ModerationAPI {
    constructor(opts = {}) {
        this._client = null;
        this._storage = opts.storage ?? null;
        this._logChannelId = opts.logChannelId ?? null;
        this._dmOnAction = opts.dmOnAction ?? true;
        this._caseCounter = new Map();
        this._activeMutes = new Map();
        this._activeTimeouts = new Map();
        this._opts = opts;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    setStorage(storage) {
        this._storage = storage;
        return this;
    }

    setLogChannel(channelId) {
        this._logChannelId = channelId;
        return this;
    }

    async _nextCaseId(guildId) {
        if (this._storage) {
            const current = (await this._storage.get('moderation_cases_counter', guildId)) ?? 0;
            const next = current + 1;
            await this._storage.set('moderation_cases_counter', guildId, next);
            return next;
        }
        const current = this._caseCounter.get(guildId) ?? 0;
        const next = current + 1;
        this._caseCounter.set(guildId, next);
        return next;
    }

    async _saveCase(modCase) {
        if (!this._storage) return modCase;
        await this._storage.set('moderation_cases', `${modCase.guildId}:${modCase.id}`, modCase.toJSON());
        return modCase;
    }

    async getCase(guildId, caseId) {
        if (!this._storage) return null;
        const data = await this._storage.get('moderation_cases', `${guildId}:${caseId}`);
        if (!data) return null;
        return new ModerationCase({ ...data, createdAt: new Date(data.createdAt) });
    }

    async getCases(guildId, opts = {}) {
        if (!this._storage) return [];
        const entries = await this._storage.entries('moderation_cases');
        let cases = entries
            .filter(([k]) => k.startsWith(`${guildId}:`))
            .map(([, v]) => new ModerationCase({ ...v, createdAt: new Date(v.createdAt) }));

        if (opts.userId) cases = cases.filter(c => c.userId === opts.userId);
        if (opts.type) cases = cases.filter(c => c.type === opts.type);
        if (opts.active !== undefined) cases = cases.filter(c => c.active === opts.active);
        if (opts.moderatorId) cases = cases.filter(c => c.moderatorId === opts.moderatorId);

        cases.sort((a, b) => b.createdAt - a.createdAt);

        if (opts.limit) cases = cases.slice(0, opts.limit);
        return cases;
    }

    async updateCase(guildId, caseId, updates) {
        const existing = await this.getCase(guildId, caseId);
        if (!existing) return null;
        Object.assign(existing, updates);
        await this._saveCase(existing);
        return existing;
    }

    async _sendDM(userId, embed) {
        if (!this._client || !this._dmOnAction) return false;
        try {
            const user = await this._client.users.fetch(userId);
            await user.send({ embeds: [embed] });
            return true;
        } catch (_) {
            return false;
        }
    }

    async _logToChannel(guild, modCase) {
        const channelId = this._logChannelId ?? this._opts.getLogChannel?.(guild.id);
        if (!channelId || !this._client) return null;
        try {
            const channel = await this._client.channels.fetch(channelId);
            if (!channel?.isTextBased()) return null;
            const { EmbedBuilder } = require('discord.js');
            const colors = {
                ban: 0xFF0000, unban: 0x00FF00, kick: 0xFF8800,
                mute: 0xFF8800, unmute: 0x00FF00, warn: 0xFFFF00,
                softban: 0xFF4400, timeout: 0xFF8800, untimeout: 0x00FF00,
                note: 0x5865F2, purge: 0x808080, lock: 0xFF0000, unlock: 0x00FF00
            };
            const embed = new EmbedBuilder()
                .setColor(colors[modCase.type] ?? 0x808080)
                .setTitle(`Case #${modCase.id} — ${modCase.type.toUpperCase()}`)
                .addFields(
                    { name: 'User', value: `<@${modCase.userId}> (${modCase.userId})`, inline: true },
                    { name: 'Moderator', value: `<@${modCase.moderatorId}> (${modCase.moderatorId})`, inline: true },
                    { name: 'Reason', value: modCase.reason }
                )
                .setTimestamp(modCase.createdAt);
            if (modCase.expiresAt) {
                embed.addFields({ name: 'Expires', value: `<t:${Math.floor(modCase.expiresAt.getTime() / 1000)}:R>`, inline: true });
            }
            const msg = await channel.send({ embeds: [embed] });
            return msg.id;
        } catch (_) {
            return null;
        }
    }

    async _createCase(guild, type, userId, moderatorId, reason, opts = {}) {
        const id = await this._nextCaseId(guild.id);
        const modCase = new ModerationCase({
            id, type, guildId: guild.id, userId, moderatorId, reason,
            expiresAt: opts.expiresAt ?? null,
            metadata: opts.metadata ?? {}
        });
        const logMessageId = await this._logToChannel(guild, modCase);
        if (logMessageId) modCase.logMessageId = logMessageId;
        await this._saveCase(modCase);
        return modCase;
    }

    async ban(guild, userId, opts = {}) {
        const { reason = 'No reason provided.', moderatorId, deleteMessageSeconds = 0, dmMessage, silent = false } = opts;
        const member = guild.members.cache.get(userId);

        if (!silent && this._dmOnAction && member) {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(`You have been banned from ${guild.name}`)
                .setDescription(dmMessage ?? `**Reason:** ${reason}`)
                .setTimestamp();
            const sent = await this._sendDM(userId, embed);
            const modCase = await this._createCase(guild, CASE_TYPES.BAN, userId, moderatorId, reason, opts);
            modCase.dmSent = sent;
            await guild.bans.create(userId, { reason, deleteMessageSeconds });
            await this._saveCase(modCase);
            return modCase;
        }

        await guild.bans.create(userId, { reason, deleteMessageSeconds });
        return this._createCase(guild, CASE_TYPES.BAN, userId, moderatorId, reason, opts);
    }

    async unban(guild, userId, opts = {}) {
        const { reason = 'No reason provided.', moderatorId } = opts;
        await guild.bans.remove(userId, reason);
        return this._createCase(guild, CASE_TYPES.UNBAN, userId, moderatorId, reason, opts);
    }

    async kick(guild, userId, opts = {}) {
        const { reason = 'No reason provided.', moderatorId, dmMessage, silent = false } = opts;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) throw new Error('Member not found');

        if (!silent && this._dmOnAction) {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setColor(0xFF8800)
                .setTitle(`You have been kicked from ${guild.name}`)
                .setDescription(dmMessage ?? `**Reason:** ${reason}`)
                .setTimestamp();
            const sent = await this._sendDM(userId, embed);
            const modCase = await this._createCase(guild, CASE_TYPES.KICK, userId, moderatorId, reason, opts);
            modCase.dmSent = sent;
            await member.kick(reason);
            await this._saveCase(modCase);
            return modCase;
        }

        await member.kick(reason);
        return this._createCase(guild, CASE_TYPES.KICK, userId, moderatorId, reason, opts);
    }

    async softban(guild, userId, opts = {}) {
        const { reason = 'No reason provided.', moderatorId, deleteMessageSeconds = 604800 } = opts;
        await guild.bans.create(userId, { reason: `Softban: ${reason}`, deleteMessageSeconds });
        await guild.bans.remove(userId, 'Softban: removing ban after message deletion');
        return this._createCase(guild, CASE_TYPES.SOFTBAN, userId, moderatorId, reason, opts);
    }

    async warn(guild, userId, opts = {}) {
        const { reason = 'No reason provided.', moderatorId, dmMessage, silent = false } = opts;

        if (!silent && this._dmOnAction) {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setColor(0xFFFF00)
                .setTitle(`You have received a warning in ${guild.name}`)
                .setDescription(dmMessage ?? `**Reason:** ${reason}`)
                .setTimestamp();
            const sent = await this._sendDM(userId, embed);
            const modCase = await this._createCase(guild, CASE_TYPES.WARN, userId, moderatorId, reason, opts);
            modCase.dmSent = sent;
            await this._saveCase(modCase);
            return modCase;
        }

        return this._createCase(guild, CASE_TYPES.WARN, userId, moderatorId, reason, opts);
    }

    async timeout(guild, userId, durationMs, opts = {}) {
        const { reason = 'No reason provided.', moderatorId, dmMessage, silent = false } = opts;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) throw new Error('Member not found');

        const expiresAt = new Date(Date.now() + durationMs);

        if (!silent && this._dmOnAction) {
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setColor(0xFF8800)
                .setTitle(`You have been timed out in ${guild.name}`)
                .setDescription(dmMessage ?? `**Reason:** ${reason}\n**Expires:** <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`)
                .setTimestamp();
            await this._sendDM(userId, embed);
        }

        await member.timeout(durationMs, reason);
        const modCase = await this._createCase(guild, CASE_TYPES.TIMEOUT, userId, moderatorId, reason, { ...opts, expiresAt });
        this._activeTimeouts.set(`${guild.id}:${userId}`, setTimeout(async () => {
            this._activeTimeouts.delete(`${guild.id}:${userId}`);
            await this.updateCase(guild.id, modCase.id, { active: false });
        }, durationMs));
        return modCase;
    }

    async untimeout(guild, userId, opts = {}) {
        const { reason = 'No reason provided.', moderatorId } = opts;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) throw new Error('Member not found');
        await member.timeout(null, reason);
        const key = `${guild.id}:${userId}`;
        if (this._activeTimeouts.has(key)) {
            clearTimeout(this._activeTimeouts.get(key));
            this._activeTimeouts.delete(key);
        }
        return this._createCase(guild, CASE_TYPES.UNTIMEOUT, userId, moderatorId, reason, opts);
    }

    async mute(guild, userId, muteRoleId, opts = {}) {
        const { reason = 'No reason provided.', moderatorId, duration } = opts;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) throw new Error('Member not found');
        await member.roles.add(muteRoleId, reason);
        const expiresAt = duration ? new Date(Date.now() + duration) : null;
        const modCase = await this._createCase(guild, CASE_TYPES.MUTE, userId, moderatorId, reason, { ...opts, expiresAt });
        if (duration) {
            const key = `${guild.id}:${userId}:mute`;
            if (this._activeMutes.has(key)) clearTimeout(this._activeMutes.get(key));
            this._activeMutes.set(key, setTimeout(async () => {
                this._activeMutes.delete(key);
                await this.unmute(guild, userId, muteRoleId, { reason: 'Automatic unmute (duration expired)', moderatorId: this._client?.user?.id });
            }, duration));
        }
        return modCase;
    }

    async unmute(guild, userId, muteRoleId, opts = {}) {
        const { reason = 'No reason provided.', moderatorId } = opts;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) throw new Error('Member not found');
        await member.roles.remove(muteRoleId, reason);
        const key = `${guild.id}:${userId}:mute`;
        if (this._activeMutes.has(key)) {
            clearTimeout(this._activeMutes.get(key));
            this._activeMutes.delete(key);
        }
        return this._createCase(guild, CASE_TYPES.UNMUTE, userId, moderatorId, reason, opts);
    }

    async note(guild, userId, note, opts = {}) {
        const { moderatorId } = opts;
        return this._createCase(guild, CASE_TYPES.NOTE, userId, moderatorId, note, opts);
    }

    async purge(channel, opts = {}) {
        const { amount = 100, filter, reason = 'Bulk delete', moderatorId } = opts;
        let messages = await channel.messages.fetch({ limit: Math.min(amount, 100) });
        if (filter) messages = messages.filter(filter);
        const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const deletable = messages.filter(m => m.createdTimestamp > twoWeeksAgo);
        let deleted;
        if (deletable.size === 1) {
            await deletable.first().delete();
            deleted = 1;
        } else if (deletable.size > 1) {
            const result = await channel.bulkDelete(deletable, true);
            deleted = result.size;
        } else {
            deleted = 0;
        }
        return this._createCase(
            channel.guild, CASE_TYPES.PURGE,
            opts.targetUserId ?? '0', moderatorId, reason,
            { ...opts, metadata: { channel: channel.id, deleted } }
        );
    }

    async lock(channel, opts = {}) {
        const { reason = 'Channel locked', moderatorId } = opts;
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: false }, { reason });
        return this._createCase(
            channel.guild, CASE_TYPES.LOCK,
            '0', moderatorId, reason,
            { ...opts, metadata: { channel: channel.id } }
        );
    }

    async unlock(channel, opts = {}) {
        const { reason = 'Channel unlocked', moderatorId } = opts;
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: null }, { reason });
        return this._createCase(
            channel.guild, CASE_TYPES.UNLOCK,
            '0', moderatorId, reason,
            { ...opts, metadata: { channel: channel.id } }
        );
    }

    async getWarnCount(guildId, userId) {
        const cases = await this.getCases(guildId, { userId, type: CASE_TYPES.WARN, active: true });
        return cases.length;
    }

    async clearWarns(guildId, userId, moderatorId) {
        const cases = await this.getCases(guildId, { userId, type: CASE_TYPES.WARN, active: true });
        for (const c of cases) {
            await this.updateCase(guildId, c.id, { active: false });
        }
        return cases.length;
    }

    async getActivePunishments(guildId, userId) {
        return this.getCases(guildId, { userId, active: true });
    }

    async fetchAuditLog(guild, type, opts = {}) {
        const { limit = 10, userId } = opts;
        const entries = await guild.fetchAuditLogs({ type, limit });
        let logs = [...entries.entries.values()];
        if (userId) logs = logs.filter(e => e.target?.id === userId);
        return logs;
    }

    async isBanned(guild, userId) {
        try {
            await guild.bans.fetch(userId);
            return true;
        } catch (_) {
            return false;
        }
    }

    async getMuteInfo(guildId, userId) {
        const cases = await this.getCases(guildId, { userId, type: CASE_TYPES.MUTE, active: true });
        return cases[0] ?? null;
    }

    destroy() {
        for (const timer of this._activeMutes.values()) clearTimeout(timer);
        for (const timer of this._activeTimeouts.values()) clearTimeout(timer);
        this._activeMutes.clear();
        this._activeTimeouts.clear();
    }
}

module.exports = { ModerationAPI, ModerationCase, CASE_TYPES };
