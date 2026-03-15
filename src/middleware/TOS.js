async function tosMiddleware(context, next) {
    const { interaction, message, options } = context;
    const userId = interaction?.user?.id ?? message?.author?.id;
    if (!userId) return next();

    const checkTOS = options?.checkTOS;
    if (!checkTOS) return next();

    let accepted = true;
    try {
        accepted = await Promise.race([
            checkTOS(userId),
            new Promise(r => setTimeout(() => r(true), 5000))
        ]);
    } catch (_) {}

    if (accepted) return next();

    if (options?.dryRun) {
        console.log(`[dry run] TOS block for ${userId}`);
        context.blocked = true;
        return;
    }

    const buildTosReply = options?.buildTosReply;
    const payload = buildTosReply
        ? await buildTosReply(userId).catch(() => null)
        : { content: 'You must accept the Terms of Service before using this bot.', ephemeral: true };

    try {
        if (interaction) {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(payload || { content: 'Please accept the Terms of Service.' }).catch(() => {});
            } else {
                await interaction.reply({ ...(payload || {}), ephemeral: true }).catch(() => {});
            }
        } else if (message) {
            await message.reply((payload?.content) || 'Please accept the Terms of Service.').catch(() => {});
        }
    } catch (_) {}

    context.blocked = true;
}

module.exports = { tosMiddleware };
