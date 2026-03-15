const { MessageType } = require('discord-api-types/v10');
const { MiddlewareChain } = require('../middleware/MiddlewareChain');
const { lockdownMiddleware } = require('../middleware/Lockdown');
const { blacklistMiddleware } = require('../middleware/Blacklist');
const { serverBlacklistMiddleware } = require('../middleware/ServerBlacklist');
const { tosMiddleware } = require('../middleware/TOS');
const { premiumMiddleware } = require('../middleware/Premium');
const { rateLimitMiddleware } = require('../middleware/RateLimit');
const { cooldownMiddleware } = require('../middleware/Cooldown');
const { disabledMiddleware } = require('../middleware/Disabled');
const { permissionsMiddleware } = require('../middleware/Permissions');
const preconditions = require('../preconditions');
const { generateTraceId } = require('../errors/traceId');
const { safeError } = require('../security/redact');

function normalizePrefix(prefix, fallback = ',') {
    if (typeof prefix !== 'string') return fallback;
    if (!prefix || prefix.length > 10 || prefix === '/') return fallback;
    return prefix;
}

async function resolvePrefix(framework, message) {
    const options = framework.options ?? {};
    const fallback = normalizePrefix(options.prefix, ',');

    if (typeof options.getPrefix !== 'function') {
        return fallback;
    }

    try {
        const resolved = await options.getPrefix(message, framework);
        return normalizePrefix(resolved, fallback);
    } catch (err) {
        safeError('PrefixHandler', err);
        return fallback;
    }
}

function parseArgs(content) {
    const args = [];
    const regex = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        args.push(match[1] ?? match[2]);
    }
    return args;
}

class PrefixHandler {
    constructor(registry, framework) {
        this._registry = registry;
        this._framework = framework;
        this._customMiddlewares = [];
    }

    use(fn) {
        this._customMiddlewares.push(fn);
        return this;
    }

    async handle(message) {
        if (message.author?.bot) return;
        if (message.type === MessageType.ChatInputCommand || message.type === MessageType.ContextMenuCommand) return;
        if (message.interaction) return;

        const execKey = `prefix:${message.id}`;
        const executing = this._framework._executingNow;
        if (executing.has(execKey)) {
            console.warn('[ShiverFramework] DUPLICATE prefix execution BLOCKED id=' + message.id);
            return;
        }
        executing.add(execKey);
        try {
            await this._handlePrefix(message);
        } finally {
            executing.delete(execKey);
        }
    }

