const { EventEmitter } = require('events');
const fs = require('fs/promises');

const DEBUG_TYPES = {
    COMMAND: 'COMMAND',
    SYSTEM: 'SYSTEM',
    EVENT: 'EVENT',
    API: 'API',
    MIDDLEWARE: 'MIDDLEWARE',
    CACHE: 'CACHE',
    DB: 'DB',
    SHARD: 'SHARD',
    ERROR: 'ERROR',
    WARNING: 'WARNING'
};

const ANSI = {
    reset: '\u001b[0m',
    gray: '\u001b[90m',
    cyan: '\u001b[36m',
    green: '\u001b[32m',
    yellow: '\u001b[33m',
    magenta: '\u001b[35m',
    blue: '\u001b[34m',
    red: '\u001b[31m'
};

const COLOR_MAP = {
    [DEBUG_TYPES.COMMAND]: ANSI.green,
    [DEBUG_TYPES.SYSTEM]: ANSI.cyan,
    [DEBUG_TYPES.EVENT]: ANSI.cyan,
    [DEBUG_TYPES.API]: ANSI.magenta,
    [DEBUG_TYPES.MIDDLEWARE]: ANSI.blue,
    [DEBUG_TYPES.CACHE]: ANSI.yellow,
    [DEBUG_TYPES.DB]: ANSI.gray,
    [DEBUG_TYPES.SHARD]: ANSI.cyan,
    [DEBUG_TYPES.ERROR]: ANSI.red,
    [DEBUG_TYPES.WARNING]: ANSI.yellow
};

const SANITIZE_KEYS = new Set(['userId', 'userid', 'actorId', 'guildId', 'channelId', 'messageId', 'interactionId']);

function formatMeta(meta = {}, sanitize = false) {
    const parts = [];
    for (const [key, value] of Object.entries(meta)) {
        if (value === undefined || value === null || value === '') continue;
        if (sanitize && SANITIZE_KEYS.has(String(key).toLowerCase())) continue;
        parts.push(`${key}:${String(value).replace(/\s+/g, ' ').trim()}`);
    }
    return parts.join(' ');
}

