const { EventEmitter } = require('events');

class WelcomeSystem extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._storage = opts.storage ?? null;
        this._client = null;
        this._defaults = {
            enabled: false,
            channelId: null,
            message: 'Welcome {user} to {server}!',
            embedColor: 0x5865F2,
            useEmbed: false,
            thumbnail: true,
            dmMessage: null,
            dmEnabled: false,
            autoRoles: [],
            leaveEnabled: false,
            leaveChannelId: null,
            leaveMessage: 'Goodbye {username}!'
        };
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    setStorage(storage) {
        this._storage = storage;
        return this;
    }

    async getConfig(guildId) {
        if (!this._storage) return { ...this._defaults };
        const stored = await this._storage.get('welcome_config', guildId);
        return { ...this._defaults, ...stored };
    }

    async setConfig(guildId, config) {
        if (!this._storage) return;
        const existing = await this.getConfig(guildId);
        await this._storage.set('welcome_config', guildId, { ...existing, ...config });
    }

    _replacePlaceholders(template, member) {
        const guild = member.guild;
        return template
            .replace(/{user}/g, `<@${member.id}>`)
            .replace(/{username}/g, member.user.username)
            .replace(/{displayname}/g, member.displayName)
            .replace(/{server}/g, guild.name)
            .replace(/{membercount}/g, guild.memberCount.toString())
            .replace(/{id}/g, member.id)
            .replace(/{tag}/g, member.user.tag ?? member.user.username)
            .replace(/{created}/g, `<t:${Math.floor(member.user.createdAt.getTime() / 1000)}:R>`)
            .replace(/{joined}/g, `<t:${Math.floor((member.joinedAt ?? new Date()).getTime() / 1000)}:R>`);
    }

    async onMemberJoin(member) {
        const config = await this.getConfig(member.guild.id);
        if (!config.enabled) return;

        if (config.autoRoles.length > 0) {
            for (const roleId of config.autoRoles) {
                try {
                    await member.roles.add(roleId, 'Welcome system: auto-role');
                } catch (_) {}
            }
        }

        if (config.channelId && config.message) {
            const channel = member.guild.channels.cache.get(config.channelId);
            if (channel?.isTextBased()) {
                const text = this._replacePlaceholders(config.message, member);
                if (config.useEmbed) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setColor(config.embedColor)
                        .setDescription(text)
                        .setTimestamp();
                    if (config.thumbnail) embed.setThumbnail(member.user.displayAvatarURL({ size: 256 }));
                    await channel.send({ embeds: [embed] }).catch(() => {});
                } else {
                    await channel.send({ content: text }).catch(() => {});
                }
            }
        }

        if (config.dmEnabled && config.dmMessage) {
            const dmText = this._replacePlaceholders(config.dmMessage, member);
            await member.send({ content: dmText }).catch(() => {});
        }

        this.emit('welcome', member, config);
    }

    async onMemberLeave(member) {
        const config = await this.getConfig(member.guild.id);
        if (!config.enabled || !config.leaveEnabled) return;

        if (config.leaveChannelId && config.leaveMessage) {
            const channel = member.guild.channels.cache.get(config.leaveChannelId);
            if (channel?.isTextBased()) {
                const text = this._replacePlaceholders(config.leaveMessage, member);
                await channel.send({ content: text }).catch(() => {});
            }
        }

        this.emit('leave', member, config);
    }
}

module.exports = { WelcomeSystem };
