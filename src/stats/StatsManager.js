class Histogram {
    constructor(opts = {}) {
        this._buckets = opts.buckets ?? [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
        this._counts = new Array(this._buckets.length + 1).fill(0);
        this._sum = 0;
        this._count = 0;
        this._min = Infinity;
        this._max = -Infinity;
        this._samples = [];
        this._maxSamples = opts.maxSamples ?? 1000;
    }

    observe(value) {
        this._count++;
        this._sum += value;
        if (value < this._min) this._min = value;
        if (value > this._max) this._max = value;

        for (let i = 0; i < this._buckets.length; i++) {
            if (value <= this._buckets[i]) {
                this._counts[i]++;
                break;
            }
        }
        this._counts[this._buckets.length]++;

        this._samples.push(value);
        if (this._samples.length > this._maxSamples) this._samples.shift();
    }

    get mean() { return this._count === 0 ? 0 : this._sum / this._count; }
    get count() { return this._count; }
    get sum() { return this._sum; }
    get min() { return this._min === Infinity ? 0 : this._min; }
    get max() { return this._max === -Infinity ? 0 : this._max; }

    percentile(p) {
        if (this._samples.length === 0) return 0;
        const sorted = [...this._samples].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    get p50() { return this.percentile(50); }
    get p90() { return this.percentile(90); }
    get p95() { return this.percentile(95); }
    get p99() { return this.percentile(99); }

    reset() {
        this._counts = new Array(this._buckets.length + 1).fill(0);
        this._sum = 0;
        this._count = 0;
        this._min = Infinity;
        this._max = -Infinity;
        this._samples = [];
    }

    toJSON() {
        return {
            count: this._count, sum: this._sum, mean: this.mean,
            min: this.min, max: this.max,
            p50: this.p50, p90: this.p90, p95: this.p95, p99: this.p99
        };
    }
}

class Counter {
    constructor() { this._value = 0; }
    increment(amount = 1) { this._value += amount; return this; }
    decrement(amount = 1) { this._value -= amount; return this; }
    reset() { this._value = 0; return this; }
    get value() { return this._value; }
    toJSON() { return this._value; }
}

class Gauge {
    constructor(initial = 0) { this._value = initial; }
    set(value) { this._value = value; return this; }
    increment(amount = 1) { this._value += amount; return this; }
    decrement(amount = 1) { this._value -= amount; return this; }
    get value() { return this._value; }
    toJSON() { return this._value; }
}

class RateTracker {
    constructor(windowMs = 60000) {
        this._window = windowMs;
        this._events = [];
    }

    record(count = 1) {
        const now = Date.now();
        for (let i = 0; i < count; i++) this._events.push(now);
        this._cleanup();
    }

    _cleanup() {
        const cutoff = Date.now() - this._window;
        this._events = this._events.filter(t => t > cutoff);
    }

    get rate() {
        this._cleanup();
        return this._events.length / (this._window / 1000);
    }

    get count() {
        this._cleanup();
        return this._events.length;
    }
}

class StatsManager {
    constructor(opts = {}) {
        this._client = null;
        this._startTime = Date.now();
        this._commandsRun = new Counter();
        this._commandsBlocked = new Counter();
        this._commandErrors = new Counter();
        this._messagesProcessed = new Counter();
        this._interactionsProcessed = new Counter();
        this._slashCommandsRun = new Counter();
        this._prefixCommandsRun = new Counter();
        this._commandLatency = new Histogram();
        this._wsLatency = new Histogram();
        this._apiLatency = new Histogram();
        this._databaseLatency = new Histogram();
        this._gatewayLatency = new Histogram();
        this._editLatency = new Histogram();
        this._commandRate = new RateTracker(60000);
        this._messageRate = new RateTracker(60000);
        this._perCommandStats = new Map();
        this._perGuildStats = new Map();
        this._perShardStats = new Map();
        this._perChannelStats = new Map();
        this._perUserStats = new Map();
        this._customMetrics = new Map();
        this._snapshotInterval = opts.snapshotInterval ?? null;
        this._snapshots = [];
        this._maxSnapshots = opts.maxSnapshots ?? 60;
        this._dailyStats = new Map();
        this._weeklyStats = new Map();
        this._monthlyStats = new Map();
        this._errors = [];
        this._maxErrors = opts.maxErrors ?? 500;
        this._traces = new Map();
        this._maxTraces = opts.maxTraces ?? 1000;
        this._heatmap = new Map();
        this._opts = opts;

        if (this._snapshotInterval) {
            this._snapshotTimer = setInterval(() => this._takeSnapshot(), this._snapshotInterval);
            if (this._snapshotTimer.unref) this._snapshotTimer.unref();
        }
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    recordCommand(commandName, opts = {}) {
        this._commandsRun.increment();
        this._commandRate.record();
        if (opts.slash) this._slashCommandsRun.increment();
        if (opts.prefix) this._prefixCommandsRun.increment();
        if (opts.latency !== undefined) this._commandLatency.observe(opts.latency);
        if (opts.gatewayLatency !== undefined) this._gatewayLatency.observe(opts.gatewayLatency);
        if (opts.databaseLatency !== undefined) this._databaseLatency.observe(opts.databaseLatency);
        if (opts.apiLatency !== undefined) this._apiLatency.observe(opts.apiLatency);
        if (opts.editLatency !== undefined) this._editLatency.observe(opts.editLatency);

        const cmdStats = this._perCommandStats.get(commandName) ?? {
            runs: new Counter(), errors: new Counter(), blocked: new Counter(),
            latency: new Histogram(),
            apiLatency: new Histogram(),
            databaseLatency: new Histogram(),
            gatewayLatency: new Histogram(),
            editLatency: new Histogram(),
            lastUsed: 0
        };
        cmdStats.runs.increment();
        cmdStats.lastUsed = Date.now();
        if (opts.latency !== undefined) cmdStats.latency.observe(opts.latency);
        if (opts.apiLatency !== undefined) cmdStats.apiLatency.observe(opts.apiLatency);
        if (opts.databaseLatency !== undefined) cmdStats.databaseLatency.observe(opts.databaseLatency);
        if (opts.gatewayLatency !== undefined) cmdStats.gatewayLatency.observe(opts.gatewayLatency);
        if (opts.editLatency !== undefined) cmdStats.editLatency.observe(opts.editLatency);
        this._perCommandStats.set(commandName, cmdStats);

        if (opts.guildId) {
            const guildStats = this._perGuildStats.get(opts.guildId) ?? { commands: new Counter(), users: new Set() };
            guildStats.commands.increment();
            if (opts.userId) guildStats.users.add(opts.userId);
            this._perGuildStats.set(opts.guildId, guildStats);
        }

        if (opts.channelId) {
            const channelStats = this._perChannelStats.get(opts.channelId) ?? { commands: new Counter() };
            channelStats.commands.increment();
            this._perChannelStats.set(opts.channelId, channelStats);
        }

        if (opts.userId) {
            const userStats = this._perUserStats.get(opts.userId) ?? { commands: new Counter(), commandBreakdown: new Map() };
            userStats.commands.increment();
            const cmdCount = (userStats.commandBreakdown.get(commandName) ?? 0) + 1;
            userStats.commandBreakdown.set(commandName, cmdCount);
            this._perUserStats.set(opts.userId, userStats);
        }

        if (opts.shardId !== undefined) {
            const shardStats = this._perShardStats.get(opts.shardId) ?? { commands: new Counter(), ping: new Gauge(), guilds: new Gauge(), status: 'unknown', lastUpdate: 0 };
            shardStats.commands.increment();
            if (opts.shardPing !== undefined) shardStats.ping.set(opts.shardPing);
            if (opts.shardGuilds !== undefined) shardStats.guilds.set(opts.shardGuilds);
            if (opts.shardStatus) shardStats.status = opts.shardStatus;
            shardStats.lastUpdate = Date.now();
            this._perShardStats.set(opts.shardId, shardStats);
        }

        this._recordHeatmap(commandName, opts);
        this._recordAggregated(commandName, opts);
    }

    _recordHeatmap(commandName, opts = {}) {
        const key = String(new Date().getUTCHours()).padStart(2, '0');
        const bucket = this._heatmap.get(key) ?? { total: 0, commands: new Map(), guilds: new Set(), users: new Set() };
        bucket.total++;
        bucket.commands.set(commandName, (bucket.commands.get(commandName) ?? 0) + 1);
        if (opts.guildId) bucket.guilds.add(opts.guildId);
        if (opts.userId) bucket.users.add(opts.userId);
        this._heatmap.set(key, bucket);
    }

    _recordAggregated(commandName, opts) {
        const now = new Date();
        const dayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
        const weekKey = `${now.getUTCFullYear()}-W${String(Math.ceil(now.getUTCDate() / 7)).padStart(2, '0')}`;
        const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

        for (const [map, key] of [[this._dailyStats, dayKey], [this._weeklyStats, weekKey], [this._monthlyStats, monthKey]]) {
            const bucket = map.get(key) ?? { total: 0, commands: new Map() };
            bucket.total++;
            bucket.commands.set(commandName, (bucket.commands.get(commandName) ?? 0) + 1);
            map.set(key, bucket);
        }
    }

    recordCommandBlocked(commandName, reason) {
        this._commandsBlocked.increment();
        const cmdStats = this._perCommandStats.get(commandName);
        if (cmdStats) cmdStats.blocked.increment();
    }

    recordCommandError(commandName, error, context = {}) {
        this._commandErrors.increment();
        const cmdStats = this._perCommandStats.get(commandName);
        if (cmdStats) cmdStats.errors.increment();
        this.recordError(commandName, error, context);
    }

    recordMessage() {
        this._messagesProcessed.increment();
        this._messageRate.record();
    }

    recordInteraction() {
        this._interactionsProcessed.increment();
    }

    recordWsPing(ping) {
        this._wsLatency.observe(ping);
    }

    recordApiLatency(ms) {
        this._apiLatency.observe(ms);
    }

    recordDatabaseLatency(ms) {
        this._databaseLatency.observe(ms);
    }

    recordGatewayLatency(ms) {
        this._gatewayLatency.observe(ms);
    }

    recordEditLatency(ms) {
        this._editLatency.observe(ms);
    }

    recordLatency(type, ms) {
        if (type === 'api') this.recordApiLatency(ms);
        if (type === 'database') this.recordDatabaseLatency(ms);
        if (type === 'gateway') this.recordGatewayLatency(ms);
        if (type === 'edit') this.recordEditLatency(ms);
    }

    recordError(commandName, error, context = {}) {
        const entry = {
            id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            commandName,
            message: error?.message ?? String(error ?? 'Unknown error'),
            stack: error?.stack ?? null,
            name: error?.name ?? 'Error',
            traceId: context.traceId ?? null,
            guildId: context.guildId ?? context.interaction?.guildId ?? context.message?.guildId ?? null,
            channelId: context.channelId ?? context.interaction?.channelId ?? context.message?.channelId ?? null,
            userId: context.userId ?? context.interaction?.user?.id ?? context.message?.author?.id ?? null,
            type: context.type ?? error?.name ?? 'Error'
        };

        this._errors.push(entry);
        if (this._errors.length > this._maxErrors) this._errors.shift();
        return entry;
    }

    getErrors(filter = {}) {
        return this._errors.filter((entry) => {
            if (filter.commandName && entry.commandName !== filter.commandName) return false;
            if (filter.traceId && entry.traceId !== filter.traceId) return false;
            if (filter.userId && entry.userId !== filter.userId) return false;
            if (filter.guildId && entry.guildId !== filter.guildId) return false;
            if (filter.type && entry.type !== filter.type) return false;
            if (filter.since && entry.timestamp < filter.since) return false;
            if (filter.until && entry.timestamp > filter.until) return false;
            return true;
        });
    }

    recordTraceStep(traceId, step, data = {}) {
        if (!traceId) return null;
        const trace = this._traces.get(traceId) ?? { traceId, startedAt: Date.now(), steps: [] };
        trace.steps.push({ step, at: Date.now(), data });
        trace.lastUpdatedAt = Date.now();
        this._traces.set(traceId, trace);

        if (this._traces.size > this._maxTraces) {
            const oldestKey = this._traces.keys().next().value;
            if (oldestKey) this._traces.delete(oldestKey);
        }

        return trace;
    }

    getTrace(traceId) {
        return traceId ? this._traces.get(traceId) ?? null : null;
    }

    getObservabilityReport() {
        return {
            summary: this.getSummary(),
            traces: [...this._traces.values()].slice(-50),
            errors: this.getErrors(),
            heatmap: this.getHeatmap(),
            topCommands: this.getTopCommands(20),
            topUsers: this.getTopUsers(20),
            topChannels: this.getTopChannels(20),
            shards: this.getAllShardStats(),
            snapshots: this.getSnapshots()
        };
    }

    setCustomMetric(name, value) {
        this._customMetrics.set(name, value);
        return this;
    }

    incrementCustomMetric(name, amount = 1) {
        const current = this._customMetrics.get(name) ?? 0;
        this._customMetrics.set(name, current + amount);
        return this;
    }

    getCommandStats(commandName) {
        const stats = this._perCommandStats.get(commandName);
        if (!stats) return null;
        return {
            runs: stats.runs.value,
            errors: stats.errors.value,
            blocked: stats.blocked.value,
            latency: stats.latency.toJSON(),
            apiLatency: stats.apiLatency.toJSON(),
            databaseLatency: stats.databaseLatency.toJSON(),
            gatewayLatency: stats.gatewayLatency.toJSON(),
            editLatency: stats.editLatency.toJSON()
        };
    }

    getTopCommands(limit = 10) {
        return [...this._perCommandStats.entries()]
            .map(([name, stats]) => ({
                name,
                runs: stats.runs.value,
                latency: stats.latency.toJSON(),
                apiLatency: stats.apiLatency.toJSON(),
                databaseLatency: stats.databaseLatency.toJSON(),
                gatewayLatency: stats.gatewayLatency.toJSON(),
                editLatency: stats.editLatency.toJSON(),
                lastUsed: stats.lastUsed
            }))
            .sort((a, b) => b.runs - a.runs)
            .slice(0, limit);
    }

    getChannelStats(channelId) {
        const stats = this._perChannelStats.get(channelId);
        if (!stats) return null;
        return { commands: stats.commands.value };
    }

    getTopChannels(limit = 10) {
        return [...this._perChannelStats.entries()]
            .map(([channelId, stats]) => ({ channelId, commands: stats.commands.value }))
            .sort((a, b) => b.commands - a.commands)
            .slice(0, limit);
    }

    getUserStats(userId) {
        const stats = this._perUserStats.get(userId);
        if (!stats) return null;
        return {
            commands: stats.commands.value,
            commandBreakdown: Object.fromEntries(stats.commandBreakdown)
        };
    }

    getTopUsers(limit = 10) {
        return [...this._perUserStats.entries()]
            .map(([userId, stats]) => ({ userId, commands: stats.commands.value }))
            .sort((a, b) => b.commands - a.commands)
            .slice(0, limit);
    }

    getDailyStats(days = 7) {
        const result = [];
        const now = new Date();
        for (let i = 0; i < days; i++) {
            const d = new Date(now);
            d.setUTCDate(d.getUTCDate() - i);
            const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            const bucket = this._dailyStats.get(key);
            result.push({ date: key, total: bucket?.total ?? 0, commands: bucket ? Object.fromEntries(bucket.commands) : {} });
        }
        return result.reverse();
    }

    getWeeklyStats(weeks = 4) {
        return [...this._weeklyStats.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-weeks)
            .map(([week, bucket]) => ({ week, total: bucket.total, commands: Object.fromEntries(bucket.commands) }));
    }

    getMonthlyStats(months = 12) {
        return [...this._monthlyStats.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-months)
            .map(([month, bucket]) => ({ month, total: bucket.total, commands: Object.fromEntries(bucket.commands) }));
    }

    toCSV() {
        const lines = ['command,runs,errors,blocked,latency_p50,latency_p95,latency_p99,last_used'];
        for (const [name, stats] of this._perCommandStats) {
            lines.push([
                name,
                stats.runs.value,
                stats.errors.value,
                stats.blocked.value,
                stats.latency.p50,
                stats.latency.p95,
                stats.latency.p99,
                stats.lastUsed ? new Date(stats.lastUsed).toISOString() : ''
            ].join(','));
        }
        return lines.join('\n');
    }

    toJSON() {
        return {
            summary: this.getSummary(),
            commands: Object.fromEntries(
                [...this._perCommandStats.entries()].map(([name, stats]) => [name, {
                    runs: stats.runs.value,
                    errors: stats.errors.value,
                    blocked: stats.blocked.value,
                    latency: stats.latency.toJSON(),
                    apiLatency: stats.apiLatency.toJSON(),
                    databaseLatency: stats.databaseLatency.toJSON(),
                    gatewayLatency: stats.gatewayLatency.toJSON(),
                    editLatency: stats.editLatency.toJSON(),
                    lastUsed: stats.lastUsed
                }])
            ),
            topChannels: this.getTopChannels(20),
            topUsers: this.getTopUsers(20),
            daily: this.getDailyStats(30),
            errors: this.getErrors(),
            heatmap: this.getHeatmap(),
            traces: [...this._traces.values()].slice(-50)
        };
    }

    toAsciiChart(limit = 10) {
        const top = this.getTopCommands(limit);
        if (top.length === 0) return 'No command data.';
        const maxRuns = Math.max(...top.map(c => c.runs));
        const barWidth = 30;
        const lines = top.map(({ name, runs }) => {
            const filled = maxRuns > 0 ? Math.round((runs / maxRuns) * barWidth) : 0;
            const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
            return `${name.padEnd(20)} ${bar} ${runs}`;
        });
        return lines.join('\n');
    }

    renderHeatmapAscii() {
        const heatmap = this.getHeatmap();
        if (heatmap.length === 0) return 'No heatmap data.';
        const maxTotal = Math.max(...heatmap.map(entry => entry.total), 1);
        return heatmap.map((entry) => {
            const width = Math.round((entry.total / maxTotal) * 20);
            return `${entry.hour.padStart(2, '0')}:00 ${'█'.repeat(width).padEnd(20, '░')} ${entry.total}`;
        }).join('\n');
    }

    getShardStats(shardId) {
        const stats = this._perShardStats.get(shardId);
        if (!stats) return null;
        return { commands: stats.commands.value, ping: stats.ping.value };
    }

    getAllShardStats() {
        return Object.fromEntries(
            [...this._perShardStats.entries()].map(([id, stats]) => [
                id, {
                    commands: stats.commands.value,
                    ping: stats.ping.value,
                    guilds: stats.guilds?.value ?? 0,
                    status: stats.status ?? 'unknown',
                    lastUpdate: stats.lastUpdate ?? 0
                }
            ])
        );
    }

    updateShardPing(shardId, ping, extra = {}) {
        const stats = this._perShardStats.get(shardId) ?? { commands: new Counter(), ping: new Gauge(), guilds: new Gauge(), status: 'unknown', lastUpdate: 0 };
        stats.ping.set(ping);
        if (extra.guilds !== undefined) stats.guilds.set(extra.guilds);
        if (extra.status) stats.status = extra.status;
        stats.lastUpdate = Date.now();
        this._perShardStats.set(shardId, stats);
        this.recordWsPing(ping);
    }

    setShardStatus(shardId, status, guilds = null) {
        const stats = this._perShardStats.get(shardId) ?? { commands: new Counter(), ping: new Gauge(), guilds: new Gauge(), status: 'unknown', lastUpdate: 0 };
        stats.status = status;
        if (guilds !== null) stats.guilds.set(guilds);
        stats.lastUpdate = Date.now();
        this._perShardStats.set(shardId, stats);
    }

    getHeatmap() {
        return [...this._heatmap.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([hour, bucket]) => ({
                hour,
                total: bucket.total,
                uniqueGuilds: bucket.guilds.size,
                uniqueUsers: bucket.users.size,
                commands: Object.fromEntries(bucket.commands)
            }));
    }

    getTraceChains(limit = 50) {
        return [...this._traces.values()].slice(-limit).map(trace => ({
            traceId: trace.traceId,
            startedAt: trace.startedAt,
            lastUpdatedAt: trace.lastUpdatedAt ?? trace.startedAt,
            chain: trace.steps.map(step => step.step).join(' -> '),
            steps: trace.steps
        }));
    }

    _takeSnapshot() {
        const snapshot = { timestamp: Date.now(), ...this.getSummary() };
        this._snapshots.push(snapshot);
        if (this._snapshots.length > this._maxSnapshots) this._snapshots.shift();
    }

    getSnapshots() {
        return [...this._snapshots];
    }

    getSummary() {
        const client = this._client;
        const uptime = Date.now() - this._startTime;
        const mem = process.memoryUsage();

        return {
            uptime,
            guilds: client?.guilds?.cache?.size ?? 0,
            users: client?.users?.cache?.size ?? 0,
            channels: client?.channels?.cache?.size ?? 0,
            ping: client?.ws?.ping ?? -1,
            shards: client?.ws?.shards?.size ?? 1,
            commandsRun: this._commandsRun.value,
            commandsBlocked: this._commandsBlocked.value,
            commandErrors: this._commandErrors.value,
            messagesProcessed: this._messagesProcessed.value,
            interactionsProcessed: this._interactionsProcessed.value,
            slashCommandsRun: this._slashCommandsRun.value,
            prefixCommandsRun: this._prefixCommandsRun.value,
            commandsPerMinute: Math.round(this._commandRate.rate),
            messagesPerMinute: Math.round(this._messageRate.rate),
            commandLatency: this._commandLatency.toJSON(),
            wsLatency: this._wsLatency.toJSON(),
            apiLatency: this._apiLatency.toJSON(),
            databaseLatency: this._databaseLatency.toJSON(),
            gatewayLatency: this._gatewayLatency.toJSON(),
            editLatency: this._editLatency.toJSON(),
            memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss, external: mem.external },
            customMetrics: Object.fromEntries(this._customMetrics),
            errorsTracked: this._errors.length,
            tracesTracked: this._traces.size
        };
    }

    getPayload() {
        return {
            summary: this.getSummary(),
            topCommands: this.getTopCommands(20),
            topChannels: this.getTopChannels(20),
            topUsers: this.getTopUsers(20),
            daily: this.getDailyStats(30),
            weekly: this.getWeeklyStats(12),
            monthly: this.getMonthlyStats(12),
            errors: this.getErrors(),
            heatmap: this.getHeatmap(),
            traces: [...this._traces.values()].slice(-50),
            shards: this.getAllShardStats(),
            snapshots: this.getSnapshots()
        };
    }

    toPrometheus() {
        const summary = this.getSummary();
        const lines = [
            `shiver_guilds_total ${summary.guilds}`,
            `shiver_users_total ${summary.users}`,
            `shiver_commands_total ${summary.commandsRun}`,
            `shiver_commands_blocked_total ${summary.commandsBlocked}`,
            `shiver_command_errors_total ${summary.commandErrors}`,
            `shiver_messages_total ${summary.messagesProcessed}`,
            `shiver_interactions_total ${summary.interactionsProcessed}`,
            `shiver_commands_per_minute ${summary.commandsPerMinute}`,
            `shiver_ws_ping_ms ${summary.ping}`,
            `shiver_uptime_seconds ${Math.floor(summary.uptime / 1000)}`,
            `shiver_memory_heap_used_bytes ${summary.memory.heapUsed}`,
            `shiver_memory_rss_bytes ${summary.memory.rss}`,
            `shiver_command_latency_p50_ms ${summary.commandLatency.p50}`,
            `shiver_command_latency_p95_ms ${summary.commandLatency.p95}`,
            `shiver_command_latency_p99_ms ${summary.commandLatency.p99}`,
            `shiver_api_latency_p95_ms ${summary.apiLatency.p95}`,
            `shiver_database_latency_p95_ms ${summary.databaseLatency.p95}`,
            `shiver_gateway_latency_p95_ms ${summary.gatewayLatency.p95}`,
            `shiver_edit_latency_p95_ms ${summary.editLatency.p95}`,
            `shiver_errors_tracked_total ${summary.errorsTracked}`,
            `shiver_traces_tracked_total ${summary.tracesTracked}`
        ];

        for (const [name, value] of this._customMetrics) {
            if (typeof value === 'number') {
                lines.push(`shiver_custom_${name} ${value}`);
            }
        }

        return lines.join('\n') + '\n';
    }

    reset() {
        this._commandsRun.reset();
        this._commandsBlocked.reset();
        this._commandErrors.reset();
        this._messagesProcessed.reset();
        this._interactionsProcessed.reset();
        this._slashCommandsRun.reset();
        this._prefixCommandsRun.reset();
        this._commandLatency.reset();
        this._wsLatency.reset();
        this._apiLatency.reset();
        this._databaseLatency.reset();
        this._gatewayLatency.reset();
        this._editLatency.reset();
        this._perCommandStats.clear();
        this._perGuildStats.clear();
        this._perShardStats.clear();
        this._perChannelStats.clear();
        this._perUserStats.clear();
        this._customMetrics.clear();
        this._dailyStats.clear();
        this._weeklyStats.clear();
        this._monthlyStats.clear();
        this._errors = [];
        this._traces.clear();
        this._heatmap.clear();
    }

    destroy() {
        if (this._snapshotTimer) clearInterval(this._snapshotTimer);
    }
}

module.exports = { StatsManager, Histogram, Counter, Gauge, RateTracker };