class LiveDebugPanel extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._enabled = opts.enabled ?? false;
        this._allowedTypes = new Set(opts.types ?? Object.values(DEBUG_TYPES));
        this._writeToFile = opts.file ?? false;
        this._filePath = opts.filePath ?? 'shiver-debug.log';
        this._webhook = opts.webhook ?? null;
        this._remoteWriter = null;
        this._remoteScope = null;
        this._framework = null;
        this._bindings = [];
        this._history = [];
        this._maxHistory = opts.maxHistory ?? 1000;
    }

    setRemoteOutput(writer, scope = null) {
        this._remoteWriter = writer;
        this._remoteScope = scope;
        return this;
    }

    clearRemoteOutput() {
        this._remoteWriter = null;
        this._remoteScope = null;
        return this;
    }

    logSystem(name, message, meta = {}) {
        return this.log(DEBUG_TYPES.SYSTEM, `${name} | ${message}`, meta);
    }

    enable() {
        this._enabled = true;
        return this;
    }

    disable() {
        this._enabled = false;
        return this;
    }

    filter(types = []) {
        this._allowedTypes = new Set(types.map(type => String(type).toUpperCase()));
        return this;
    }

    attach(framework) {
        this.detach();
        this._framework = framework;

        const eventBindings = [
            ['CommandRun', payload => this.logCommand(payload)],
            ['CommandError', payload => this.logError(payload)],
            ['CommandBlocked', payload => this.log(DEBUG_TYPES.COMMAND, 'blocked', {
                commandName: payload?.commandName,
                traceId: payload?.traceId
            })],
            ['afterReady', client => this.log(DEBUG_TYPES.EVENT, 'afterReady', {
                userId: client?.user?.id,
                username: client?.user?.username
            })],
            ['afterPrefixMessage', message => this.log(DEBUG_TYPES.EVENT, 'afterPrefixMessage', {
                messageId: message?.id,
                userId: message?.author?.id,
                guildId: message?.guildId
            })]
        ];

        for (const [eventName, handler] of eventBindings) {
            framework.events.on(eventName, handler);
            this._bindings.push(() => framework.events.off(eventName, handler));
        }

        if (framework.client?.on) this.attachClient(framework.client);
        return this;
    }

    attachClient(client) {
        if (!client?.on || !client?.off) return this;

        const handlers = [
            ['messageCreate', message => this.logEvent('messageCreate', {
                messageId: message?.id,
                guildId: message?.guildId,
                channelId: message?.channelId,
                userId: message?.author?.id
            })],
            ['interactionCreate', interaction => this.logEvent('interactionCreate', {
                interactionId: interaction?.id,
                guildId: interaction?.guildId,
                channelId: interaction?.channelId,
                userId: interaction?.user?.id,
                commandName: interaction?.commandName
            })],
            ['shardReady', id => this.log(DEBUG_TYPES.SHARD, 'ready', { shardId: id })],
            ['shardDisconnect', (_, id) => this.log(DEBUG_TYPES.SHARD, 'disconnect', { shardId: id })],
            ['shardError', (error, id) => this.log(DEBUG_TYPES.ERROR, 'shardError', {
                shardId: id,
                error: error?.message
            })]
        ];

        for (const [eventName, handler] of handlers) {
            client.on(eventName, handler);
            this._bindings.push(() => client.off(eventName, handler));
        }

        return this;
    }

    detach() {
        for (const unbind of this._bindings) {
            try {
                unbind();
            } catch (_) {}
        }
        this._bindings = [];
        this._framework = null;
        return this;
    }

    logCommand(payload = {}) {
        this.log(DEBUG_TYPES.COMMAND, payload.commandName ?? 'unknown', {
            traceId: payload.traceId,
            userId: payload.interaction?.user?.id ?? payload.message?.author?.id,
            guildId: payload.interaction?.guildId ?? payload.message?.guildId
        });
    }

    logEvent(eventName, meta = {}) {
        this.log(DEBUG_TYPES.EVENT, eventName, meta);
    }

    logApi(method, route, meta = {}) {
        this.log(DEBUG_TYPES.API, `${method} ${route}`, meta);
    }

    logError(payload = {}) {
        this.log(DEBUG_TYPES.ERROR, payload.commandName ?? 'unknown', {
            traceId: payload.traceId,
            error: payload.error?.message,
            guildId: payload.interaction?.guildId ?? payload.message?.guildId,
            userId: payload.interaction?.user?.id ?? payload.message?.author?.id
        });
    }

    log(type, message, meta = {}) {
        const normalizedType = String(type).toUpperCase();
        if (!this._enabled) return null;
        if (!this._allowedTypes.has(normalizedType)) return null;

        const record = {
            timestamp: new Date().toISOString(),
            type: normalizedType,
            message: String(message),
            meta: { ...meta }
        };

        this._history.push(record);
        if (this._history.length > this._maxHistory) this._history.shift();

        const sanitizeForRemote = !!this._remoteWriter;
        const metaText = formatMeta(meta, sanitizeForRemote);
        const line = `[${normalizedType}] ${record.message}${metaText ? ` ${metaText}` : ''}`;
        const color = COLOR_MAP[normalizedType] ?? '';
        const coloredLine = `${color}${line}${ANSI.reset}`;

        if (this._remoteWriter) {
            try {
                this._remoteWriter(coloredLine + '\n');
            } catch (_) {}
        } else {
            console.log(coloredLine);
        }

        if (this._writeToFile) {
            fs.appendFile(this._filePath, `${record.timestamp} ${line}\n`).catch(() => {});
        }

        if (this._webhook?.send) {
            this._webhook.send({ content: `\`${normalizedType}\` ${record.message}${metaText ? ` ${metaText}` : ''}` }).catch(() => {});
        }

        this.emit('log', record);
        return record;
    }

    getHistory(limit = 100) {
        return this._history.slice(-limit);
    }

    clearHistory() {
        this._history = [];
        return this;
    }
}

module.exports = {
    LiveDebugPanel,
    DEBUG_TYPES
};
