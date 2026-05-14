class PromptBuilder {
    constructor() {
        this._messages = [];
        this._systemParts = [];
    }

    static create() {
        return new PromptBuilder();
    }

    addRole(role, content) {
        this._messages.push({ role, content });
        return this;
    }

    addSystem(content) {
        this._systemParts.push(content);
        return this;
    }

    addRule(rule) {
        this._systemParts.push(`- ${rule}`);
        return this;
    }

    addGuildContext(guild) {
        if (!guild) return this;
        const lines = [
            `Server name: ${guild.name}`,
            `Member count: ${guild.memberCount ?? 'unknown'}`,
            `Server ID: ${guild.id}`
        ];
        if (guild.description) lines.push(`Description: ${guild.description}`);
        this._systemParts.push(`[Server context]\n${lines.join('\n')}`);
        return this;
    }

    addUserContext(user, member) {
        if (!user) return this;
        const lines = [`Username: ${user.username}`, `User ID: ${user.id}`];
        if (member?.joinedAt) lines.push(`Joined: ${member.joinedAt.toISOString().split('T')[0]}`);
        if (member?.roles?.cache?.size) {
            const roleNames = member.roles.cache
                .filter(r => r.name !== '@everyone')
                .map(r => r.name)
                .join(', ');
            if (roleNames) lines.push(`Roles: ${roleNames}`);
        }
        this._systemParts.push(`[User context]\n${lines.join('\n')}`);
        return this;
    }

    addCommandList(commands) {
        if (!commands?.length) return this;
        const lines = commands.map(cmd => {
            const json = cmd.data && typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : cmd.data;
            const name = json?.name ?? cmd.name ?? '?';
            const desc = json?.description ?? '';
            return `/${name}: ${desc}`;
        });
        this._systemParts.push(`[Available commands]\n${lines.join('\n')}`);
        return this;
    }

    addHistory(conversationContext, channelId, limit = 20) {
        if (!conversationContext) return this;
        const msgs = conversationContext.get(channelId, limit);
        for (const msg of msgs) {
            this._messages.push({ role: msg.role, content: msg.content });
        }
        return this;
    }

    buildSystemPrompt() {
        return this._systemParts.join('\n\n');
    }

    build() {
        const messages = [];
        const system = this.buildSystemPrompt();
        if (system) messages.push({ role: 'system', content: system });
        messages.push(...this._messages);
        return messages;
    }

    toOpenAI() {
        return this.build();
    }

    toAnthropic() {
        const all = this.build();
        const system = all.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const messages = all.filter(m => m.role !== 'system');
        return { system: system || undefined, messages };
    }
}

module.exports = { PromptBuilder };
