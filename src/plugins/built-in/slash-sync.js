const name = 'slash-sync';

async function init(framework, options = {}) {
    const autoSync = options.autoSync !== false;
    const guildIds = options.guildIds ?? framework.options.slashSync?.guildIds ?? null;

    if (!autoSync) return;

    framework.events.on('afterReady', async (client) => {
        try {
            const result = await framework.commands.syncToDiscord(client, { guildIds });
            console.log(`[slash-sync] Synced ${result.synced} commands`);
        } catch (err) {
            console.error('[slash-sync] Sync failed:', err?.message);
        }
    });
}

module.exports = { name, init };
