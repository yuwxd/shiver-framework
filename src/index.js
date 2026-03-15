const { Container } = require('./core/Container');
const { EventBus } = require('./core/EventBus');
const { ShiverClient, buildShiverClientOptions } = require('./core/ShiverClient');
const { CommandRegistry } = require('./core/CommandRegistry');
const { SlashHandler } = require('./handlers/SlashHandler');
const { PrefixHandler } = require('./handlers/PrefixHandler');
const { InteractionHandler } = require('./handlers/InteractionHandler');
const { AutocompleteHandler } = require('./handlers/AutocompleteHandler');
const { ContextMenuHandler } = require('./handlers/ContextMenuHandler');
const { PluginManager } = require('./plugins/PluginManager');
const { StatsManager } = require('./stats/StatsManager');
const { HealthManager } = require('./lifecycle/Health');
const { MessageEvents } = require('./events/MessageEvents');
const { PresenceManager } = require('./presence/PresenceManager');
const { ReloadManager } = require('./reload/ReloadManager');
const { JsonStorageAdapter, createStorageAdapter } = require('./storage/StorageAdapter');
const { SettingsManager } = require('./settings/SettingsManager');
const { MigrationRunner } = require('./migrations/MigrationRunner');
const { ModerationAPI } = require('./moderation/ModerationAPI');
const { MonetizationManager } = require('./monetization/MonetizationManager');
const { ExecuteRunner } = require('./execute/ExecuteRunner');
const { VoiceManager } = require('./voice/VoiceManager');
const { DEFAULT_OPTIONS } = require('./config/defaultOptions');
const { buildCustomId, parseCustomId } = require('./utils/customId');
const { ModalHelper } = require('./utils/ModalHelper');
const { EmbedHelper } = require('./utils/EmbedHelper');
const { safeRespond } = require('./handlers/safeRespond');
const { MemoryCache } = require('./cache/MemoryCache');
const { AssetLoader } = require('./assets/AssetLoader');
const { LiveDebugPanel } = require('./debug/LiveDebugPanel');
const { AntiCrash } = require('./core/AntiCrash');
const { ShardManager } = require('./sharding/ShardManager');
const { createMultiInstanceDetector } = require('./lifecycle/MultiInstanceDetector');
const { safeError } = require('./security/redact');
const { PingHelper } = require('./utils/PingHelper');
const { pushJson } = require('./utils/httpPush');

function deepMerge(target, source) {
    const out = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            out[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            out[key] = source[key];
        }
    }
    return out;
}

class ShiverFramework {
    constructor(userOptions = {}) {
        this.options = deepMerge(DEFAULT_OPTIONS, userOptions);
        this.container = new Container();
        this.events = new EventBus();
        this.commands = new CommandRegistry(this.options);
        this.plugins = new PluginManager(this);
        this.stats = new StatsManager(this.options.stats ?? {});
        this.health = new HealthManager(this.options.health ?? {});
        this.messageEvents = new MessageEvents(this);
        this.presence = new PresenceManager(this);
        this.reload = new ReloadManager(this);
        this.moderation = new ModerationAPI(this.options.moderation);
        this.monetization = new MonetizationManager(this.options.monetization);
        this.execute = new ExecuteRunner(this.options.execute);
        this.voice = new VoiceManager(this.options.voice);
        this.modal = new ModalHelper();
        this.embedHelper = new EmbedHelper();
        this.cache = new MemoryCache({ maxSize: 1000 });
        this.assets = new AssetLoader(this.options.assets);
        this.debugPanel = new LiveDebugPanel({ enabled: this.options.debug === true, ...(this.options.debugPanel ?? {}) });
        this.antiCrash = new AntiCrash(this.options.antiCrash);
        this.sharding = this.options.sharding?.scriptPath ? new ShardManager(this.options.sharding.scriptPath, this.options.sharding) : null;
        this._pingHelper = new PingHelper(null);
        this._prefixProcessedIds = new Set();
        this._prefixRunAtByMessageId = new Map();
        this._processedEventIds = new Set();
        this._executingNow = new Set();
        this._messageCreateHandlers = [];
        this._interactionCreateHandlers = [];
        this._shutdownHandlers = [];
        this._customMiddlewares = [];
        this.client = null;
        this._storage = null;
        this._settings = null;
        this._migrations = null;
        this._multiInstanceDetector = createMultiInstanceDetector(this);
        if (this._multiInstanceDetector) {
            this.events.on('CommandRun', () => {
                if (this._multiInstanceDetector?.isMultiple()) {
                    this._multiInstanceDetector.logWarning();
                }
            });
        }
    }

