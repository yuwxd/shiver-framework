const { EventEmitter } = require('events');

class AntiRaid extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._joinThreshold = opts.joinThreshold ?? 10;
        this._joinInterval = opts.joinInterval ?? 10000;
        this._action = opts.action ?? 'lockdown';
        this._lockdownDuration = opts.lockdownDuration ?? 300000;
        this._minAccountAge = opts.minAccountAge ?? 0;
        this._minMemberAge = opts.minMemberAge ?? 0;
        this._banNewAccounts = opts.banNewAccounts ?? false;
        this._newAccountAge = opts.newAccountAge ?? 86400000;
        this._verificationLevel = opts.verificationLevel ?? null;
        this._moderationAPI = opts.moderationAPI ?? null;
        this._joinBuckets = new Map();
        this._lockdowns = new Map();
        this._suspiciousUsers = new Map();
        this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    }

    setModerationAPI(api) {
        this._moderationAPI = api;
        return this;
    }

    async onMemberJoin(member) {
        const guild = member.guild;
        const now = Date.now();

        if (this._minAccountAge > 0) {
            const accountAge = now - member.user.createdAt.getTime();
            if (accountAge < this._minAccountAge) {
                this.emit('suspiciousJoin', member, 'new_account');
                if (this._banNewAccounts && this._moderationAPI) {
                    await this._moderationAPI.ban(guild, member.id, {
                        reason: 'Anti-raid: account too new',
                        moderatorId: guild.client.user?.id
                    });
                    return { action: 'banned', reason: 'new_account' };
                }
            }
        }

        const bucket = this._joinBuckets.get(guild.id) ?? { joins: [], active: false };
        bucket.joins.push({ userId: member.id, timestamp: now });
        bucket.joins = bucket.joins.filter(j => now - j.timestamp < this._joinInterval);
        this._joinBuckets.set(guild.id, bucket);

        if (bucket.joins.length >= this._joinThreshold && !bucket.active) {
            bucket.active = true;
            this._joinBuckets.set(guild.id, bucket);
            await this._triggerRaidAction(guild, bucket.joins.map(j => j.userId));
            return { action: this._action, triggered: true };
        }

        return { action: null, joinCount: bucket.joins.length };
    }

    async _triggerRaidAction(guild, userIds) {
        this.emit('raidDetected', guild, userIds);

        switch (this._action) {
            case 'lockdown':
                await this._lockdownGuild(guild);
                if (this._lockdownDuration > 0) {
                    const timer = setTimeout(async () => {
                        await this._unlockGuild(guild);
                        this._lockdowns.delete(guild.id);
                    }, this._lockdownDuration);
                    this._lockdowns.set(guild.id, timer);
                }
                break;
            case 'kick':
                for (const userId of userIds) {
                    try {
                        const member = guild.members.cache.get(userId);
                        if (member) await member.kick('Anti-raid protection');
                    } catch (_) {}
                }
                break;
            case 'ban':
                for (const userId of userIds) {
                    try {
                        await guild.bans.create(userId, { reason: 'Anti-raid protection' });
                    } catch (_) {}
                }
                break;
            case 'verification':
                if (this._verificationLevel !== null) {
                    try {
                        await guild.setVerificationLevel(this._verificationLevel, 'Anti-raid: raising verification');
                        this.emit('verificationRaised', guild, this._verificationLevel);
                    } catch (_) {}
                }
                break;
        }
    }

    async _lockdownGuild(guild) {
        const channels = guild.channels.cache.filter(c => c.isTextBased?.() && !c.isThread?.());
        for (const channel of channels.values()) {
            try {
                await channel.permissionOverwrites.edit(
                    guild.roles.everyone,
                    { SendMessages: false },
                    { reason: 'Anti-raid: lockdown' }
                );
            } catch (_) {}
        }
        this.emit('lockdown', guild);
    }

    async _unlockGuild(guild) {
        const channels = guild.channels.cache.filter(c => c.isTextBased?.() && !c.isThread?.());
        for (const channel of channels.values()) {
            try {
                await channel.permissionOverwrites.edit(
                    guild.roles.everyone,
                    { SendMessages: null },
                    { reason: 'Anti-raid: lockdown lifted' }
                );
            } catch (_) {}
        }
        this.emit('lockdownLifted', guild);
    }

    async endLockdown(guild) {
        const timer = this._lockdowns.get(guild.id);
        if (timer) { clearTimeout(timer); this._lockdowns.delete(guild.id); }
        const bucket = this._joinBuckets.get(guild.id);
        if (bucket) { bucket.active = false; }
        await this._unlockGuild(guild);
    }

    isInLockdown(guildId) {
        return this._lockdowns.has(guildId);
    }

    getJoinRate(guildId) {
        const bucket = this._joinBuckets.get(guildId);
        if (!bucket) return 0;
        const now = Date.now();
        const recent = bucket.joins.filter(j => now - j.timestamp < this._joinInterval);
        return recent.length;
    }

    _cleanup() {
        const now = Date.now();
        for (const [guildId, bucket] of this._joinBuckets) {
            const active = bucket.joins.filter(j => now - j.timestamp < this._joinInterval);
            if (active.length === 0 && !bucket.active) {
                this._joinBuckets.delete(guildId);
            } else {
                bucket.joins = active;
            }
        }
    }

    destroy() {
        clearInterval(this._cleanupInterval);
        for (const timer of this._lockdowns.values()) clearTimeout(timer);
        this._joinBuckets.clear();
        this._lockdowns.clear();
    }
}

module.exports = { AntiRaid };
