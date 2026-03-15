const { PreconditionContainer } = require('../preconditions');

class BaseCommand {
    constructor(opts = {}) {
        this.name = opts.name ?? null;
        this.aliases = opts.aliases ?? [];
        this.description = opts.description ?? '';
        this.category = opts.category ?? 'General';
        this.usage = opts.usage ?? null;
        this.examples = opts.examples ?? [];
        this.guildOnly = opts.guildOnly ?? false;
        this.ownerOnly = opts.ownerOnly ?? false;
        this.nsfw = opts.nsfw ?? false;
        this.enabled = opts.enabled ?? true;
        this.hidden = opts.hidden ?? false;
        this.cooldown = opts.cooldown ?? null;
        this.permissions = opts.permissions ?? [];
        this.botPermissions = opts.botPermissions ?? [];
        this.preconditions = opts.preconditions ?? [];
        this.data = opts.data ?? null;
        this._store = null;
        this._framework = null;
    }

    get store() { return this._store; }
    get framework() { return this._framework; }
    get client() { return this._framework?._client ?? null; }
    get container() { return this._framework?.container ?? null; }

    async executeSlash(interaction, client) {
        throw new Error(`Command "${this.name}" does not implement executeSlash()`);
    }

    async executePrefix(message, args, client, commandName) {
        throw new Error(`Command "${this.name}" does not implement executePrefix()`);
    }

    async handleButton(interaction, client) {}
    async handleSelect(interaction, client) {}
    async handleModal(interaction, client) {}
    async handleModalSubmit(interaction, client) {
        return this.handleModal(interaction, client);
    }
    async handleAutocomplete(interaction, client) {}
    async handleContextMenu(interaction, client) {}

    async runPreconditions(interaction, context = {}) {
        const container = new PreconditionContainer(this.preconditions);
        return container.run(interaction, this, context);
    }

    toJSON() {
        return {
            name: this.name,
            aliases: this.aliases,
            description: this.description,
            category: this.category,
            guildOnly: this.guildOnly,
            ownerOnly: this.ownerOnly,
            nsfw: this.nsfw,
            enabled: this.enabled,
            hidden: this.hidden
        };
    }
}

module.exports = { BaseCommand };