    use(middlewareFn) {
        this._customMiddlewares.push(middlewareFn);
        return this;
    }

    addInteractionCreateHandler(fn) {
        if (typeof fn === 'function') this._interactionCreateHandlers.push(fn);
        return this;
    }

    addMessageCreateHandler(fn) {
        if (typeof fn === 'function') this._messageCreateHandlers.push(fn);
        return this;
    }

    onShutdown(fn) {
        this._shutdownHandlers.push(fn);
        return this;
    }

    onCommandError(handler) {
        this.events.on('CommandError', handler);
        return this;
    }

    buildCustomId(prefix, command, action, userId) {
        return buildCustomId(prefix, command, action, userId, this.options.customIdSeparator);
    }

    parseCustomId(customId) {
        return parseCustomId(customId, this.options.customIdSeparator);
    }

    get ping() {
        return this._pingHelper;
    }

    httpPush(url, payload, opts) {
        return pushJson(url, payload, opts);
    }

    async followUp(interaction, payload) {
        return safeRespond(interaction, payload, this.options);
    }

    async confirm(interaction, question, opts = {}) {
        const { buildConfirmContainerV2 } = require('./components/v2/builders');
        const userId = interaction.user?.id ?? null;
        const customIdPrefix = buildCustomId('shiver', 'confirm', 'action', userId);
        const yesId = `${customIdPrefix}_yes_${userId ?? '0'}`;
        const noId = `${customIdPrefix}_no_${userId ?? '0'}`;
        const payload = buildConfirmContainerV2({
            color: opts.color ?? null,
            title: opts.title ?? 'Confirmation',
            description: question,
            confirmLabel: opts.yesLabel || 'Yes',
            cancelLabel: opts.noLabel || 'No',
            customIdPrefix,
            userId
        });

        return new Promise(async (resolve) => {
            await safeRespond(interaction, payload, this.options);
            const msg = await interaction.fetchReply().catch(() => null);
            if (!msg) return resolve(null);

            const collector = msg.createMessageComponentCollector({
                filter: i => i.user.id === userId && (i.customId === yesId || i.customId === noId),
                time: this.options.componentCollectorTimeoutMs,
                max: 1
            });

            collector.on('collect', async i => {
                await i.deferUpdate().catch(() => {});
                resolve(i.customId === yesId);
            });

            collector.on('end', (collected) => {
                if (collected.size === 0) resolve(null);
            });
        });
    }

    async paginate(interaction, pages, opts = {}) {
        const { buildPaginatedContainerV2 } = require('./components/v2/builders');
        if (!pages?.length) return;

        let current = 0;
        const userId = interaction.user?.id ?? null;
        const customIdPrefix = buildCustomId('shiver', 'pagination', 'page', userId);
        const prevId = `${customIdPrefix}_prev_${userId ?? '0'}`;
        const nextId = `${customIdPrefix}_next_${userId ?? '0'}`;

        const send = async (i, edit = false) => {
            const pageData = pages[current] ?? {};
            const payload = buildPaginatedContainerV2({
                color: opts.color ?? pageData.color ?? null,
                title: pageData.title ?? opts.title ?? null,
                content: pageData.content ?? pageData.description ?? String(pageData),
                currentPage: current + 1,
                totalPages: pages.length,
                customIdPrefix,
                userId
            });
            if (edit) {
                await i.update(payload).catch(() => {});
            } else {
                await safeRespond(i, payload, this.options);
            }
        };

        await send(interaction);
        const msg = await interaction.fetchReply().catch(() => null);
        if (!msg || pages.length <= 1) return;

        const collector = msg.createMessageComponentCollector({
            filter: i => i.user.id === userId && (i.customId === prevId || i.customId === nextId),
            time: this.options.componentCollectorTimeoutMs
        });

        collector.on('collect', async i => {
            if (i.customId === nextId) current = Math.min(current + 1, pages.length - 1);
            else current = Math.max(current - 1, 0);
            await send(i, true);
        });

        collector.on('end', () => {
            collector.removeAllListeners();
        });
    }

