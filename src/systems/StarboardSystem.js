class StarboardSystem {
    constructor(storage, client, opts = {}) {
        this._storage = storage;
        this._client = client;
        this._ns = opts.namespace ?? 'starboard';
    }

    async configure(guildId, channelId, threshold = 3, emoji = '⭐') {
        await this._storage.set(this._ns, `config:${guildId}`, { channelId, threshold, emoji });
    }

    async getConfig(guildId) {
        return this._storage.get(this._ns, `config:${guildId}`);
    }

    async handleReaction(reaction, user) {
        if (user.bot) return;
        const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
        if (!msg.guild) return;

        const config = await this.getConfig(msg.guild.id);
        if (!config) return;

        const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
        if (emojiKey !== config.emoji) return;
        if (msg.author?.bot) return;

        const reactionObj = msg.reactions.cache.get(reaction.emoji.id ?? reaction.emoji.name);
        const count = reactionObj?.count ?? 1;
        if (count < config.threshold) return;

        const isPosted = await this.isPosted(msg.id);
        if (isPosted) {
            await this._updateCount(msg.id, count);
            return;
        }

        await this.post(msg, count, config);
    }

    async isPosted(messageId) {
        const entry = await this._storage.get(this._ns, `posted:${messageId}`);
        return !!entry;
    }

    async post(message, count, config) {
        const channel = this._client.channels.cache.get(config.channelId);
        if (!channel) return null;

        const content = [
            `${config.emoji} **${count}** | <#${message.channel.id}>`,
            message.content ? `\n${message.content}` : ''
        ].filter(Boolean).join('');

        const files = [...message.attachments.values()].slice(0, 1).map(a => a.url);

        const sent = await channel.send({
            content,
            ...(files.length ? { files } : {})
        }).catch(() => null);

        if (sent) {
            await this._storage.set(this._ns, `posted:${message.id}`, {
                starboardMessageId: sent.id,
                count,
                postedAt: Date.now()
            });
        }

        return sent;
    }

    async _updateCount(originalMessageId, newCount) {
        const entry = await this._storage.get(this._ns, `posted:${originalMessageId}`);
        if (entry) {
            entry.count = newCount;
            await this._storage.set(this._ns, `posted:${originalMessageId}`, entry);
        }
    }
}

module.exports = { StarboardSystem };
