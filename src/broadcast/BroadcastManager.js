class BroadcastManager {
    constructor(client, opts = {}) {
        this._client = client;
        this._delayMs = opts.delayMs ?? 300;
    }

    async _send(channel, payload) {
        try {
            await channel.send(payload);
            return { ok: true, id: channel.id };
        } catch (err) {
            return { ok: false, id: channel.id, error: err?.message };
        }
    }

    async _delay() {
        if (this._delayMs > 0) await new Promise(r => setTimeout(r, this._delayMs));
    }

    async send(channelIds, payload, opts = {}) {
        const ids = Array.isArray(channelIds) ? channelIds : [channelIds];
        const sent = [];
        const failed = [];

        for (const id of ids) {
            let ch = this._client.channels.cache.get(id);
            if (!ch) {
                try { ch = await this._client.channels.fetch(id); } catch (_) {}
            }
            if (!ch) {
                failed.push({ id, error: 'Channel not found' });
            } else {
                const result = await this._send(ch, payload);
                (result.ok ? sent : failed).push(result);
            }
            if (!opts.skipDelay) await this._delay();
        }

        return { sent, failed };
    }

    async sendToGuilds(guildIds, channelFinder, payload, opts = {}) {
        const ids = Array.isArray(guildIds) ? guildIds : [guildIds];
        const sent = [];
        const failed = [];

        for (const guildId of ids) {
            let guild = this._client.guilds.cache.get(guildId);
            if (!guild) {
                try { guild = await this._client.guilds.fetch(guildId); } catch (_) {}
            }
            if (!guild) {
                failed.push({ id: guildId, error: 'Guild not found' });
                continue;
            }
            const channel = await channelFinder(guild);
            if (!channel) {
                failed.push({ id: guildId, error: 'Channel not resolved' });
            } else {
                const result = await this._send(channel, payload);
                (result.ok ? sent : failed).push(result);
            }
            if (!opts.skipDelay) await this._delay();
        }

        return { sent, failed };
    }

    async dm(userIds, payload, opts = {}) {
        const ids = Array.isArray(userIds) ? userIds : [userIds];
        const sent = [];
        const failed = [];

        for (const userId of ids) {
            try {
                let user = this._client.users.cache.get(userId);
                if (!user) user = await this._client.users.fetch(userId);
                const dm = await user.createDM();
                const result = await this._send(dm, payload);
                (result.ok ? sent : failed).push({ ...result, id: userId });
            } catch (err) {
                failed.push({ id: userId, error: err?.message });
            }
            if (!opts.skipDelay) await this._delay();
        }

        return { sent, failed };
    }

    async announce(guild, payload, opts = {}) {
        const { permission = 'SendMessages' } = opts;
        const channels = guild.channels.cache.filter(ch =>
            ch.isTextBased?.() &&
            !ch.isThread?.() &&
            guild.members.me?.permissionsIn(ch)?.has(permission)
        );
        return this.send([...channels.keys()], payload, { skipDelay: false });
    }
}

module.exports = { BroadcastManager };
