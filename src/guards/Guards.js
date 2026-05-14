class OwnerGuard {
    constructor(ownerIds = []) {
        this._ids = new Set(Array.isArray(ownerIds) ? ownerIds : [ownerIds]);
    }

    check(userId) {
        return this._ids.has(userId);
    }

    middleware() {
        return async (context, next) => {
            const userId = context.interaction?.user?.id ?? context.message?.author?.id;
            if (!this.check(userId)) return;
            await next();
        };
    }
}

class GuildGuard {
    constructor(allowedGuildIds = []) {
        this._ids = new Set(Array.isArray(allowedGuildIds) ? allowedGuildIds : [allowedGuildIds]);
    }

    check(guildId) {
        return this._ids.has(guildId);
    }

    middleware() {
        return async (context, next) => {
            const guildId = context.interaction?.guild?.id ?? context.message?.guild?.id;
            if (!this.check(guildId)) return;
            await next();
        };
    }
}

class ChannelGuard {
    constructor(allowedChannelIds = []) {
        this._ids = new Set(Array.isArray(allowedChannelIds) ? allowedChannelIds : [allowedChannelIds]);
    }

    check(channelId) {
        return this._ids.has(channelId);
    }

    middleware() {
        return async (context, next) => {
            const channelId = context.interaction?.channel?.id ?? context.message?.channel?.id;
            if (!this.check(channelId)) return;
            await next();
        };
    }
}

class RoleGuard {
    constructor(requiredRoleIds = [], opts = {}) {
        this._ids = new Set(Array.isArray(requiredRoleIds) ? requiredRoleIds : [requiredRoleIds]);
        this._requireAll = opts.requireAll ?? false;
    }

    check(member) {
        if (!member?.roles?.cache) return false;
        const roles = member.roles.cache;
        if (this._requireAll) return [...this._ids].every(id => roles.has(id));
        return [...this._ids].some(id => roles.has(id));
    }

    middleware() {
        return async (context, next) => {
            const member = context.interaction?.member ?? context.message?.member;
            if (!this.check(member)) return;
            await next();
        };
    }
}

class TimeGuard {
    constructor(startHour, endHour, opts = {}) {
        this._start = startHour;
        this._end = endHour;
        this._timezone = opts.timezone ?? 'UTC';
    }

    check() {
        const now = new Date();
        const hour = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            hour12: false,
            timeZone: this._timezone
        }).format(now);
        const h = parseInt(hour, 10);
        if (this._start <= this._end) return h >= this._start && h < this._end;
        return h >= this._start || h < this._end;
    }

    middleware() {
        return async (context, next) => {
            if (!this.check()) return;
            await next();
        };
    }
}

class RateLimitGuard {
    constructor(limit, windowMs) {
        this._limit = limit;
        this._windowMs = windowMs;
        this._buckets = new Map();
    }

    check(key) {
        const now = Date.now();
        const bucket = this._buckets.get(key) ?? { count: 0, resetAt: now + this._windowMs };
        if (now > bucket.resetAt) {
            bucket.count = 0;
            bucket.resetAt = now + this._windowMs;
        }
        if (bucket.count < this._limit) {
            bucket.count++;
            this._buckets.set(key, bucket);
            return true;
        }
        return false;
    }

    middleware(keyFn) {
        return async (context, next) => {
            const key = keyFn ? keyFn(context) : (context.interaction?.user?.id ?? context.message?.author?.id ?? 'global');
            if (!this.check(key)) return;
            await next();
        };
    }
}

module.exports = { OwnerGuard, GuildGuard, ChannelGuard, RoleGuard, TimeGuard, RateLimitGuard };
