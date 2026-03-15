const TOKEN_REGEX = /^[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}$/;
const BOT_TOKEN_REGEX = /^Bot\s+[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}$/;
const WEBHOOK_TOKEN_REGEX = /^[A-Za-z0-9_-]{60,70}$/;

const SENSITIVE_PATTERNS = [
    { pattern: TOKEN_REGEX, name: 'discord_token' },
    { pattern: BOT_TOKEN_REGEX, name: 'discord_bot_token' },
    { pattern: /sk-[A-Za-z0-9]{32,}/, name: 'openai_key' },
    { pattern: /AIza[A-Za-z0-9_-]{35}/, name: 'google_api_key' },
    { pattern: /ghp_[A-Za-z0-9]{36}/, name: 'github_token' },
    { pattern: /xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+/, name: 'slack_bot_token' },
    { pattern: /mongodb\+srv:\/\/[^@]+@/, name: 'mongodb_uri' },
    { pattern: /postgresql:\/\/[^@]+@/, name: 'postgres_uri' },
    { pattern: /redis:\/\/[^@]+@/, name: 'redis_uri_with_password' },
    { pattern: /[A-Za-z0-9+/]{40,}={0,2}/, name: 'base64_secret' }
];

function validateTokenFormat(token) {
    if (typeof token !== 'string') return { valid: false, reason: 'Token must be a string' };

    const clean = token.startsWith('Bot ') ? token.slice(4) : token;

    if (!TOKEN_REGEX.test(clean)) {
        return { valid: false, reason: 'Token does not match Discord token format' };
    }

    try {
        const parts = clean.split('.');
        const userId = Buffer.from(parts[0], 'base64').toString('utf8');
        if (!/^\d+$/.test(userId)) {
            return { valid: false, reason: 'Token user ID part is invalid' };
        }
    } catch (_) {
        return { valid: false, reason: 'Token is malformed' };
    }

    return { valid: true };
}

function extractTokenUserId(token) {
    try {
        const clean = token.startsWith('Bot ') ? token.slice(4) : token;
        const parts = clean.split('.');
        return Buffer.from(parts[0], 'base64').toString('utf8');
    } catch (_) {
        return null;
    }
}

function redactToken(str) {
    if (typeof str !== 'string') return str;
    return str.replace(TOKEN_REGEX, (match) => {
        const parts = match.split('.');
        return `${parts[0]}.[REDACTED].[REDACTED]`;
    }).replace(BOT_TOKEN_REGEX, (match) => {
        const token = match.slice(4);
        const parts = token.split('.');
        return `Bot ${parts[0]}.[REDACTED].[REDACTED]`;
    });
}

function scanForSecrets(obj, path = '') {
    const findings = [];

    if (typeof obj === 'string') {
        for (const { pattern, name } of SENSITIVE_PATTERNS) {
            if (pattern.test(obj)) {
                findings.push({ path, type: name, value: obj.slice(0, 10) + '...' });
            }
        }
        return findings;
    }

    if (typeof obj === 'object' && obj !== null) {
        for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;
            const sensitiveKeys = ['token', 'secret', 'password', 'key', 'apikey', 'api_key', 'auth', 'credential'];
            if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
                findings.push({ path: currentPath, type: 'sensitive_key', value: '[REDACTED]' });
            }
            findings.push(...scanForSecrets(value, currentPath));
        }
    }

    return findings;
}

function checkTokenInSource(sourceCode) {
    const findings = [];

    const tokenMatches = sourceCode.match(TOKEN_REGEX);
    if (tokenMatches) {
        findings.push({ type: 'hardcoded_token', count: tokenMatches.length, severity: 'critical' });
    }

    const envPatterns = [
        /process\.env\.\w+/g,
        /require\(['"]dotenv['"]\)/,
        /config\.\w+/g
    ];

    const usesEnv = envPatterns.some(p => p.test(sourceCode));

    return { findings, usesEnv, safe: findings.length === 0 };
}

function warnIfTokenInEnv(token, envVarName) {
    const envToken = process.env[envVarName];
    if (!envToken) {
        return { ok: false, reason: `Environment variable ${envVarName} is not set` };
    }
    if (envToken !== token) {
        return { ok: false, reason: 'Token does not match environment variable' };
    }
    return { ok: true };
}

class TokenValidator {
    constructor(opts = {}) {
        this._token = null;
        this._envVar = opts.envVar ?? 'DISCORD_TOKEN';
        this._warnOnHardcode = opts.warnOnHardcode !== false;
        this._logger = opts.logger ?? console;
    }

    validate(token) {
        const result = validateTokenFormat(token);
        if (!result.valid) return result;

        const userId = extractTokenUserId(token);
        return { valid: true, userId };
    }

    setToken(token) {
        const validation = this.validate(token);
        if (!validation.valid) {
            throw new Error(`Invalid Discord token: ${validation.reason}`);
        }
        this._token = token;
        return this;
    }

    getToken() {
        if (!this._token) {
            const envToken = process.env[this._envVar];
            if (!envToken) throw new Error(`Token not set. Provide token or set ${this._envVar} environment variable.`);
            return envToken;
        }
        return this._token;
    }

    redact(str) {
        return redactToken(str);
    }

    scan(obj) {
        return scanForSecrets(obj);
    }

    checkSource(code) {
        return checkTokenInSource(code);
    }
}

module.exports = {
    TokenValidator,
    validateTokenFormat,
    extractTokenUserId,
    redactToken,
    scanForSecrets,
    checkTokenInSource,
    warnIfTokenInEnv,
    SENSITIVE_PATTERNS
};
