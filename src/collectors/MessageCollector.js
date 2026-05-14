class MessageCollector {
    static async prompt(channel, userId, question, opts = {}) {
        const { timeoutMs = 60000, validator } = opts;

        const sent = await channel.send(question);

        return new Promise((resolve, reject) => {
            const filter = msg => msg.author.id === userId;
            const collector = channel.createMessageCollector({ filter, max: 1, time: timeoutMs });

            collector.on('collect', async msg => {
                if (typeof validator === 'function') {
                    const result = await validator(msg.content, msg).catch(() => false);
                    if (result === false || typeof result === 'string') {
                        const reason = typeof result === 'string' ? result : 'Invalid input.';
                        await channel.send(reason).catch(() => {});
                        collector.resetTimer();
                        return;
                    }
                }
                collector.stop('collected');
                resolve({ content: msg.content, message: msg });
            });

            collector.on('end', (collected, reason) => {
                sent.delete().catch(() => {});
                if (reason !== 'collected') reject(new Error('Timed out'));
            });
        });
    }

    static async sequence(channel, userId, questions, opts = {}) {
        const results = {};
        for (const { key, question, validator, timeoutMs } of questions) {
            const result = await MessageCollector.prompt(channel, userId, question, {
                timeoutMs: timeoutMs ?? opts.timeoutMs ?? 60000,
                validator
            });
            results[key] = result.content;
        }
        return results;
    }
}

module.exports = { MessageCollector };
