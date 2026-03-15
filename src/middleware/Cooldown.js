const _cooldowns = new Map();

async function cooldownMiddleware(context, next) {
    const { interaction, message, command, options } = context;
    if (!command?.cooldown) return next();

    const userId = interaction?.user?.id ?? message?.author?.id;
    const guildId = interaction?.guildId ?? message?.guildId;
    if (!userId) return next();

    const { type = 'user', seconds = 3 } = command.cooldown;
    const key = type === 'global'
        ? `global:${command.name}`
        : type === 'guild'
            ? `guild:${guildId}:${command.name}`
            : `user:${userId}:${command.name}`;

    const now = Date.now();
    const cooldownEnd = _cooldowns.get(key);

    if (cooldownEnd && now < cooldownEnd) {
        const remaining = Math.ceil((cooldownEnd - now) / 1000);
        const msg = `Please wait ${remaining}s before using this command again.`;

        if (options?.dryRun) {
            console.log(`[dry run] cooldown block: ${msg}`);
            context.blocked = true;
            return;
        }

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

    _cooldowns.set(key, now + seconds * 1000);
    setTimeout(() => _cooldowns.delete(key), seconds * 1000 + 100);

    return next();
}

module.exports = { cooldownMiddleware };
