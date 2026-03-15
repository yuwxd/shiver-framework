async function blacklistMiddleware(context, next) {
    const { interaction, message, container, options } = context;
    const userId = interaction?.user?.id ?? message?.author?.id;
    if (!userId) return next();

    const blacklist = container?.get?.('blacklist');
    const isBlacklistedFn = options?.isBlacklisted;

    let blocked = false;
    try {
        if (isBlacklistedFn) {
            blocked = await Promise.race([
                isBlacklistedFn(userId),
                new Promise(r => setTimeout(() => r(false), 5000))
            ]);
        } else if (blacklist?.isBlacklisted) {
            blocked = await Promise.race([
                blacklist.isBlacklisted(userId),
                new Promise(r => setTimeout(() => r(false), 5000))
            ]);
        }
    } catch (_) {}

    if (!blocked) return next();

    if (options?.dryRun) {
        console.log(`[dry run] blacklist block for ${userId}`);
        context.blocked = true;
        return;
    }

    const helpers = container?.get?.('helpers');
    const payload = helpers?.createWarningPayload
        ? helpers.createWarningPayload(userId, { message: 'You are blacklisted from using this bot.' })
        : { content: 'You are blacklisted from using this bot.', ephemeral: true };

    try {
        if (interaction) {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(payload).catch(() => {});
            } else {
                await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
            }
        } else if (message) {
            await message.reply(typeof payload === 'string' ? payload : (payload.content || 'You are blacklisted.')).catch(() => {});
        }
    } catch (_) {}

    context.blocked = true;
}

module.exports = { blacklistMiddleware };
