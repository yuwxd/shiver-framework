const name = 'webhook-logger';

async function init(framework, options = {}) {
    const { WebhookClient } = require('discord.js');
    const webhookUrl = options.webhookUrl;
    if (!webhookUrl) return;

    const webhook = new WebhookClient({ url: webhookUrl });
    const logCommands = options.logCommands !== false;
    const logErrors = options.logErrors !== false;
    const logBlocked = options.logBlocked ?? false;

    if (logCommands) {
        framework.events.on('CommandRun', async ({ commandName, interaction, message, traceId }) => {
            const userId = interaction?.user?.id ?? message?.author?.id ?? 'unknown';
            const guildId = interaction?.guildId ?? message?.guildId ?? 'DM';
            await webhook.send({
                content: `\`[RUN]\` **${commandName}** | user: \`${userId}\` | guild: \`${guildId}\` | trace: \`${traceId}\``
            }).catch(() => {});
        });
    }

    if (logErrors) {
        framework.events.on('CommandError', async ({ commandName, error, traceId }) => {
            await webhook.send({
                content: `\`[ERROR]\` **${commandName}** | trace: \`${traceId}\` | ${error?.message?.slice(0, 200) ?? 'unknown'}`
            }).catch(() => {});
        });
    }

    if (logBlocked) {
        framework.events.on('CommandBlocked', async ({ commandName, traceId }) => {
            await webhook.send({
                content: `\`[BLOCKED]\` **${commandName}** | trace: \`${traceId}\``
            }).catch(() => {});
        });
    }
}

module.exports = { name, init };
