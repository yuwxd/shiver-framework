function isComponentInteraction(interaction) {
    return !!(
        interaction?.isButton?.() ||
        interaction?.isAnySelectMenu?.() ||
        interaction?.isStringSelectMenu?.() ||
        interaction?.isUserSelectMenu?.() ||
        interaction?.isRoleSelectMenu?.() ||
        interaction?.isChannelSelectMenu?.() ||
        interaction?.isMentionableSelectMenu?.() ||
        interaction?.isModalSubmit?.()
    );
}

async function safeRespond(interaction, payload, options = {}) {
    if (options?.dryRun) {
        console.log('[dry run] would send:', JSON.stringify(payload)?.slice(0, 200));
        return;
    }
    try {
        const preferUpdate = payload?._preferUpdate === true;
        if (preferUpdate) {
            delete payload._preferUpdate;
        }
        if (preferUpdate && isComponentInteraction(interaction) && !interaction.replied && !interaction.deferred) {
            await interaction.update(payload);
            return;
        }
        if (interaction.replied) {
            await interaction.followUp(payload);
        } else if (interaction.deferred) {
            await interaction.editReply(payload);
        } else {
            await interaction.reply(payload);
        }
    } catch (err) {
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred.', ephemeral: true }).catch(() => {});
            }
        } catch (_) {}
    }
}

module.exports = { safeRespond };