    async _handlePrefix(message) {
        const options = this._framework.options;
        const container = this._framework.container;
        const client = this._framework.client;

        const processedIds = container?.get?.('prefixProcessedIds') || this._framework._prefixProcessedIds;
        if (processedIds) {
            if (processedIds.has(message.id)) return;
            processedIds.add(message.id);
            const cleanupTimer = setTimeout(() => processedIds.delete(message.id), 60000);
            cleanupTimer.unref?.();
        }

        const runAtMap = this._framework._prefixRunAtByMessageId;
        const now = Date.now();
        const PREFIX_DEDUP_MS = 4000;
        const lastRun = runAtMap.get(message.id);
        if (lastRun != null && now - lastRun < PREFIX_DEDUP_MS) {
            console.warn('[ShiverFramework] DUPLICATE prefix BLOCKED (time window) id=' + message.id);
            return;
        }

        const prefix = await resolvePrefix(this._framework, message);
        const content = message.content;
        if (!content.startsWith(prefix)) {
            if (typeof options?.afterPrefixMessage === 'function') {
                Promise.resolve(options.afterPrefixMessage(message)).catch(() => {});
            }
            await this._framework.events.emit('afterPrefixMessage', message);
            return;
        }

        const withoutPrefix = content.slice(prefix.length).trim();
        if (!withoutPrefix) return;

        const args = parseArgs(withoutPrefix);
        const commandName = args.shift()?.toLowerCase();
        if (!commandName) return;

        const command = this._registry.getPrefix(commandName);
        if (!command) {
            if (typeof options?.afterPrefixMessage === 'function') {
                Promise.resolve(options.afterPrefixMessage(message)).catch(() => {});
            }
            await this._framework.events.emit('afterPrefixMessage', message);
            return;
        }

        const traceId = generateTraceId();

        const prefixPath = command.getDisabledPath
            ? command.getDisabledPath(args, commandName)
            : command.name;

        const commandKey = prefixPath || command.name;

        const context = {
            message,
            command,
            container,
            options,
            client,
            traceId,
            commandKey,
            prefixPath,
            args,
            commandName,
            blocked: false
        };

        const chain = new MiddlewareChain();
        chain.use(lockdownMiddleware);
        chain.use(serverBlacklistMiddleware);
        chain.use(blacklistMiddleware);
        chain.use(tosMiddleware);
        chain.use(premiumMiddleware);
        chain.use(rateLimitMiddleware);
        chain.use(cooldownMiddleware);
        chain.use(disabledMiddleware);
        chain.use(permissionsMiddleware);

        for (const mw of this._customMiddlewares) chain.use(mw);

        chain.use(async (ctx, next) => {
            if (command.preconditions?.length > 0) {
                const result = await preconditions.run(ctx, command.preconditions);
                if (!result.ok) {
                    await message.reply(result.message || 'Precondition failed.').catch(() => {});
                    ctx.blocked = true;
                    return;
                }
            }
            return next();
        });

        chain.use(async (ctx) => {
            if (ctx.blocked) return;
            if (typeof command.executePrefix !== 'function') {
                await this._framework.events.emit('CommandBlocked', { message, commandName: command.name, traceId, reason: 'missing_execute_prefix' });
                return;
            }
            const tryAcquire = options?.tryAcquirePrefixMessage;
            if (typeof tryAcquire === 'function') {
                let acquired = false;
                try {
                    acquired = await tryAcquire(message.id);
                } catch (_) {}
                if (!acquired) {
                    return;
                }
            }
            const runAtMap = this._framework._prefixRunAtByMessageId;
            runAtMap.set(message.id, Date.now());
            if (runAtMap.size > 2000) {
                const cutoff = Date.now() - 10000;
                for (const [id, ts] of runAtMap.entries()) {
                    if (ts < cutoff) runAtMap.delete(id);
                }
            }
            try {
                await command.executePrefix(message, args, client, commandName);
                await this._framework.events.emit('CommandRun', { message, commandName: command.name, traceId });
                if (typeof options?.onCommandRun === 'function') {
                    Promise.resolve(options.onCommandRun(message, command.name)).catch(() => {});
                }
            } catch (err) {
                if (!options?.suppressSlashHandlerConsoleErrors) {
                    safeError('PrefixHandler', err);
                }
                await this._framework.events.emit('CommandError', { message, commandName: command.name, error: err, traceId });
                if (typeof options?.onCommandError === 'function') {
                    Promise.resolve(options.onCommandError(message, command.name, err)).catch(() => {});
                }
                await message.reply('This command is currently unavailable. Please try again later.').catch(() => {});
            }
        });

        try {
            await chain.run(context);
            if (context.blocked) {
                await this._framework.events.emit('CommandBlocked', { message, commandName: command.name, traceId });
                if (typeof options?.onCommandBlocked === 'function') {
                    Promise.resolve(options.onCommandBlocked(message, command.name)).catch(() => {});
                }
            }
        } catch (err) {
            if (!options?.suppressSlashHandlerConsoleErrors) {
                safeError('PrefixHandler', err);
            }
            await message.reply('This command is currently unavailable. Please try again later.').catch(() => {});
        }

        if (typeof options?.afterPrefixMessage === 'function') {
            Promise.resolve(options.afterPrefixMessage(message)).catch(() => {});
        }
        await this._framework.events.emit('afterPrefixMessage', message);
    }
}

module.exports = { PrefixHandler };
