const { safeRespond } = require('./safeRespond');
const { safeError } = require('../security/redact');
const { generateTraceId } = require('../errors/traceId');

function getInteractionType(interaction) {
    if (interaction.isButton?.()) return 'button';
    if (interaction.isModalSubmit?.()) return 'modal';
    if (
        interaction.isAnySelectMenu?.() ||
        interaction.isStringSelectMenu?.() ||
        interaction.isUserSelectMenu?.() ||
        interaction.isRoleSelectMenu?.() ||
        interaction.isChannelSelectMenu?.() ||
        interaction.isMentionableSelectMenu?.()
    ) {
        return 'select';
    }
    return null;
}

function getHandlerNamesForType(options, interactionType) {
    const handlerNames = options?.componentHandlerNames ?? [
        'handleButton', 'handleSelect', 'handleSelectMenu', 'handleModalSubmit', 'handleModal', 'handleMusicSelect'
    ];
    const typeHandlerMap = {
        button: ['handleButton'],
        select: ['handleSelect', 'handleSelectMenu', 'handleMusicSelect'],
        modal: ['handleModalSubmit', 'handleModal']
    };
    const preferredHandlers = typeHandlerMap[interactionType] || [];
    return [...new Set([...preferredHandlers, ...handlerNames])];
}

function matchesExplicitComponentTarget(command, interaction, customId) {
    if (!command || !customId) return false;
    if (command.customIdPrefix && customId.startsWith(command.customIdPrefix)) return true;
    if (Array.isArray(command.customIdPrefixes) && command.customIdPrefixes.some((prefix) => customId.startsWith(prefix))) return true;
    if (command.customIdPattern && command.customIdPattern.test?.(customId)) return true;
    if (Array.isArray(command.customIdPatterns) && command.customIdPatterns.some((pattern) => pattern?.test?.(customId))) return true;
    if (typeof command.canHandleComponent === 'function') {
        try {
            return command.canHandleComponent(interaction, customId) === true;
        } catch (_) {
            return false;
        }
    }
    return customId.startsWith(command.name + '_') || customId.startsWith(command.name + ':');
}

async function runWithComponentAutoAck(interaction, options, task) {
    const threshold = options?.componentDeferWhenSlowThresholdMs ?? 1000;
    let timeout = null;
    if (typeof threshold === 'number' && threshold > 0) {
        timeout = setTimeout(async () => {
            if (interaction.deferred || interaction.replied) return;
            try {
                if (interaction.isModalSubmit?.()) {
                    await interaction.deferReply({ ephemeral: options?.ephemeralByDefault ?? false });
                } else {
                    await interaction.deferUpdate();
                }
            } catch (_) {}
        }, threshold);
    }

    try {
        return await task();
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

class InteractionHandler {
    constructor(registry, framework) {
        this._registry = registry;
        this._framework = framework;
    }

    async handle(interaction) {
        const interactionType = getInteractionType(interaction);
        if (!interactionType) return;

        const traceId = generateTraceId();
        const options = this._framework.options;
        const container = this._framework.container;
        const client = this._framework.client;

        const customId = interaction.customId;
        if (!customId) return;

        const allHandlers = getHandlerNamesForType(options, interactionType);
        const commands = this._registry.getAllSlash();
        const explicitMatches = commands.filter((command) => matchesExplicitComponentTarget(command, interaction, customId));

        if (explicitMatches.length > 0 && (interactionType === 'button' || interactionType === 'select') && !interaction.deferred && !interaction.replied) {
            try {
                await interaction.deferUpdate();
            } catch (_) {}
        }

        for (const command of explicitMatches) {
            for (const handlerName of allHandlers) {
                if (typeof command[handlerName] !== 'function') continue;
                try {
                    const hadAcknowledgement = interaction.deferred || interaction.replied;
                    const result = await runWithComponentAutoAck(interaction, options, () => command[handlerName](interaction, client));
                    const hasAcknowledgement = interaction.deferred || interaction.replied;
                    if (result === true || (typeof result === 'undefined' && !hadAcknowledgement && hasAcknowledgement)) {
                        await this._framework.events.emit('CommandRun', { interaction, commandName: `${command.name}.${handlerName}`, traceId });
                        return;
                    }
                } catch (err) {
                    safeError('InteractionHandler', err);
                    await this._framework.events.emit('CommandError', { interaction, commandName: `${command.name}.${handlerName}`, error: err, traceId });
                    if (interaction.replied || interaction.deferred) return;
                    const helpers = container?.get?.('helpers');
                    const payload = helpers?.createGenericErrorPayload
                        ? helpers.createGenericErrorPayload(interaction.user?.id)
                        : { content: 'This command is currently unavailable. Please try again later.', ephemeral: true };
                    await safeRespond(interaction, payload, options);
                    return;
                }
            }
        }
    }
}

module.exports = { InteractionHandler };
