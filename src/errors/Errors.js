const { randomUUID } = require('crypto');

const ERROR_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    FATAL: 4
};

const ERROR_CODES = {
    UNKNOWN: 'UNKNOWN_ERROR',
    COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
    COMMAND_DISABLED: 'COMMAND_DISABLED',
    COMMAND_BLOCKED: 'COMMAND_BLOCKED',
    COMMAND_EXECUTION: 'COMMAND_EXECUTION_ERROR',
    PRECONDITION_FAILED: 'PRECONDITION_FAILED',
    INHIBITOR_FAILED: 'INHIBITOR_FAILED',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    RATE_LIMITED: 'RATE_LIMITED',
    COOLDOWN: 'COOLDOWN',
    BLACKLISTED: 'BLACKLISTED',
    PREMIUM_REQUIRED: 'PREMIUM_REQUIRED',
    GUILD_ONLY: 'GUILD_ONLY',
    DM_ONLY: 'DM_ONLY',
    NSFW_ONLY: 'NSFW_ONLY',
    VOICE_REQUIRED: 'VOICE_REQUIRED',
    BOT_MISSING_PERMISSIONS: 'BOT_MISSING_PERMISSIONS',
    USER_MISSING_PERMISSIONS: 'USER_MISSING_PERMISSIONS',
    STORAGE_ERROR: 'STORAGE_ERROR',
    STORAGE_NOT_FOUND: 'STORAGE_NOT_FOUND',
    API_ERROR: 'API_ERROR',
    API_KEY_INVALID: 'API_KEY_INVALID',
    API_RATE_LIMITED: 'API_RATE_LIMITED',
    NETWORK_ERROR: 'NETWORK_ERROR',
    TIMEOUT: 'TIMEOUT',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    ARGUMENT_ERROR: 'ARGUMENT_ERROR',
    PLUGIN_ERROR: 'PLUGIN_ERROR',
    PLUGIN_NOT_FOUND: 'PLUGIN_NOT_FOUND',
    VOICE_NOT_CONNECTED: 'VOICE_NOT_CONNECTED',
    VOICE_ALREADY_CONNECTED: 'VOICE_ALREADY_CONNECTED',
    EXECUTE_ERROR: 'EXECUTE_ERROR',
    MODERATION_ERROR: 'MODERATION_ERROR',
    I18N_MISSING_KEY: 'I18N_MISSING_KEY',
    CIRCUIT_OPEN: 'CIRCUIT_BREAKER_OPEN',
    MIGRATION_ERROR: 'MIGRATION_ERROR',
    LOCKDOWN_ACTIVE: 'LOCKDOWN_ACTIVE'
};

class ShiverError extends Error {
    constructor(message, opts = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = opts.code ?? ERROR_CODES.UNKNOWN;
        this.level = opts.level ?? ERROR_LEVELS.ERROR;
        this.traceId = opts.traceId ?? randomUUID().split('-')[0].toUpperCase();
        this.timestamp = new Date();
        this.context = opts.context ?? {};
        this.cause = opts.cause ?? null;
        this.recoverable = opts.recoverable ?? true;
        this.userFacing = opts.userFacing ?? false;
        this.userMessage = opts.userMessage ?? null;
        if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            name: this.name, message: this.message, code: this.code,
            level: this.level, traceId: this.traceId,
            timestamp: this.timestamp.toISOString(),
            context: this.context, recoverable: this.recoverable,
            stack: this.stack
        };
    }

    withContext(context) {
        Object.assign(this.context, context);
        return this;
    }
}

class CommandError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.COMMAND_EXECUTION, ...opts });
        this.commandName = opts.commandName ?? null;
        this.userId = opts.userId ?? null;
        this.guildId = opts.guildId ?? null;
    }
}

class PreconditionError extends ShiverError {
    constructor(identifier, message, opts = {}) {
        super(message, { code: ERROR_CODES.PRECONDITION_FAILED, level: ERROR_LEVELS.WARN, ...opts });
        this.identifier = identifier;
        this.userFacing = true;
        this.userMessage = message;
    }
}

class InhibitorError extends ShiverError {
    constructor(reason, message, opts = {}) {
        super(message, { code: ERROR_CODES.INHIBITOR_FAILED, level: ERROR_LEVELS.WARN, ...opts });
        this.reason = reason;
        this.userFacing = true;
    }
}

