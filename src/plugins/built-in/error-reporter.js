const name = 'error-reporter';

async function init(framework, options = {}) {
    const webhookUrl = options.webhookUrl;
    const maxPerMinute = options.maxPerMinute ?? 10;
    let sentThisMinute = 0;
    let minuteStart = Date.now();

    const canSend = () => {
        const now = Date.now();
        if (now - minuteStart > 60000) {
            minuteStart = now;
            sentThisMinute = 0;
        }
        return sentThisMinute < maxPerMinute;
    };

    const report = async (err, context = {}) => {
        if (!canSend()) return;
        sentThisMinute++;

        const { redactSecrets } = require('../security/redact');
        const message = redactSecrets(err?.message ?? String(err));
        const traceId = context.traceId ?? 'unknown';
        const commandName = context.commandName ?? 'unknown';

        if (webhookUrl) {
            try {
                const { WebhookClient } = require('discord.js');
                const webhook = new WebhookClient({ url: webhookUrl });
                await webhook.send({
                    content: `\`[ERROR]\` **${commandName}** | trace: \`${traceId}\`\n\`\`\`${message.slice(0, 500)}\`\`\``
                });
            } catch (_) {}
        }

        if (options.onError) {
            try {
                await options.onError(err, context);
            } catch (_) {}
        }
    };

    framework.events.on('CommandError', ({ error, commandName, traceId }) => {
        report(error, { commandName, traceId }).catch(() => {});
    });

    framework.container.set('errorReporter', { report });
    framework.errorReporter = { report };
}

module.exports = { name, init };
