class StructuredOutput {
    constructor(events) {
        this._events = events;
    }

    wrap(commandName, fn) {
        return async (interaction, client) => {
            const userId = interaction.user?.id ?? interaction.author?.id;
            const guildId = interaction.guild?.id ?? null;
            const startedAt = Date.now();

            try {
                const result = await fn(interaction, client);
                const output = {
                    success: true,
                    commandName,
                    data: result ?? null,
                    userId,
                    guildId,
                    durationMs: Date.now() - startedAt,
                    timestamp: new Date().toISOString()
                };
                if (this._events) this._events.emit('StructuredOutput', output);
                return output;
            } catch (err) {
                const output = {
                    success: false,
                    commandName,
                    error: err?.message ?? 'Unknown error',
                    userId,
                    guildId,
                    durationMs: Date.now() - startedAt,
                    timestamp: new Date().toISOString()
                };
                if (this._events) this._events.emit('StructuredOutput', output);
                throw err;
            }
        };
    }

    static format(commandName, data, opts = {}) {
        return {
            success: opts.success ?? true,
            commandName,
            data: data ?? null,
            userId: opts.userId ?? null,
            guildId: opts.guildId ?? null,
            timestamp: opts.timestamp ?? new Date().toISOString()
        };
    }
}

module.exports = { StructuredOutput };
