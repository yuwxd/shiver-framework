async function premiumMiddleware(context, next) {
    const { interaction, message, command, container, options } = context;
    if (!command?.requiresPremium) return next();

    const userId = interaction?.user?.id ?? message?.author?.id;
    const guildId = interaction?.guildId ?? message?.guildId;
    if (!userId) return next();

    const hasAccess = options?.hasAccess;
    const premium = container?.get?.('premium');

    let access = false;
    try {
        if (hasAccess) {
            access = await Promise.race([
                hasAccess(userId, guildId),
                new Promise(r => setTimeout(() => r(false), 5000))
            ]);
        } else if (premium?.isPremium) {
            access = await Promise.race([
                premium.isPremium(userId),
                new Promise(r => setTimeout(() => r(false), 5000))
            ]);
        } else if (premium?.hasAccess) {
            access = await Promise.race([
                premium.hasAccess(userId, guildId),
                new Promise(r => setTimeout(() => r(false), 5000))
            ]);
        } else {
            return next();
        }
    } catch (_) {}

    if (access) return next();

    if (options?.dryRun) {
        console.log(`[dry run] premium block for ${userId}`);
        context.blocked = true;
        return;
    }

    const helpers = container?.get?.('helpers');
    const payload = helpers?.createWarningPayload
        ? helpers.createWarningPayload(userId, { message: 'This command requires premium. Use `/premium` to learn more.' })
        : { content: 'This command requires premium. Use `/premium` to learn more.', ephemeral: true };

    try {
        if (interaction) {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(payload).catch(() => {});
            } else {
                await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
            }
        } else if (message) {
            await message.reply(payload?.content || 'This command requires premium.').catch(() => {});
        }
    } catch (_) {}

    context.blocked = true;
}

module.exports = { premiumMiddleware };
