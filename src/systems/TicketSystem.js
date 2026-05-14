const { ChannelType, PermissionFlagsBits } = require('discord.js');

class TicketSystem {
    constructor(storage, opts = {}) {
        this._storage = storage;
        this._ns = opts.namespace ?? 'tickets';
        this._defaultCategory = opts.categoryId ?? null;
        this._supportRoles = opts.supportRoles ?? [];
    }

    async open(guild, userId, opts = {}) {
        const existing = await this._storage?.get(this._ns, `open:${guild.id}:${userId}`);
        if (existing) return { ok: false, reason: 'already_open', channelId: existing };

        const member = await guild.members.fetch(userId).catch(() => null);
        const channelName = opts.channelName ?? `ticket-${(member?.user?.username ?? userId).toLowerCase().slice(0, 16)}`;

        const overwrites = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ];

        for (const roleId of (opts.supportRoles ?? this._supportRoles)) {
            overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        }

        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: opts.categoryId ?? this._defaultCategory ?? undefined,
            permissionOverwrites: overwrites,
            topic: opts.topic ?? `Ticket for <@${userId}>`
        });

        await this._storage?.set(this._ns, `open:${guild.id}:${userId}`, channel.id);
        await this._storage?.set(this._ns, `channel:${channel.id}`, { guildId: guild.id, userId, openedAt: Date.now() });

        if (opts.welcome) {
            await channel.send(typeof opts.welcome === 'string' ? opts.welcome : opts.welcome).catch(() => {});
        }

        return { ok: true, channel };
    }

    async close(channel, opts = {}) {
        const meta = await this._storage?.get(this._ns, `channel:${channel.id}`);
        if (!meta) return { ok: false, reason: 'not_a_ticket' };

        let transcript = null;
        if (opts.transcript !== false) {
            transcript = await this.getTranscript(channel);
        }

        await this._storage?.delete(this._ns, `open:${meta.guildId}:${meta.userId}`);
        await this._storage?.delete(this._ns, `channel:${channel.id}`);

        if (opts.deleteChannel !== false) {
            await channel.delete(opts.reason ?? 'Ticket closed').catch(() => {});
        }

        return { ok: true, transcript, meta };
    }

    async getTranscript(channel) {
        const messages = [];
        let lastId;

        while (true) {
            const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
            if (!batch || batch.size === 0) break;
            for (const msg of batch.values()) {
                messages.unshift({
                    id: msg.id,
                    author: msg.author.username,
                    content: msg.content,
                    timestamp: msg.createdAt.toISOString(),
                    attachments: [...msg.attachments.values()].map(a => a.url)
                });
            }
            lastId = batch.last()?.id;
            if (batch.size < 100) break;
        }

        return messages;
    }

    async isOpen(guildId, userId) {
        const channelId = await this._storage?.get(this._ns, `open:${guildId}:${userId}`);
        return channelId ? channelId : null;
    }
}

module.exports = { TicketSystem };
