class Inspector {
    constructor(framework) {
        this._framework = framework;
    }

    getReport() {
        const fw = this._framework;
        const client = fw.client;
        const mem = process.memoryUsage();
        const uptime = process.uptime();

        return {
            timestamp: new Date().toISOString(),
            uptime: uptime,
            process: {
                pid: process.pid,
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
                memory: {
                    heapUsed: mem.heapUsed,
                    heapTotal: mem.heapTotal,
                    rss: mem.rss,
                    external: mem.external,
                    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
                    rssMb: Math.round(mem.rss / 1024 / 1024 * 100) / 100
                }
            },
            discord: client ? {
                ready: client.isReady?.() ?? false,
                ping: client.ws?.ping ?? -1,
                guilds: client.guilds?.cache?.size ?? 0,
                users: client.users?.cache?.size ?? 0,
                channels: client.channels?.cache?.size ?? 0,
                shards: client.ws?.shards?.size ?? 1,
                userId: client.user?.id ?? null,
                username: client.user?.username ?? null
            } : null,
            commands: this._getCommandsInfo(),
            plugins: this._getPluginsInfo(),
            middleware: this._getMiddlewareInfo(),
            cache: this._getCacheInfo(),
            storage: this._getStorageInfo(),
            voice: this._getVoiceInfo(),
            stats: fw.stats ? fw.stats.getSummary() : null,
            health: fw.health ? this._getHealthInfo() : null,
            container: this._getContainerInfo(),
            options: this._getSafeOptions()
        };
    }

    _getCommandsInfo() {
        const fw = this._framework;
        if (!fw.commands) return null;
        const commands = [...(fw.commands._commands?.values() ?? [])];
        return {
            total: commands.length,
            list: commands.map(cmd => ({
                name: cmd.name ?? cmd.data?.name,
                aliases: cmd.aliases ?? [],
                hasSlash: typeof cmd.executeSlash === 'function',
                hasPrefix: typeof cmd.executePrefix === 'function',
                hasButton: typeof cmd.handleButton === 'function',
                hasSelect: typeof cmd.handleSelect === 'function',
                hasModal: typeof cmd.handleModal === 'function',
                hasAutocomplete: typeof cmd.handleAutocomplete === 'function',
                cooldown: cmd.cooldown ?? null,
                preconditions: cmd.preconditions?.length ?? 0
            }))
        };
    }

    _getPluginsInfo() {
        const fw = this._framework;
        if (!fw.plugins) return null;
        const plugins = fw.plugins._plugins ?? new Map();
        return {
            total: plugins.size,
            list: [...plugins.keys()]
        };
    }

    _getMiddlewareInfo() {
        const fw = this._framework;
        if (!fw._middlewareChain) return null;
        const chain = fw._middlewareChain;
        return {
            count: chain._middleware?.length ?? 0,
            names: chain._middleware?.map(m => m.name ?? 'anonymous') ?? []
        };
    }

    _getCacheInfo() {
        const fw = this._framework;
        const caches = {};

        if (fw.cache) {
            caches.primary = fw.cache.constructor?.name ?? 'unknown';
            if (fw.cache.getStats) caches.stats = fw.cache.getStats();
        }

        if (fw._memoryCache) {
            caches.memory = { size: fw._memoryCache.size ?? 0 };
        }

        return Object.keys(caches).length > 0 ? caches : null;
    }

    _getStorageInfo() {
        const fw = this._framework;
        if (!fw._storage) return null;
        return {
            type: fw._storage.constructor?.name ?? 'unknown',
            namespace: fw._storage._namespace ?? null
        };
    }

    _getVoiceInfo() {
        const fw = this._framework;
        if (!fw.voice) return null;
        try {
            return fw.voice.getStats?.() ?? null;
        } catch (_) {
            return null;
        }
    }

    _getHealthInfo() {
        const fw = this._framework;
        try {
            return {
                status: fw.health._status ?? 'unknown',
                shuttingDown: fw.health._shuttingDown ?? false,
                checks: fw.health._checks ? [...fw.health._checks.keys()] : []
            };
        } catch (_) {
            return null;
        }
    }

    _getContainerInfo() {
        const fw = this._framework;
        if (!fw.container) return null;
        const container = fw.container;
        const keys = typeof container.keys === 'function'
            ? [...container.keys()]
            : (container._map ? [...container._map.keys()] : []);
        return { entries: keys.length, keys };
    }

    _getSafeOptions() {
        const opts = this._framework.options ?? {};
        const safe = {};
        const skip = ['token', 'password', 'secret', 'key', 'apiKey', 'webhookUrl'];
        for (const [k, v] of Object.entries(opts)) {
            if (skip.some(s => k.toLowerCase().includes(s.toLowerCase()))) {
                safe[k] = '[REDACTED]';
            } else if (typeof v !== 'function' && typeof v !== 'object') {
                safe[k] = v;
            } else if (typeof v === 'object' && v !== null) {
                safe[k] = '[Object]';
            }
        }
        return safe;
    }

    formatReport(report) {
        const lines = [];
        const sep = '─'.repeat(50);

        lines.push(`\n${sep}`);
        lines.push(`  Shiver Framework Inspector`);
        lines.push(`  ${report.timestamp}`);
        lines.push(sep);

        lines.push(`\nProcess`);
        lines.push(`  PID:     ${report.process.pid}`);
        lines.push(`  Node:    ${report.process.nodeVersion}`);
        lines.push(`  Uptime:  ${Math.floor(report.uptime)}s`);
        lines.push(`  Heap:    ${report.process.memory.heapUsedMb} MB / ${Math.round(report.process.memory.heapTotal / 1024 / 1024)} MB`);
        lines.push(`  RSS:     ${report.process.memory.rssMb} MB`);

        if (report.discord) {
            lines.push(`\nDiscord`);
            lines.push(`  Ready:   ${report.discord.ready}`);
            lines.push(`  Ping:    ${report.discord.ping}ms`);
            lines.push(`  Guilds:  ${report.discord.guilds}`);
            lines.push(`  Users:   ${report.discord.users}`);
            lines.push(`  Shards:  ${report.discord.shards}`);
        }

        if (report.commands) {
            lines.push(`\nCommands (${report.commands.total})`);
            for (const cmd of report.commands.list.slice(0, 20)) {
                const flags = [
                    cmd.hasSlash ? 'slash' : null,
                    cmd.hasPrefix ? 'prefix' : null,
                    cmd.hasButton ? 'button' : null,
                    cmd.hasAutocomplete ? 'autocomplete' : null
                ].filter(Boolean).join(', ');
                lines.push(`  /${cmd.name.padEnd(20)} [${flags}]`);
            }
            if (report.commands.total > 20) lines.push(`  ... and ${report.commands.total - 20} more`);
        }

        if (report.plugins) {
            lines.push(`\nPlugins (${report.plugins.total})`);
            for (const name of report.plugins.list) lines.push(`  • ${name}`);
        }

        if (report.stats) {
            lines.push(`\nStats`);
            lines.push(`  Commands run:    ${report.stats.commandsRun}`);
            lines.push(`  Commands/min:    ${report.stats.commandsPerMinute}`);
            lines.push(`  Messages:        ${report.stats.messagesProcessed}`);
            lines.push(`  Latency p95:     ${report.stats.commandLatency?.p95 ?? 0}ms`);
        }

        lines.push(`\n${sep}\n`);
        return lines.join('\n');
    }

    toJSON() {
        return JSON.stringify(this.getReport(), null, 2);
    }
}

module.exports = { Inspector };
