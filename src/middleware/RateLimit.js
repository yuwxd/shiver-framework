async function rateLimitMiddleware(context, next) {
    const { interaction, message, command, container, options } = context;
    const userId = interaction?.user?.id ?? message?.author?.id;
    if (!userId) return next();

    const rateLimit = container?.get?.('rateLimit');
    if (!rateLimit?.check) return next();

    const commandKey = context.commandKey || command?.name || 'unknown';
    const premium = container?.get?.('premium');
    let isPremium = false;
    try {
        if (premium?.isPremium) isPremium = await premium.isPremium(userId).catch(() => false);
    } catch (_) {}

    let result = null;
    try {
        result = await rateLimit.check(userId, commandKey, isPremium);
    } catch (_) {}

    if (!result?.blocked) return next();

    if (options?.dryRun) {
        console.log(`[dry run] rate limit block for ${userId} on ${commandKey}`);
        context.blocked = true;
        return;
    }

    const remainingMs = result.remainingMs ?? result.retryAfterMs;
    const remainingSec = remainingMs ? Math.ceil(remainingMs / 1000) : null;
    const msg = remainingSec
        ? `You are being rate limited. Try again in ${remainingSec}s.`
        : 'You are being rate limited. Please slow down.';

    const helpers = container?.get?.('helpers');
    const payload = helpers?.createWarningPayload
        ? helpers.createWarningPayload(userId, { message: msg })
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

module.exports = { rateLimitMiddleware };
