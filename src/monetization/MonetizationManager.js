const { EventEmitter } = require('events');
const crypto = require('crypto');

const SUBSCRIPTION_TIERS = {
    FREE: 'free',
    BASIC: 'basic',
    PREMIUM: 'premium',
    ENTERPRISE: 'enterprise'
};

const ENTITLEMENT_TYPES = {
    PURCHASE: 1,
    PREMIUM_SUBSCRIPTION: 2,
    DEVELOPER_GIFT: 3,
    TEST_MODE_PURCHASE: 4,
    FREE_PURCHASE: 5,
    USER_GIFT: 6,
    PREMIUM_PURCHASE: 7,
    APPLICATION_SUBSCRIPTION: 8
};

class Entitlement {
    constructor(data) {
        this.id = data.id;
        this.skuId = data.sku_id ?? data.skuId;
        this.applicationId = data.application_id ?? data.applicationId;
        this.userId = data.user_id ?? data.userId ?? null;
        this.guildId = data.guild_id ?? data.guildId ?? null;
        this.type = data.type;
        this.deleted = data.deleted ?? false;
        this.startsAt = data.starts_at ? new Date(data.starts_at) : null;
        this.endsAt = data.ends_at ? new Date(data.ends_at) : null;
        this.consumed = data.consumed ?? false;
    }

    get isActive() {
        if (this.deleted) return false;
        const now = new Date();
        if (this.startsAt && now < this.startsAt) return false;
        if (this.endsAt && now > this.endsAt) return false;
        return true;
    }

    get isExpired() {
        if (!this.endsAt) return false;
        return new Date() > this.endsAt;
    }

    get daysRemaining() {
        if (!this.endsAt) return Infinity;
        const diff = this.endsAt.getTime() - Date.now();
        return Math.max(0, Math.floor(diff / 86400000));
    }

    get isInGracePeriod() {
        if (!this.endsAt) return false;
        const gracePeriod = 3 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        return now > this.endsAt.getTime() && now < this.endsAt.getTime() + gracePeriod;
    }

    toJSON() {
        return {
            id: this.id, skuId: this.skuId, applicationId: this.applicationId,
            userId: this.userId, guildId: this.guildId, type: this.type,
            deleted: this.deleted, startsAt: this.startsAt?.toISOString(),
            endsAt: this.endsAt?.toISOString(), consumed: this.consumed,
            isActive: this.isActive, daysRemaining: this.daysRemaining
        };
    }
}

class SKU {
    constructor(data) {
        this.id = data.id;
        this.type = data.type;
        this.applicationId = data.application_id ?? data.applicationId;
        this.name = data.name;
        this.slug = data.slug;
        this.flags = data.flags ?? 0;
    }

    get isAvailable() { return (this.flags & 4) !== 0; }
    get isGuildSubscription() { return this.type === 5; }
    get isUserSubscription() { return this.type === 6; }
}

