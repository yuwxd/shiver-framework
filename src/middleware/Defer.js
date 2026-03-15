async function deferMiddleware(context, next) {
    const { interaction, command, options } = context;
    if (!interaction || !interaction.isChatInputCommand?.()) return next();

    const strategy = command?.deferStrategy ?? options?.deferStrategy ?? 'always';
    if (interaction.replied || interaction.deferred || context.deferred) {
        context.deferred = true;
        return next();
    }

    if (strategy === 'never') return next();

    if (strategy === 'always') {
        const ephemeral = command?.ephemeral ?? options?.ephemeralByDefault ?? false;
        try {
            await interaction.deferReply({ ephemeral });
            context.deferred = true;
        } catch (_) {}
        return next();
    }

    if (strategy === 'whenSlow') {
        const threshold = options?.deferWhenSlowThresholdMs ?? 200;
        let resolved = false;
        const deferTimeout = setTimeout(async () => {
            if (!resolved && !interaction.replied && !interaction.deferred) {
                const ephemeral = command?.ephemeral ?? options?.ephemeralByDefault ?? false;
                try {
                    await interaction.deferReply({ ephemeral });
                    context.deferred = true;
                } catch (_) {}
            }
        }, threshold);

        try {
            await next();
        } finally {
            resolved = true;
            clearTimeout(deferTimeout);
        }
        return;
    }

    return next();
}

module.exports = { deferMiddleware };
