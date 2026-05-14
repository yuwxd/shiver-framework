class CommandDisabledManager {
    constructor(storage, opts = {}) {
        this._storage = storage;
        this._ns = opts.namespace ?? 'disabled_commands';
    }

    async isDisabled(commandName, guildId) {
        if (!this._storage) return false;
        const key = guildId ? `guild:${guildId}:${commandName}` : `global:${commandName}`;
        const val = await this._storage.get(this._ns, key);
        return val === true;
    }

    async disable(commandName, guildId) {
        const key = guildId ? `guild:${guildId}:${commandName}` : `global:${commandName}`;
        await this._storage.set(this._ns, key, true);
    }

    async enable(commandName, guildId) {
        const key = guildId ? `guild:${guildId}:${commandName}` : `global:${commandName}`;
        await this._storage.delete(this._ns, key);
    }

    async getDisabledCommands(guildId) {
        const prefix = guildId ? `guild:${guildId}:` : `global:`;
        const keys = await this._storage.keys(this._ns);
        return keys
            .filter(k => k.startsWith(prefix))
            .map(k => k.slice(prefix.length));
    }

    async disableAll(guildId, commandNames = []) {
        for (const name of commandNames) await this.disable(name, guildId);
    }

    async enableAll(guildId) {
        const disabled = await this.getDisabledCommands(guildId);
        for (const name of disabled) await this.enable(name, guildId);
    }
}

module.exports = { CommandDisabledManager };
