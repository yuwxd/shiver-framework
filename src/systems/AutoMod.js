const { EventEmitter } = require('events');

class AutoMod extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._storage = opts.storage ?? null;
        this._client = null;
        this._moderationAPI = opts.moderationAPI ?? null;
        this._rules = new Map();
        this._violations = new Map();
        this._thresholds = opts.thresholds ?? {};
        this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    setModerationAPI(api) {
        this._moderationAPI = api;
        return this;
    }

    setStorage(storage) {
        this._storage = storage;
        return this;
    }

    addRule(name, rule) {
        this._rules.set(name, {
            name,
            enabled: rule.enabled ?? true,
            test: rule.test,
            action: rule.action ?? 'delete',
            punishment: rule.punishment ?? null,
            punishmentThreshold: rule.punishmentThreshold ?? 3,
            punishmentWindow: rule.punishmentWindow ?? 300000,
            reason: rule.reason ?? `AutoMod: ${name}`,
            ...rule
        });
        return this;
    }

    removeRule(name) {
        this._rules.delete(name);
        return this;
    }

    enableRule(name) {
        const rule = this._rules.get(name);
        if (rule) rule.enabled = true;
        return this;
    }

    disableRule(name) {
        const rule = this._rules.get(name);
        if (rule) rule.enabled = false;
        return this;
    }

    _getViolationKey(guildId, userId, ruleName) {
        return `${guildId}:${userId}:${ruleName}`;
    }

    _recordViolation(guildId, userId, ruleName) {
        const key = this._getViolationKey(guildId, userId, ruleName);
        const now = Date.now();
        const violations = this._violations.get(key) ?? [];
        violations.push(now);
        this._violations.set(key, violations);
        return violations.length;
    }

    _getViolationCount(guildId, userId, ruleName, window) {
        const key = this._getViolationKey(guildId, userId, ruleName);
        const now = Date.now();
        const violations = (this._violations.get(key) ?? []).filter(t => now - t < window);
        this._violations.set(key, violations);
        return violations.length;
    }

    async check(message) {
        if (message.author?.bot) return [];
        const results = [];

        for (const [name, rule] of this._rules) {
            if (!rule.enabled) continue;
            let matched = false;
            try {
                matched = await rule.test(message.content, message);
            } catch (_) {}
            if (!matched) continue;

            results.push({ rule: name, action: rule.action, reason: rule.reason });
            this.emit('violation', message, rule);

            if (rule.action === 'delete' || rule.action === 'both') {
                if (message.deletable) await message.delete().catch(() => {});
            }

            if (message.guild && this._moderationAPI) {
                const violationCount = this._recordViolation(message.guild.id, message.author.id, name);
                const threshold = rule.punishmentThreshold;
                const window = rule.punishmentWindow;
                const recentCount = this._getViolationCount(message.guild.id, message.author.id, name, window);

                if (rule.punishment && recentCount >= threshold) {
                    await this._applyPunishment(message, rule);
                    this.emit('punishment', message, rule, recentCount);
                }
            }
        }

        return results;
    }

    async _applyPunishment(message, rule) {
        if (!this._moderationAPI || !message.guild) return;
        const guild = message.guild;
        const userId = message.author.id;
        const botId = message.client.user?.id ?? 'bot';

        switch (rule.punishment) {
            case 'warn':
                await this._moderationAPI.warn(guild, userId, { reason: rule.reason, moderatorId: botId }).catch(() => {});
                break;
            case 'mute':
                await this._moderationAPI.timeout(guild, userId, rule.muteDuration ?? 300000, { reason: rule.reason, moderatorId: botId }).catch(() => {});
                break;
            case 'kick':
                await this._moderationAPI.kick(guild, userId, { reason: rule.reason, moderatorId: botId }).catch(() => {});
                break;
            case 'ban':
                await this._moderationAPI.ban(guild, userId, { reason: rule.reason, moderatorId: botId }).catch(() => {});
                break;
        }
    }

    async getConfig(guildId) {
        if (!this._storage) return { rules: {} };
        return (await this._storage.get('automod_config', guildId)) ?? { rules: {} };
    }

    async setConfig(guildId, config) {
        if (!this._storage) return;
        await this._storage.set('automod_config', guildId, config);
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, violations] of this._violations) {
            const active = violations.filter(t => now - t < 600000);
            if (active.length === 0) {
                this._violations.delete(key);
            } else {
                this._violations.set(key, active);
            }
        }
    }

    destroy() {
        clearInterval(this._cleanupInterval);
        this._violations.clear();
    }
}

module.exports = { AutoMod };
