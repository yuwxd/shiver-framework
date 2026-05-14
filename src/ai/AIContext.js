class AIContext {
    constructor(data) {
        this._data = data;
    }

    static async fromInteraction(interaction, framework, opts = {}) {
        const user = interaction.user ?? interaction.author;
        const guild = interaction.guild;
        const member = interaction.member;
        const channel = interaction.channel;

        const data = {
            user: user ? {
                id: user.id,
                username: user.username,
                displayName: member?.displayName ?? user.globalName ?? user.username,
                createdAt: user.createdAt?.toISOString()
            } : null,
            guild: guild ? {
                id: guild.id,
                name: guild.name,
                memberCount: guild.memberCount,
                description: guild.description ?? null,
                premiumTier: guild.premiumTier
            } : null,
            channel: channel ? {
                id: channel.id,
                name: channel.name ?? null,
                type: channel.type
            } : null,
            member: member ? {
                joinedAt: member.joinedAt?.toISOString() ?? null,
                roles: member.roles?.cache
                    ? [...member.roles.cache.filter(r => r.name !== '@everyone').values()].map(r => ({ id: r.id, name: r.name }))
                    : []
            } : null,
            commands: null,
            settings: null,
            timestamp: new Date().toISOString()
        };

        if (framework?.commands && opts.includeCommands !== false) {
            data.commands = framework.commands.getAllSlash()
                .filter(cmd => cmd.data)
                .map(cmd => {
                    const json = typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : cmd.data;
                    return { name: json.name, description: json.description ?? '' };
                });
        }

        if (framework?.settings && guild && opts.includeSettings !== false) {
            try {
                data.settings = await framework.settings.getGuild(guild.id);
            } catch (_) {}
        }

        return new AIContext(data);
    }

    get(key) {
        return this._data[key];
    }

    toJSON() {
        return { ...this._data };
    }

    toPromptString() {
        const parts = [];
        const d = this._data;

        if (d.guild) {
            parts.push(`Server: ${d.guild.name} (${d.guild.memberCount} members)`);
        }
        if (d.user) {
            parts.push(`User: ${d.user.displayName} (${d.user.username})`);
        }
        if (d.member?.roles?.length) {
            parts.push(`Roles: ${d.member.roles.map(r => r.name).join(', ')}`);
        }
        if (d.channel) {
            parts.push(`Channel: ${d.channel.name ?? d.channel.id}`);
        }
        if (d.commands?.length) {
            parts.push(`Available commands: ${d.commands.map(c => `/${c.name}`).join(', ')}`);
        }

        return parts.join('\n');
    }
}

module.exports = { AIContext };
