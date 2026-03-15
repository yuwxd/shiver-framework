async function serverBlacklistMiddleware(context, next) {
    const { interaction, message, container, options } = context;
    const guildId = interaction?.guildId ?? message?.guildId;
    if (!guildId) return next();

    const serverList = container?.get?.('serverList');
    const checkServerBlacklisted = options?.checkServerBlacklisted;

    let blocked = false;
    try {
        if (checkServerBlacklisted) {
            blocked = await Promise.race([
                checkServerBlacklisted(guildId),
                new Promise(r => setTimeout(() => r(false), 3000))
            ]);
        } else if (serverList?.isBlacklisted) {
            blocked = await Promise.race([
                serverList.isBlacklisted(guildId),
                new Promise(r => setTimeout(() => r(false), 3000))
            ]);
        }
    } catch (_) {}

    if (!blocked) return next();

    if (options?.dryRun) {
        console.log(`[dry run] server blacklist block for guild ${guildId}`);
        context.blocked = true;
        return;
    }

    const msg = 'This server is blacklisted from using this bot.';
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
}

module.exports = { serverBlacklistMiddleware };
