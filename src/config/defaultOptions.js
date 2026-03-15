const DEFAULT_OPTIONS = {
    client: {},
    commandsPath: './commands',
    prefix: ',',
    getPrefix: null,
    ownerIds: [],
    deferStrategy: 'whenSlow',
    deferWhenSlowThresholdMs: 1500,
    componentDeferWhenSlowThresholdMs: 1000,
    ephemeralByDefault: false,
    componentCollectorTimeoutMs: 300000,
    commandResponseTimeoutMs: 30000,
    autocompleteCacheMs: 5000,
    autocompleteDebounceMs: 0,
    maxOptionStringLength: 6000,
    normalizeOptionStrings: false,
    strictComponentHandling: false,
    componentHandlerNames: ['handleButton', 'handleSelect', 'handleSelectMenu', 'handleModalSubmit', 'handleModal', 'handleMusicSelect'],
    debug: false,
    dryRun: false,
    errorHandling: {
        level: 'friendly'
    },
    moderation: {
        checkRoleHierarchy: true
    },
    rest: {
        retryOn5xx: true,
        retryOn429: true,
        maxRetries: 3,
        maxRetryDelayMs: 30000
    },
    cache: {
        messageCacheSize: 200,
        memberCacheSize: 500,
        userCacheSize: 1000,
        sweepIntervalMs: 3600000,
        sweepMessageLifetimeMs: 3600000,
        sweepMemberLifetimeMs: 3600000,
        settingsTTLMs: 60000,
        settingsMaxSize: 1000
    },
    gateway: {
        compress: true,
        large_threshold: 50
    },
    storage: {
        backend: 'json',
        path: './data'
    },
    settings: {
        defaults: {
            guild: {},
            user: {}
        }
    },
    health: {
        enabled: false,
        host: '0.0.0.0',
        port: 8080,
        shutdownTimeout: 10000
    },
    assets: {
        baseDir: process.cwd()
    },
    voice: {
        maxBitrateKbps: 128,
        maxDurationSeconds: 600,
        transcode: false,
        nodeSelection: 'auto'
    },
    execute: {
        backend: 'piston',
        pistonUrl: 'https://emkc.org/api/v2/piston',
        timeoutMs: 10000,
        maxCodeLength: 10000
    },
    monetization: {
        enabled: false,
        webhookPath: '/webhook/monetization',
        premium: {
            backend: 'discord',
            requiredSkuIds: [],
            cacheTTLMs: 300000
        }
    },
    registration: {
        retryOnRateLimit: true,
        maxRetries: 3,
        onRateLimit: null
    },
    slashSync: {
        guildIds: null
    },
    migrationsPath: null,
    tryAcquirePrefixMessage: null,
    checkTOS: null,
    hasAccess: null,
    isBlacklisted: null,
    isUserAllowed: null,
    checkServerBlacklisted: null,
    checkServerCommand: null,
    afterPrefixMessage: null,
    afterSlashSync: null,
    afterReady: null,
    onCommandRun: null,
    onCommandBlocked: null,
    onCommandError: null,
    buildTosReply: null,
    messageTestingPhase: 'Bot is currently in testing phase. You are not authorized to use it.',
    i18n: {
        defaultLocale: 'en',
        messages: {}
    },
    multiInstance: false
};

module.exports = { DEFAULT_OPTIONS };