    createComponentCollector(interaction, opts = {}) {
        const time = opts.time ?? this.options.componentCollectorTimeoutMs;
        const filter = opts.filter;
        const msg = opts.message;
        const target = msg || interaction;

        const collector = target.createMessageComponentCollector?.({ filter, time, ...opts });
        if (!collector) return null;

        const stateMap = opts.stateMap;
        const stateKey = opts.stateKey;

        collector.on('end', () => {
            collector.removeAllListeners();
            if (stateMap && stateKey) stateMap.delete(stateKey);
        });

        return collector;
    }

    initStorage() {
        if (this._storage) return this._storage;
        this._storage = createStorageAdapter(this.options.storage?.backend ?? 'json', this.options.storage ?? {});
        this._settings = new SettingsManager(this._storage, {
            ...this.options.cache,
            defaults: this.options.settings?.defaults ?? {},
            defaultPrefix: this.options.prefix ?? ','
        });
        this._migrations = new MigrationRunner(this._storage, this.options.migrationsPath);
        this.embedHelper.setStorage(this._storage);
        return this._storage;
    }

    getClientOptions(overrides = {}) {
        return buildShiverClientOptions(deepMerge({
            ...this.options.client,
            rest: this.options.rest,
            ws: this.options.gateway,
            cacheOptions: this.options.cache
        }, overrides));
    }

    createClient(overrides = {}) {
        return new ShiverClient(this.getClientOptions(overrides));
    }

    get storage() {
        return this._storage || this.initStorage();
    }

    get settings() {
        if (!this._settings) this.initStorage();
        return this._settings;
    }

    get migrations() {
        if (!this._migrations) this.initStorage();
        return this._migrations;
    }

    async init(client) {
        this.client = client;
        this.container.set('client', client);
        this.container.set('assets', this.assets);
        this.container.set('debugPanel', this.debugPanel);
        this.container.set('antiCrash', this.antiCrash);
        if (this.sharding) this.container.set('sharding', this.sharding);
        this.stats.setClient(client);
        this.health.setClient(client);
        this._pingHelper.setClient(client);
        this.presence._client = client;
        this.voice._client = client;
        this.moderation._client = client;
        this.moderation._checkHierarchy = this.options.moderation?.checkRoleHierarchy !== false;
        this.monetization._client = client;
        this.reload._framework = this;
        this.antiCrash.attach(this);
        if (this.options.debug === true) this.debugPanel.enable().attach(this);
        this.health.markStarting();

        if (this.options.commandsPath) {
            this.commands.loadFromDirectory(this.options.commandsPath);
        }

        this.registerListeners(client);

        if (this._multiInstanceDetector) {
            this._multiInstanceDetector.start();
        }

        client.once('clientReady', async () => {
            if (this.options.slashSync?.guildIds !== false) {
                try {
                    const result = await this.commands.syncToDiscord(client, {
                        guildIds: this.options.slashSync?.guildIds
                    });
                    if (typeof this.options.afterSlashSync === 'function') {
                        this.options.afterSlashSync(result.applicationCommands).catch?.(() => {});
                    }
                    await this.events.emit('afterSlashSync', result.applicationCommands);
                } catch (err) {
                    safeError('ShiverFramework', err);
                }
            }

            if (typeof this.options.afterReady === 'function') {
                this.options.afterReady(client).catch?.(() => {});
            }
            await this.events.emit('afterReady', client);

            this.health.markReady();
        });

        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());

