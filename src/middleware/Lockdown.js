async function lockdownMiddleware(context, next) {
    const { interaction, message, container, options } = context;
    const userId = interaction?.user?.id ?? message?.author?.id;
    if (!userId) return next();

    const ownerIds = options?.ownerIds ?? [];
    const ownerSet = Array.isArray(ownerIds) ? new Set(ownerIds) : ownerIds;
    const clientOwnerIds = context.client?.ownerIds;

    const isOwner = ownerSet.has?.(userId) || clientOwnerIds?.has?.(userId);
    if (isOwner) return next();

    const lockdown = container?.get?.('lockdown');
    if (!lockdown?.isLockdown?.()) return next();

    const remainingMs = lockdown.getRemainingMs?.();
    const remainingText = remainingMs ? ` Time remaining: ${Math.ceil(remainingMs / 1000)}s.` : '';
    const msg = `Bot is currently in lockdown mode.${remainingText}`;

    await safeReply(context, msg);
    context.blocked = true;
}

async function safeReply(context, content) {
    const { interaction, message, options } = context;
    if (options?.dryRun) {
        console.log(`[dry run] lockdown block: ${content}`);
        return;
    }
    try {
        if (interaction) {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content }).catch(() => {});
            } else {
                await interaction.reply({ content, ephemeral: true }).catch(() => {});
            }
        } else if (message) {
            await message.reply(content).catch(() => {});
        }
    } catch (_) {}
}

module.exports = { lockdownMiddleware };
