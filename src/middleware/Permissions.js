async function permissionsMiddleware(context, next) {
    const { interaction, message, command, container, options } = context;
    const userId = interaction?.user?.id ?? message?.author?.id;
    if (!userId) return next();

    const ownerIds = options?.ownerIds ?? [];
    const ownerSet = Array.isArray(ownerIds) ? new Set(ownerIds) : ownerIds;
    const clientOwnerIds = context.client?.ownerIds;

    const isOwner = ownerSet.has?.(userId) || clientOwnerIds?.has?.(userId);

    if (command?.adminOnly && !isOwner) {
        if (options?.dryRun) {
            console.log(`[dry run] adminOnly block for ${userId}`);
            context.blocked = true;
            return;
        }
        const helpers = container?.get?.('helpers');
        const payload = helpers?.createWarningPayload
            ? helpers.createWarningPayload(userId, { message: 'Access denied.' })
            : { content: 'Access denied.', ephemeral: true };
        try {
            if (interaction) {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(payload).catch(() => {});
                } else {
                    await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
                }
            } else if (message) {
                await message.reply(payload?.content || 'Access denied.').catch(() => {});
            }
        } catch (_) {}
        context.blocked = true;
        return;
    }

    const isUserAllowed = options?.isUserAllowed;
    if (isUserAllowed) {
        let allowed = true;
        try {
            allowed = await isUserAllowed(userId);
        } catch (_) {}
        if (!allowed) {
            if (options?.dryRun) {
                console.log(`[dry run] isUserAllowed block for ${userId}`);
                context.blocked = true;
                return;
            }
            const msg = options?.messageTestingPhase || 'Bot is currently in testing phase.';
            try {
                if (interaction) {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: msg }).catch(() => {});
                    } else {
                        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
                    }
                } else if (message) {
                    await message.reply(msg).catch(() => {});
                }
            } catch (_) {}
            context.blocked = true;
            return;
        }
    }

    return next();
}

module.exports = { permissionsMiddleware };
