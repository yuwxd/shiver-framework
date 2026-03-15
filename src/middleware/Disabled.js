async function disabledMiddleware(context, next) {
    const { interaction, message, command, container, options } = context;

    const disabledCommands = container?.get?.('disabledCommands');
    if (!disabledCommands) return next();

    let isDisabled = false;
    let disabledPath = null;

    if (interaction?.isChatInputCommand?.()) {
        const commandName = interaction.commandName;
        const subGroup = interaction.options?.getSubcommandGroup?.(false);
        const sub = interaction.options?.getSubcommand?.(false);
        disabledPath = disabledCommands.buildPath?.(commandName, subGroup, sub) || commandName;
        isDisabled = disabledCommands.isDisabled?.(commandName, subGroup, sub) || false;
    } else if (message) {
        const prefixPath = context.prefixPath || command?.name;
        if (prefixPath) {
            isDisabled = disabledCommands.isDisabled?.(prefixPath) || false;
            disabledPath = prefixPath;
        }
    }

    if (!isDisabled) return next();

    if (options?.dryRun) {
        console.log(`[dry run] disabled block for ${disabledPath}`);
        context.blocked = true;
        return;
    }

    const msg = disabledPath
        ? `Command \`${disabledPath}\` is currently disabled.`
        : 'This command is currently disabled.';

    const helpers = container?.get?.('helpers');
    const payload = helpers?.createWarningPayload
        ? helpers.createWarningPayload(null, { message: msg })
        : { content: msg, ephemeral: true };

    try {
        if (interaction) {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(payload).catch(() => {});
            } else {
                await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
            }
        } else if (message) {
            await message.reply(payload?.content || msg).catch(() => {});
        }
    } catch (_) {}

    context.blocked = true;
}

module.exports = { disabledMiddleware };
