const { EventEmitter } = require('events');

const AUDIT_ACTIONS = {
    COMMAND_RUN: 'command.run',
    COMMAND_BLOCKED: 'command.blocked',
    COMMAND_ERROR: 'command.error',
    MOD_BAN: 'mod.ban',
    MOD_UNBAN: 'mod.unban',
    MOD_KICK: 'mod.kick',
    MOD_WARN: 'mod.warn',
    MOD_TIMEOUT: 'mod.timeout',
    MOD_MUTE: 'mod.mute',
    MOD_UNMUTE: 'mod.unmute',
    MOD_PURGE: 'mod.purge',
    MOD_LOCK: 'mod.lock',
    MOD_UNLOCK: 'mod.unlock',
    SETTINGS_CHANGE: 'settings.change',
    PLUGIN_LOAD: 'plugin.load',
    PLUGIN_UNLOAD: 'plugin.unload',
    COMMAND_RELOAD: 'command.reload',
    MEMBER_JOIN: 'member.join',
    MEMBER_LEAVE: 'member.leave',
    ROLE_ASSIGN: 'role.assign',
    ROLE_REMOVE: 'role.remove',
    ECONOMY_TRANSFER: 'economy.transfer',
    ECONOMY_DAILY: 'economy.daily',
    TICKET_CREATE: 'ticket.create',
    TICKET_CLOSE: 'ticket.close',
    GIVEAWAY_CREATE: 'giveaway.create',
    GIVEAWAY_END: 'giveaway.end'
};

class AuditEntry {
    constructor(opts) {
        this.id = opts.id ?? `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.action = opts.action;
        this.actorId = opts.actorId ?? null;
        this.targetId = opts.targetId ?? null;
        this.guildId = opts.guildId ?? null;
        this.channelId = opts.channelId ?? null;
        this.data = opts.data ?? {};
        this.reason = opts.reason ?? null;
        this.timestamp = opts.timestamp ?? Date.now();
        this.traceId = opts.traceId ?? null;
    }

    toJSON() {
        return {
            id: this.id, action: this.action, actorId: this.actorId, targetId: this.targetId,
            guildId: this.guildId, channelId: this.channelId, data: this.data,
            reason: this.reason, timestamp: this.timestamp, traceId: this.traceId
        };
    }
}

class AuditLogger extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._storage = opts.storage ?? null;
        this._storageNamespace = opts.storageNamespace ?? 'audit';
        this._maxMemory = opts.maxMemory ?? 1000;
        this._retention = opts.retention ?? null;
        this._entries = [];
        this._retentionTimer = null;

        if (this._retention && this._storage) {
            this._retentionTimer = setInterval(() => this._applyRetention(), 3600000);
            if (this._retentionTimer.unref) this._retentionTimer.unref();
        }
    }

    async log(action, opts = {}) {
        const entry = new AuditEntry({ action, ...opts });

        this._entries.push(entry);
        if (this._entries.length > this._maxMemory) this._entries.shift();

        if (this._storage) {
            await this._storage.set(this._storageNamespace, entry.id, entry.toJSON()).catch(() => {});
        }

        this.emit('entry', entry);
        this.emit(action, entry);
        return entry;
    }

    async query(filters = {}) {
        let entries = this._entries.map(e => e.toJSON());

        if (this._storage && filters.fromStorage) {
            const keys = await this._storage.keys(this._storageNamespace).catch(() => []);
            const stored = await Promise.all(keys.map(k => this._storage.get(this._storageNamespace, k).catch(() => null)));
            const storedEntries = stored.filter(Boolean);
            const memIds = new Set(entries.map(e => e.id));
            for (const e of storedEntries) {
                if (!memIds.has(e.id)) entries.push(e);
            }
        }

        if (filters.action) {
            const actions = Array.isArray(filters.action) ? filters.action : [filters.action];
            entries = entries.filter(e => actions.includes(e.action));
        }

        if (filters.actorId) entries = entries.filter(e => e.actorId === filters.actorId);
        if (filters.targetId) entries = entries.filter(e => e.targetId === filters.targetId);
        if (filters.guildId) entries = entries.filter(e => e.guildId === filters.guildId);
        if (filters.channelId) entries = entries.filter(e => e.channelId === filters.channelId);
        if (filters.traceId) entries = entries.filter(e => e.traceId === filters.traceId);

        if (filters.from) entries = entries.filter(e => e.timestamp >= filters.from);
        if (filters.to) entries = entries.filter(e => e.timestamp <= filters.to);
        if (filters.since) entries = entries.filter(e => e.timestamp >= Date.now() - filters.since);

        entries.sort((a, b) => b.timestamp - a.timestamp);

        if (filters.limit) entries = entries.slice(0, filters.limit);
        if (filters.offset) entries = entries.slice(filters.offset);

        return entries;
    }

    async getEntry(id) {
        const mem = this._entries.find(e => e.id === id);
        if (mem) return mem.toJSON();
        if (this._storage) return this._storage.get(this._storageNamespace, id).catch(() => null);
        return null;
    }

    async exportJSON(filters = {}) {
        const entries = await this.query({ ...filters, fromStorage: true });
        return JSON.stringify(entries, null, 2);
    }

    async exportCSV(filters = {}) {
        const entries = await this.query({ ...filters, fromStorage: true });
        const headers = ['id', 'action', 'actorId', 'targetId', 'guildId', 'channelId', 'reason', 'timestamp', 'traceId'];
        const rows = entries.map(e =>
            headers.map(h => {
                const v = e[h];
                if (v === null || v === undefined) return '';
                const str = String(v);
                return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
            }).join(',')
        );
        return [headers.join(','), ...rows].join('\n');
    }

    async _applyRetention() {
        if (!this._storage || !this._retention) return;
        const cutoff = Date.now() - this._retention;
        const keys = await this._storage.keys(this._storageNamespace).catch(() => []);

        for (const key of keys) {
            const entry = await this._storage.get(this._storageNamespace, key).catch(() => null);
            if (entry && entry.timestamp < cutoff) {
                await this._storage.delete(this._storageNamespace, key).catch(() => {});
            }
        }

        this._entries = this._entries.filter(e => e.timestamp >= cutoff);
    }

    getStats() {
        const actionCounts = {};
        for (const e of this._entries) {
            actionCounts[e.action] = (actionCounts[e.action] ?? 0) + 1;
        }
        return { total: this._entries.length, actions: actionCounts };
    }

    clear() {
        this._entries = [];
    }

    destroy() {
        if (this._retentionTimer) clearInterval(this._retentionTimer);
    }
}

module.exports = { AuditLogger, AuditEntry, AUDIT_ACTIONS };