class PermissionError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.PERMISSION_DENIED, level: ERROR_LEVELS.WARN, ...opts });
        this.missing = opts.missing ?? [];
        this.userFacing = true;
        this.userMessage = message;
    }
}

class RateLimitError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.RATE_LIMITED, level: ERROR_LEVELS.WARN, ...opts });
        this.resetAt = opts.resetAt ?? null;
        this.remaining = opts.remaining ?? null;
        this.userFacing = true;
    }
}

class StorageError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.STORAGE_ERROR, ...opts });
        this.namespace = opts.namespace ?? null;
        this.key = opts.key ?? null;
    }
}

class ApiError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.API_ERROR, ...opts });
        this.statusCode = opts.statusCode ?? null;
        this.endpoint = opts.endpoint ?? null;
        this.service = opts.service ?? null;
        this.isApiKeyError = opts.statusCode === 401 || opts.statusCode === 403 || opts.code === ERROR_CODES.API_KEY_INVALID;
    }
}

class ValidationError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.VALIDATION_ERROR, level: ERROR_LEVELS.WARN, ...opts });
        this.field = opts.field ?? null;
        this.value = opts.value ?? null;
        this.constraint = opts.constraint ?? null;
        this.userFacing = true;
        this.userMessage = message;
    }
}

class PluginError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.PLUGIN_ERROR, ...opts });
        this.pluginName = opts.pluginName ?? null;
    }
}

class VoiceError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.VOICE_NOT_CONNECTED, ...opts });
        this.guildId = opts.guildId ?? null;
    }
}

class ModerationError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.MODERATION_ERROR, ...opts });
        this.targetId = opts.targetId ?? null;
        this.action = opts.action ?? null;
    }
}

class MigrationError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.MIGRATION_ERROR, ...opts });
        this.migrationName = opts.migrationName ?? null;
        this.version = opts.version ?? null;
        this.recoverable = false;
    }
}

class TimeoutError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.TIMEOUT, ...opts });
        this.operation = opts.operation ?? null;
        this.duration = opts.duration ?? null;
    }
}

class NetworkError extends ShiverError {
    constructor(message, opts = {}) {
        super(message, { code: ERROR_CODES.NETWORK_ERROR, ...opts });
        this.url = opts.url ?? null;
    }
}

class ErrorBoundary {
    constructor(opts = {}) {
        this._handlers = new Map();
        this._defaultHandler = opts.defaultHandler ?? null;
        this._logger = opts.logger ?? console;
        this._onError = opts.onError ?? null;
    }

    on(errorClass, handler) {
        this._handlers.set(errorClass, handler);
        return this;
    }

    setDefault(handler) {
        this._defaultHandler = handler;
        return this;
    }

    async wrap(fn, context = {}) {
        try {
            return await fn();
        } catch (e) {
            return this._handle(e, context);
        }
    }

    async _handle(error, context) {
        if (this._onError) await this._onError(error, context);

        for (const [ErrorClass, handler] of this._handlers) {
            if (error instanceof ErrorClass) {
                return handler(error, context);
            }
        }

        if (this._defaultHandler) {
            return this._defaultHandler(error, context);
        }

        this._logger.error('[ErrorBoundary] Unhandled error:', error);
        throw error;
    }
}

class ErrorRecovery {
    constructor(opts = {}) {
        this._maxRetries = opts.maxRetries ?? 3;
        this._retryDelay = opts.retryDelay ?? 1000;
        this._backoffMultiplier = opts.backoffMultiplier ?? 2;
        this._retryableErrors = opts.retryableErrors ?? [NetworkError, TimeoutError];
    }

    _isRetryable(error) {
        return this._retryableErrors.some(ErrorClass => error instanceof ErrorClass);
    }

    async withRetry(fn, opts = {}) {
        const maxRetries = opts.maxRetries ?? this._maxRetries;
        let delay = opts.retryDelay ?? this._retryDelay;
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn(attempt);
            } catch (e) {
                lastError = e;
                if (attempt === maxRetries || !this._isRetryable(e)) throw e;
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= this._backoffMultiplier;
            }
        }

        throw lastError;
    }
}

module.exports = {
    ShiverError, CommandError, PreconditionError, InhibitorError,
    PermissionError, RateLimitError, StorageError, ApiError,
    ValidationError, PluginError, VoiceError, ModerationError,
    MigrationError, TimeoutError, NetworkError,
    ErrorBoundary, ErrorRecovery,
    ERROR_CODES, ERROR_LEVELS
};
