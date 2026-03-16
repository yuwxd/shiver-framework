const { safeRespond } = require('./safeRespond');
const { safeError } = require('../security/redact');
const { generateTraceId } = require('../errors/traceId');

class ContextMenuHandler {
    constructor(registry, framework) {
        this._registry = registry;
        this._framework = framework;
    }

    async handle(interaction) {
        if (!interaction.isContextMenuCommand()) return;

        const traceId = generateTraceId();
        const command = this._registry.getSlash(interaction.commandName);
        if (!command?.executeContextMenu) return;

        const options = this._framework.options;
        const container = this._framework.container;
        const client = this._framework.client;

        try {
            await command.executeContextMenu(interaction, client);
            await this._framework.events.emit('CommandRun', { interaction, commandName: interaction.commandName, traceId });
        } catch (err) {
            safeError('ContextMenuHandler', err);
            await this._framework.events.emit('CommandError', { interaction, commandName: interaction.commandName, error: err, traceId });
            if (interaction.replied || interaction.deferred) return;
            const helpers = container?.get?.('helpers');
            const payload = helpers?.createGenericErrorPayload
                ? helpers.createGenericErrorPayload(interaction.user?.id)
                : { content: 'This command is currently unavailable. Please try again later.', ephemeral: true };
            await safeRespond(interaction, payload, options);
        }
    }
}

module.exports = { ContextMenuHandler };