        return this;
    }

    registerListeners(client) {
        const opts = this.options;
        for (const fn of opts?.interactionCreateHandlers ?? []) {
            if (typeof fn === 'function') this._interactionCreateHandlers.push(fn);
        }
        for (const fn of opts?.messageCreateHandlers ?? []) {
            if (typeof fn === 'function') this._messageCreateHandlers.push(fn);
        }

        const slashHandler = new SlashHandler(this.commands, this);
        const prefixHandler = new PrefixHandler(this.commands, this);
        const interactionHandler = new InteractionHandler(this.commands, this);
        const autocompleteHandler = new AutocompleteHandler(this.commands, this);
        const contextMenuHandler = new ContextMenuHandler(this.commands, this);

        for (const mw of this._customMiddlewares) {
            slashHandler.use(mw);
            prefixHandler.use(mw);
        }

        const processedIds = this._processedEventIds;
        const executingNow = this._executingNow;
        const DEDUP_TTL_MS = 60000;

        const fw = this;

        client.on('interactionCreate', async (interaction) => {
            const key = `i:${interaction.id}`;
            if (processedIds.has(key)) {
                console.warn('[ShiverFramework] DUPLICATE interaction BLOCKED id=' + interaction.id);
                return;
            }
            if (executingNow.has(key)) {
                console.warn('[ShiverFramework] DUPLICATE interaction ALREADY EXECUTING id=' + interaction.id);
                return;
            }
            processedIds.add(key);
            executingNow.add(key);
            setTimeout(() => processedIds.delete(key), DEDUP_TTL_MS).unref?.();
            try {
                if (interaction.isChatInputCommand()) {
                    await slashHandler.handle(interaction);
                } else if (interaction.isContextMenuCommand()) {
                    await contextMenuHandler.handle(interaction);
                } else if (interaction.isAutocomplete()) {
                    await autocompleteHandler.handle(interaction);
                } else {
                    await interactionHandler.handle(interaction);
                }
                for (const fn of fw._interactionCreateHandlers) {
                    try { await fn(interaction); } catch (e) { safeError('ShiverFramework', e); }
                }
            } catch (err) {
                safeError('ShiverFramework', err);
            } finally {
                executingNow.delete(key);
            }
        });

        client.on('messageCreate', async (message) => {
            const key = `m:${message.id}`;
            if (processedIds.has(key)) {
                console.warn('[ShiverFramework] DUPLICATE message BLOCKED id=' + message.id);
                return;
            }
            if (executingNow.has(key)) {
                console.warn('[ShiverFramework] DUPLICATE message ALREADY EXECUTING id=' + message.id);
                return;
            }
            processedIds.add(key);
            executingNow.add(key);
            setTimeout(() => processedIds.delete(key), DEDUP_TTL_MS).unref?.();
            try {
                await prefixHandler.handle(message);
                for (const fn of fw._messageCreateHandlers) {
                    try { await fn(message); } catch (e) { safeError('ShiverFramework', e); }
                }
            } catch (err) {
                safeError('ShiverFramework', err);
            } finally {
                executingNow.delete(key);
            }
        });

        this.messageEvents.registerListeners(client);
    }

    async shutdown() {
        console.log('[ShiverFramework] Shutting down...');
        this.health.markShuttingDown();
        if (this._multiInstanceDetector) {
            this._multiInstanceDetector.stop();
        }
        for (const fn of this._shutdownHandlers) {
            try {
                await fn();
            } catch (err) {
                safeError('ShiverFramework', err);
            }
        }

        try {
            if (typeof this.voice.destroyAll === 'function') await this.voice.destroyAll();
            else if (typeof this.voice.disconnectAll === 'function') this.voice.disconnectAll();
        } catch (_) {}

        try {
            this.antiCrash.detach();
            this.debugPanel.detach();
            this.stats.destroy?.();
        } catch (_) {}

        if (this.client) {
            try {
                await this.client.destroy();
            } catch (_) {}
        }

        this.health.markStopped();
        process.exit(0);
    }

    afterReady(fn) {
        this.events.on('afterReady', fn);
        return this;
    }
}

