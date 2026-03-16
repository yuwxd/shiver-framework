const { MiddlewareChain } = require('../middleware/MiddlewareChain');
const { deferMiddleware } = require('../middleware/Defer');
const { lockdownMiddleware } = require('../middleware/Lockdown');
const { blacklistMiddleware } = require('../middleware/Blacklist');
const { serverBlacklistMiddleware } = require('../middleware/ServerBlacklist');
const { tosMiddleware } = require('../middleware/TOS');
const { premiumMiddleware } = require('../middleware/Premium');
const { rateLimitMiddleware } = require('../middleware/RateLimit');
const { cooldownMiddleware } = require('../middleware/Cooldown');
const { disabledMiddleware } = require('../middleware/Disabled');
const { permissionsMiddleware } = require('../middleware/Permissions');
const { safeRespond } = require('./safeRespond');
const { safeError } = require('../security/redact');
const preconditions = require('../preconditions');
const { generateTraceId } = require('../errors/traceId');

function buildCommandKey(interaction) {
    const name = interaction.commandName;
    const sub = interaction.options?.getSubcommand?.(false);
    const subGroup = interaction.options?.getSubcommandGroup?.(false);
    if (subGroup && sub) return `${name}:${subGroup}:${sub}`;
    if (sub) return `${name}:${sub}`;
    return name;
}

function normalizeOptions(interaction, options) {
    if (!options?.normalizeOptionStrings) return;
    const maxLen = options?.maxOptionStringLength ?? 6000;
    try {
        const rawOptions = interaction.options?.data;
        if (!rawOptions) return;
        for (const opt of rawOptions) {
            if (opt.type === 3 && typeof opt.value === 'string') {
                let val = opt.value.trim();
                val = val.replace(/ {2,}/g, ' ');
                if (val.length > maxLen) val = val.slice(0, maxLen);
                opt.value = val;
            }
        }
    } catch (_) {}
}

class SlashHandler {
    constructor(registry, framework) {
        this._registry = registry;
        this._framework = framework;
        this._customMiddlewares = [];
    }

    use(fn) {
        this._customMiddlewares.push(fn);
        return this;
    }

    async handle(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const execKey = `slash:${interaction.id}`;
        const executing = this._framework._executingNow;
        if (executing.has(execKey)) {
            console.warn('[ShiverFramework] DUPLICATE slash execution BLOCKED id=' + interaction.id + ' cmd=' + interaction.commandName);
            return;
        }
        executing.add(execKey);
        let didRun = false;
        try {
            didRun = await this._handleSlash(interaction);
        } finally {
            executing.delete(execKey);
        }
        if (!didRun) return;
    }

    async _handleSlash(interaction) {
        const traceId = generateTraceId();
        const command = this._registry.getSlash(interaction.commandName);
        if (!command) return false;

        const options = this._framework.options;
        const container = this._framework.container;
        const client = this._framework.client;

        normalizeOptions(interaction, options);

        const commandKey = buildCommandKey(interaction);
        const context = {
            interaction,
            command,
            container,
            options,
            client,
            traceId,
            commandKey,
            deferred: interaction.deferred || interaction.replied,
            blocked: false
        };

        const chain = new MiddlewareChain();
        chain.use(deferMiddleware);
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
                    const msg = result.message || 'Precondition failed.';
                    await safeRespond(interaction, { content: msg, ephemeral: true }, options);
                    ctx.blocked = true;
                    return;
                }
            }
            return next();
        });

        chain.use(async (ctx) => {
            if (ctx.blocked) return;
            try {
                await command.executeSlash(interaction, client);
                await this._framework.events.emit('CommandRun', { interaction, commandName: interaction.commandName, traceId });
                if (typeof options?.onCommandRun === 'function') {
                    try {
                        await Promise.resolve(options.onCommandRun(interaction, interaction.commandName)).catch(() => {});
                    } catch (_) {}
                }
            } catch (err) {
                if (!options?.suppressSlashHandlerConsoleErrors) {
                    safeError('SlashHandler', err);
                }
                await this._framework.events.emit('CommandError', { interaction, commandName: interaction.commandName, error: err, traceId });
                if (typeof options?.onCommandError === 'function') {
                    Promise.resolve(options.onCommandError(interaction, interaction.commandName, err)).catch(() => {});
                }
                if (interaction.replied || interaction.deferred) return;
                const helpers = container?.get?.('helpers');
                const payload = helpers?.createGenericErrorPayload
                    ? helpers.createGenericErrorPayload(interaction.user?.id)
                    : { content: 'This command is currently unavailable. Please try again later.', ephemeral: true };
                await safeRespond(interaction, payload, options);
            }
        });

        try {
            await chain.run(context);
            if (context.blocked) {
                await this._framework.events.emit('CommandBlocked', { interaction, commandName: interaction.commandName, traceId });
                if (typeof options?.onCommandBlocked === 'function') {
                    Promise.resolve(options.onCommandBlocked(interaction, interaction.commandName)).catch(() => {});
                }
            }
        } catch (err) {
            if (!options?.suppressSlashHandlerConsoleErrors) {
                safeError('SlashHandler', err);
            }
            if (!interaction.replied && !interaction.deferred) {
                const helpers = container?.get?.('helpers');
                const payload = helpers?.createGenericErrorPayload
                    ? helpers.createGenericErrorPayload(interaction.user?.id)
                    : { content: 'This command is currently unavailable. Please try again later.', ephemeral: true };
                await safeRespond(interaction, payload, options);
            }
        }
        return true;
    }
}

module.exports = { SlashHandler };
