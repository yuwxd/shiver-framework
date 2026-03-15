const { resolveString, resolveNumber, resolveInteger, resolveFloat, resolveBoolean,
    resolveSnowflake, resolveUrl, resolveColor, resolveDuration, resolveEnum,
    resolveUser, resolveMember, resolveChannel, resolveRole, resolveMessage,
    resolveEmoji, resolveInvite, resolveDate, resolveHyperlink } = require('../resolvers');

class Args {
    constructor(message, rawArgs, context = {}) {
        this._message = message;
        this._raw = Array.isArray(rawArgs) ? [...rawArgs] : rawArgs.trim().split(/\s+/).filter(Boolean);
        this._position = 0;
        this._saved = [];
        this._context = context;
        this._flags = new Map();
        this._options = new Map();
        this._parseFlags();
    }

    _parseFlags() {
        const remaining = [];
        let i = 0;
        while (i < this._raw.length) {
            const token = this._raw[i];
            if (token.startsWith('--')) {
                const key = token.slice(2);
                if (i + 1 < this._raw.length && !this._raw[i + 1].startsWith('-')) {
                    this._options.set(key, this._raw[i + 1]);
                    i += 2;
                } else {
                    this._flags.set(key, true);
                    i++;
                }
            } else if (token.startsWith('-') && token.length === 2 && /[a-zA-Z]/.test(token[1])) {
                this._flags.set(token[1], true);
                i++;
            } else {
                remaining.push(token);
                i++;
            }
        }
        this._tokens = remaining;
    }

    get remaining() {
        return this._tokens.slice(this._position);
    }

    get finished() {
        return this._position >= this._tokens.length;
    }

    get length() {
        return this._tokens.length;
    }

    get position() {
        return this._position;
    }

    hasFlag(flag) {
        return this._flags.has(flag);
    }

    getOption(name, fallback = null) {
        return this._options.get(name) ?? fallback;
    }

    getFlags() {
        return Object.fromEntries(this._flags);
    }

    getOptions() {
        return Object.fromEntries(this._options);
    }

    save() {
        this._saved.push(this._position);
        return this;
    }

    restore() {
        if (this._saved.length > 0) {
            this._position = this._saved.pop();
        }
        return this;
    }

    reset() {
        this._position = 0;
        return this;
    }

    skip(count = 1) {
        this._position = Math.min(this._position + count, this._tokens.length);
        return this;
    }

    peek(offset = 0) {
        return this._tokens[this._position + offset] ?? null;
    }

    consume() {
        if (this.finished) return null;
        return this._tokens[this._position++];
    }

    toArray() {
        return [...this._tokens];
    }

    rest() {
        const tokens = this._tokens.slice(this._position);
        this._position = this._tokens.length;
        return tokens.join(' ');
    }

    untilEnd() {
        return this.rest();
    }

    async pick(type, opts = {}) {
        if (this.finished) {
            if (opts.default !== undefined) return opts.default;
            return null;
        }
        const token = this._tokens[this._position];
        const result = await this._resolve(type, token, opts);
        if (result.ok) {
            this._position++;
            return result.value;
        }
        if (opts.default !== undefined) return opts.default;
        throw new ArgError(result.error, token, type);
    }

    async pickResult(type, opts = {}) {
        if (this.finished) return { ok: false, error: 'missing', value: null };
        const token = this._tokens[this._position];
        const result = await this._resolve(type, token, opts);
        if (result.ok) this._position++;
        return result;
    }

    async peekResult(type, opts = {}) {
        if (this.finished) return { ok: false, error: 'missing', value: null };
        const token = this._tokens[this._position];
        return await this._resolve(type, token, opts);
    }

    async many(type, opts = {}) {
        const results = [];
        const max = opts.max ?? Infinity;
        const min = opts.min ?? 0;

        while (!this.finished && results.length < max) {
            const token = this._tokens[this._position];
            const result = await this._resolve(type, token, opts);
            if (!result.ok) break;
            this._position++;
            results.push(result.value);
        }

        if (results.length < min) {
            throw new ArgError('too_few_args', null, type);
        }

        return results;
    }

    async repeat(type, count, opts = {}) {
        const results = [];
        for (let i = 0; i < count; i++) {
            if (this.finished) {
                if (opts.allowPartial) break;
                throw new ArgError('missing', null, type);
            }
            const token = this._tokens[this._position];
            const result = await this._resolve(type, token, opts);
            if (!result.ok) {
                if (opts.allowPartial) break;
                throw new ArgError(result.error, token, type);
            }
            this._position++;
            results.push(result.value);
        }
        return results;
    }

    async validate(type, opts = {}) {
        const result = await this.pickResult(type, opts);
        if (!result.ok) throw new ArgError(result.error, null, type);
        return result.value;
    }

    async _resolve(type, token, opts) {
        const ctx = this._message;
        switch (type) {
            case 'string': return resolveString(token, opts);
            case 'number': return resolveFloat(token, opts);
            case 'integer': return resolveInteger(token, opts);
            case 'float': return resolveFloat(token, opts);
            case 'boolean': return resolveBoolean(token);
            case 'snowflake': return resolveSnowflake(token);
            case 'url': return resolveUrl(token, opts);
            case 'hyperlink': return resolveHyperlink(token);
            case 'color': return resolveColor(token);
            case 'duration': return resolveDuration(token, opts);
            case 'emoji': return resolveEmoji(token, ctx?.guild);
            case 'invite': return resolveInvite(token);
            case 'date': return resolveDate(token, opts);
            case 'enum': return resolveEnum(token, opts.choices ?? []);
            case 'user': return resolveUser(ctx, token, opts);
            case 'member': return resolveMember(ctx, token, opts);
            case 'channel': return resolveChannel(ctx, token, opts);
            case 'role': return resolveRole(ctx, token, opts);
            case 'message': return resolveMessage(ctx, token, opts);
            default:
                if (typeof type === 'function') return type(token, ctx, opts);
                return { ok: false, error: 'unknown_type', value: null };
        }
    }

    static fromString(message, input, context = {}) {
        const tokens = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < input.length; i++) {
            const char = input[i];
            if ((char === '"' || char === "'") && !inQuote) {
                inQuote = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuote) {
                inQuote = false;
                quoteChar = '';
                if (current) { tokens.push(current); current = ''; }
            } else if (char === ' ' && !inQuote) {
                if (current) { tokens.push(current); current = ''; }
            } else {
                current += char;
            }
        }
        if (current) tokens.push(current);

        return new Args(message, tokens, context);
    }
}

class ArgError extends Error {
    constructor(code, token, type) {
        super(`Argument error: ${code} (token: ${token}, type: ${type})`);
        this.code = code;
        this.token = token;
        this.argType = type;
        this.name = 'ArgError';
    }
}

module.exports = { Args, ArgError };