function createShiverFramework(options = {}) {
    return new ShiverFramework(options);
}

module.exports = {
    ShiverFramework,
    createShiverFramework,

    Container: require('./core/Container').Container,
    EventBus: require('./core/EventBus').EventBus,
    ShiverClient: require('./core/ShiverClient').ShiverClient,
    CommandRegistry: require('./core/CommandRegistry').CommandRegistry,

    MemoryCache: require('./cache/MemoryCache').MemoryCache,
    RedisAdapter: require('./cache/RedisAdapter').RedisAdapter,

    ...require('./storage/StorageAdapter'),

    SettingsManager: require('./settings/SettingsManager').SettingsManager,
    MigrationRunner: require('./migrations/MigrationRunner').MigrationRunner,

    ...require('./moderation/ModerationAPI'),

    PluginManager: require('./plugins/PluginManager').PluginManager,

    ...require('./stats/StatsManager'),

    ...require('./lifecycle/Health'),

    ...require('./voice/VoiceManager'),

    ...require('./execute/ExecuteRunner'),

    ...require('./monetization/MonetizationManager'),

    ...require('./preconditions/index'),

    ...require('./inhibitors/index'),

    ...require('./structures/index'),

    ...require('./stores/index'),

    ...require('./resolvers/index'),

    Args: require('./args/index').Args,
    ArgError: require('./args/index').ArgError,

    ...require('./components/v2/builders'),
    ...require('./components/safe'),

    EmbedHelper: require('./utils/EmbedHelper').EmbedHelper,
    DEFAULT_COLORS: require('./utils/EmbedHelper').DEFAULT_COLORS,
    ModalHelper: require('./utils/ModalHelper').ModalHelper,
    createMessageBackedInteraction: require('./utils/createMessageBackedInteraction').createMessageBackedInteraction,
    MessageEditDeleteHelper: require('./utils/MessageEditDeleteHelper').MessageEditDeleteHelper,
    createMessageEditDeleteHelper: require('./utils/MessageEditDeleteHelper').createMessageEditDeleteHelper,

    ...require('./utils/Helpers'),
    replacePlaceholders: require('./utils/replacePlaceholders').replacePlaceholders,
    getInviteUrl: require('./utils/getInviteUrl').getInviteUrl,
    formatUserDisplay: require('./utils/userDisplayMention').formatUserDisplay,

    ...require('./anti-abuse/index'),

    ...require('./systems/index'),

    I18n: require('./i18n/index').I18n,

    PaginationSession: require('./pagination/index').PaginationSession,
    paginate: require('./pagination/index').paginate,
    chunkPages: require('./pagination/index').chunkPages,

    ConfirmationSession: require('./confirmation/index').ConfirmationSession,
    confirm: require('./confirmation/index').confirm,
    confirmDangerous: require('./confirmation/index').confirmDangerous,

    ...require('./errors/Errors'),

    ...require('./optimizations/RestOptimizer'),
    BatchProcessor: require('./optimizations/BatchProcessor').BatchProcessor,
    Debouncer: require('./optimizations/Debouncer').Debouncer,
    Throttler: require('./optimizations/Debouncer').Throttler,

    ThreadManager: require('./threads/ThreadManager').ThreadManager,
    WebhookManager: require('./webhooks/WebhookManager').WebhookManager,

    ...require('./collectors/index'),

    LIMITS: require('./config/LIMITS').LIMITS,
    DEFAULT_OPTIONS: require('./config/defaultOptions').DEFAULT_OPTIONS,

    JobQueue: require('./queue/JobQueue').JobQueue,
    Job: require('./queue/JobQueue').Job,
    JOB_STATUS: require('./queue/JobQueue').JOB_STATUS,

    RateLimiter: require('./ratelimit/RateLimitBucket').RateLimiter,
    MultiScopeRateLimiter: require('./ratelimit/RateLimitBucket').MultiScopeRateLimiter,
    TokenBucket: require('./ratelimit/RateLimitBucket').TokenBucket,
    SlidingWindowBucket: require('./ratelimit/RateLimitBucket').SlidingWindowBucket,
    FixedWindowBucket: require('./ratelimit/RateLimitBucket').FixedWindowBucket,

    AuditLogger: require('./audit/AuditLogger').AuditLogger,
    AuditEntry: require('./audit/AuditLogger').AuditEntry,
    AUDIT_ACTIONS: require('./audit/AuditLogger').AUDIT_ACTIONS,

    PermissionManager: require('./permissions/PermissionManager').PermissionManager,
    PERMISSION_LEVELS: require('./permissions/PermissionManager').PERMISSION_LEVELS,

    CacheManager: require('./cache/CacheManager').CacheManager,

    EventRouter: require('./events/EventRouter').EventRouter,

    HttpClient: require('./network/HttpClient').HttpClient,
    HttpError: require('./network/HttpClient').HttpError,

    Sandbox: require('./sandbox/Sandbox').Sandbox,
    SandboxResult: require('./sandbox/Sandbox').SandboxResult,

    Inspector: require('./debug/Inspector').Inspector,
    LiveDebugPanel: require('./debug/LiveDebugPanel').LiveDebugPanel,
    DEBUG_TYPES: require('./debug/LiveDebugPanel').DEBUG_TYPES,

    CommandTester: require('./testing/CommandTester').CommandTester,
    TestResult: require('./testing/CommandTester').TestResult,

    FileWatcher: require('./hot-reload/FileWatcher').FileWatcher,

    ShardLatencyMonitor: require('./optimizations/GatewayOptimizer').ShardLatencyMonitor,
    HeartbeatMonitor: require('./optimizations/GatewayOptimizer').HeartbeatMonitor,
    AutoReconnectManager: require('./optimizations/GatewayOptimizer').AutoReconnectManager,
    calculateMinimalIntents: require('./optimizations/GatewayOptimizer').calculateMinimalIntents,
    calculateShardCount: require('./optimizations/GatewayOptimizer').calculateShardCount,

    ...require('./testing/mocks'),

    validateSchema: require('./validation/validate').validateSchema,
    validateFrameworkConfig: require('./validation/validate').validateFrameworkConfig,
    validateCommandDefinition: require('./validation/validate').validateCommandDefinition,
    validateCustomId: require('./validation/validate').validateCustomId,
    validatePayload: require('./validation/validate').validatePayload,
    validateAndSanitizeOption: require('./validation/validate').validateAndSanitizeOption,

    ...require('./security/InputSanitizer'),

    RateLimitGuard: require('./security/RateLimitGuard').RateLimitGuard,
    SmartCooldown: require('./security/RateLimitGuard').SmartCooldown,

    TokenValidator: require('./security/TokenValidator').TokenValidator,
    validateTokenFormat: require('./security/TokenValidator').validateTokenFormat,
    redactToken: require('./security/TokenValidator').redactToken,
    scanForSecrets: require('./security/TokenValidator').scanForSecrets,

    AssetLoader: require('./assets/AssetLoader').AssetLoader,
    FONT_EXTENSIONS: require('./assets/AssetLoader').FONT_EXTENSIONS,
    IMAGE_EXTENSIONS: require('./assets/AssetLoader').IMAGE_EXTENSIONS,

    AntiCrash: require('./core/AntiCrash').AntiCrash,

    ShardManager: require('./sharding/ShardManager').ShardManager,

    PingHelper: require('./utils/PingHelper').PingHelper,
    pushJson: require('./utils/httpPush').pushJson,
    ...require('./security/redact')
};
