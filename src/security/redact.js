const SECRET_PATTERNS = [
    /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}\b/g,
    /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{38}\b/g,
    /Bearer\s+[A-Za-z0-9._-]+/gi,
    /token[=:]\s*["']?[A-Za-z0-9._-]{20,}["']?/gi,
    /password[=:]\s*["']?[^\s"']{6,}["']?/gi,
    /secret[=:]\s*["']?[A-Za-z0-9._-]{10,}["']?/gi,
    /api[_-]?key[=:]\s*["']?[A-Za-z0-9._-]{10,}["']?/gi
];

function redactSecrets(str) {
    if (typeof str !== 'string') return str;
    let result = str;
    for (const pattern of SECRET_PATTERNS) {
        result = result.replace(pattern, '[REDACTED]');
    }
    return result;
}

function safeError(tag, err) {
    const message = (err && typeof err.message === 'string')
        ? redactSecrets(err.message)
        : (err != null ? redactSecrets(String(err)) : 'Unknown error');
    const stack = err?.stack ? redactSecrets(err.stack.split('\n').slice(0, 5).join('\n')) : null;
    console.error(`[${tag}]`, message);
    if (stack && process.env.NODE_ENV !== 'production') {
        console.error(stack);
    }
}

module.exports = { redactSecrets, safeError };