class MonetizationManager extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._client = null;
        this._storage = opts.storage ?? null;
        this._applicationId = opts.applicationId ?? null;
        this._publicKey = opts.publicKey ?? null;
        this._skuCache = new Map();
        this._entitlementCache = new Map();
        this._entitlementCacheTtl = opts.entitlementCacheTtl ?? 300000;
        this._gracePeriod = opts.gracePeriod ?? 3 * 24 * 60 * 60 * 1000;
        this._trialDuration = opts.trialDuration ?? null;
        this._tierMap = new Map(Object.entries(opts.tierMap ?? {}));
        this._webhookSecret = opts.webhookSecret ?? null;
        this._opts = opts;
    }

    setClient(client) {
        this._client = client;
        this._applicationId = this._applicationId ?? client.application?.id;
        return this;
    }

    setStorage(storage) {
        this._storage = storage;
        return this;
    }

    async fetchSKUs() {
        if (!this._client || !this._applicationId) throw new Error('Client not initialized');
        const skus = await this._client.application?.fetchSKUs?.();
        if (skus) {
            for (const sku of skus.values()) {
                this._skuCache.set(sku.id, new SKU(sku));
            }
        }
        return this._skuCache;
    }

    async fetchEntitlements(opts = {}) {
        if (!this._client || !this._applicationId) throw new Error('Client not initialized');
        const entitlements = await this._client.application?.fetchEntitlements?.(opts);
        if (entitlements) {
            for (const ent of entitlements.values()) {
                const entitlement = new Entitlement(ent);
                this._cacheEntitlement(entitlement);
            }
        }
        return entitlements;
    }

    _cacheEntitlement(entitlement) {
        const key = entitlement.id;
        this._entitlementCache.set(key, { entitlement, cachedAt: Date.now() });

        if (entitlement.userId) {
            const userKey = `user:${entitlement.userId}`;
            const existing = this._entitlementCache.get(userKey) ?? { entitlements: [], cachedAt: Date.now() };
            const ids = existing.entitlements ?? [];
            if (!ids.includes(entitlement.id)) ids.push(entitlement.id);
            this._entitlementCache.set(userKey, { entitlements: ids, cachedAt: Date.now() });
        }

        if (entitlement.guildId) {
            const guildKey = `guild:${entitlement.guildId}`;
            const existing = this._entitlementCache.get(guildKey) ?? { entitlements: [], cachedAt: Date.now() };
            const ids = existing.entitlements ?? [];
            if (!ids.includes(entitlement.id)) ids.push(entitlement.id);
            this._entitlementCache.set(guildKey, { entitlements: ids, cachedAt: Date.now() });
        }
    }

    _isCacheValid(cachedAt) {
        return Date.now() - cachedAt < this._entitlementCacheTtl;
    }

    invalidateCache(userId, guildId) {
        if (userId) this._entitlementCache.delete(`user:${userId}`);
        if (guildId) this._entitlementCache.delete(`guild:${guildId}`);
    }

    async hasEntitlement(userId, skuIds, opts = {}) {
        const ids = Array.isArray(skuIds) ? skuIds : [skuIds];
        const guildId = opts.guildId ?? null;

        const userKey = `user:${userId}`;
        const cached = this._entitlementCache.get(userKey);

        if (cached && this._isCacheValid(cached.cachedAt)) {
            for (const entId of (cached.entitlements ?? [])) {
                const entCached = this._entitlementCache.get(entId);
                if (entCached?.entitlement?.isActive && ids.includes(entCached.entitlement.skuId)) {
                    return true;
                }
            }
        }

        if (guildId) {
            const guildKey = `guild:${guildId}`;
            const guildCached = this._entitlementCache.get(guildKey);
            if (guildCached && this._isCacheValid(guildCached.cachedAt)) {
                for (const entId of (guildCached.entitlements ?? [])) {
                    const entCached = this._entitlementCache.get(entId);
                    if (entCached?.entitlement?.isActive && ids.includes(entCached.entitlement.skuId)) {
                        return true;
                    }
                }
            }
        }

        try {
            const entitlements = await this.fetchEntitlements({ userId, skuIds: ids });
            if (entitlements) {
                for (const ent of entitlements.values()) {
                    const entitlement = new Entitlement(ent);
                    if (entitlement.isActive) return true;
                }
            }
        } catch (_) {}

        return false;
    }

    async getUserTier(userId, guildId) {
        for (const [tier, skuIds] of this._tierMap) {
            const has = await this.hasEntitlement(userId, skuIds, { guildId });
            if (has) return tier;
        }
        return SUBSCRIPTION_TIERS.FREE;
    }

    setTierSkus(tier, skuIds) {
        this._tierMap.set(tier, Array.isArray(skuIds) ? skuIds : [skuIds]);
        return this;
    }

    async isInTrial(userId) {
        if (!this._storage || !this._trialDuration) return false;
        const trialData = await this._storage.get('monetization_trials', userId);
        if (!trialData) return false;
        return Date.now() < trialData.startedAt + this._trialDuration;
    }

    async startTrial(userId) {
        if (!this._storage) return false;
        const existing = await this._storage.get('monetization_trials', userId);
        if (existing) return false;
        await this._storage.set('monetization_trials', userId, { startedAt: Date.now(), userId });
        this.emit('trialStarted', userId);
        return true;
    }

    async getTrialRemaining(userId) {
        if (!this._storage || !this._trialDuration) return 0;
        const trialData = await this._storage.get('monetization_trials', userId);
        if (!trialData) return 0;
        const remaining = (trialData.startedAt + this._trialDuration) - Date.now();
        return Math.max(0, remaining);
    }

    async consumeEntitlement(entitlementId) {
        if (!this._client) throw new Error('Client not initialized');
        await this._client.application?.consumeEntitlement?.(entitlementId);
        const cached = this._entitlementCache.get(entitlementId);
        if (cached?.entitlement) cached.entitlement.consumed = true;
        this.emit('entitlementConsumed', entitlementId);
    }

    async createTestEntitlement(skuId, opts = {}) {
        if (!this._client) throw new Error('Client not initialized');
        const entitlement = await this._client.application?.createTestEntitlement?.(skuId, opts);
        if (entitlement) {
            const ent = new Entitlement(entitlement);
            this._cacheEntitlement(ent);
            this.emit('testEntitlementCreated', ent);
            return ent;
        }
        return null;
    }

    async deleteTestEntitlement(entitlementId) {
        if (!this._client) throw new Error('Client not initialized');
        await this._client.application?.deleteTestEntitlement?.(entitlementId);
        this._entitlementCache.delete(entitlementId);
        this.emit('testEntitlementDeleted', entitlementId);
    }

    verifyWebhookSignature(body, signature, timestamp) {
        if (!this._publicKey) throw new Error('Public key not configured');
        const message = timestamp + body;
        const sig = Buffer.from(signature, 'hex');
        const msg = Buffer.from(message);
        const key = Buffer.from(this._publicKey, 'hex');
        return crypto.verify(null, msg, { key, format: 'der', type: 'spki' }, sig);
    }

    handleEntitlementCreate(entitlement) {
        const ent = new Entitlement(entitlement);
        this._cacheEntitlement(ent);
        this.emit('entitlementCreate', ent);
        return ent;
    }

    handleEntitlementUpdate(entitlement) {
        const ent = new Entitlement(entitlement);
        this._cacheEntitlement(ent);
        this.invalidateCache(ent.userId, ent.guildId);
        this.emit('entitlementUpdate', ent);
        return ent;
    }

    handleEntitlementDelete(entitlement) {
        const ent = new Entitlement(entitlement);
        this._entitlementCache.delete(ent.id);
        this.invalidateCache(ent.userId, ent.guildId);
        this.emit('entitlementDelete', ent);
        return ent;
    }

    getStats() {
        return {
            cachedEntitlements: this._entitlementCache.size,
            cachedSkus: this._skuCache.size,
            tiers: [...this._tierMap.keys()]
        };
    }
}

module.exports = { MonetizationManager, Entitlement, SKU, SUBSCRIPTION_TIERS, ENTITLEMENT_TYPES };
