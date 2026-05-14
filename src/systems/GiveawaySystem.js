const { randomUUID } = require('crypto');

class GiveawaySystem {
    constructor(storage, opts = {}) {
        this._storage = storage;
        this._ns = opts.namespace ?? 'giveaways';
        this._timers = new Map();
    }

    async start(channel, opts = {}) {
        const id = opts.id ?? randomUUID();
        const endsAt = Date.now() + (opts.durationMs ?? 86400000);
        const giveaway = {
            id,
            channelId: channel.id,
            guildId: channel.guild?.id ?? null,
            prize: opts.prize ?? 'Prize',
            winnersCount: opts.winnersCount ?? 1,
            hostedBy: opts.hostedBy ?? null,
            entries: [],
            ended: false,
            createdAt: Date.now(),
            endsAt
        };

        await this._storage?.set(this._ns, id, giveaway);

        const timer = setTimeout(() => this.draw(id, giveaway.winnersCount), endsAt - Date.now());
        this._timers.set(id, timer);

        return { id, giveaway };
    }

    async enter(giveawayId, userId) {
        const giveaway = await this._getGiveaway(giveawayId);
        if (!giveaway) return { ok: false, reason: 'not_found' };
        if (giveaway.ended) return { ok: false, reason: 'ended' };
        if (giveaway.entries.includes(userId)) return { ok: false, reason: 'already_entered' };
        giveaway.entries.push(userId);
        await this._storage?.set(this._ns, giveawayId, giveaway);
        return { ok: true, count: giveaway.entries.length };
    }

    async leave(giveawayId, userId) {
        const giveaway = await this._getGiveaway(giveawayId);
        if (!giveaway || giveaway.ended) return false;
        giveaway.entries = giveaway.entries.filter(id => id !== userId);
        await this._storage?.set(this._ns, giveawayId, giveaway);
        return true;
    }

    async draw(giveawayId, winnersCount) {
        const giveaway = await this._getGiveaway(giveawayId);
        if (!giveaway) return null;

        clearTimeout(this._timers.get(giveawayId));
        this._timers.delete(giveawayId);

        const shuffled = [...giveaway.entries].sort(() => Math.random() - 0.5);
        const winners = shuffled.slice(0, winnersCount ?? giveaway.winnersCount);

        giveaway.ended = true;
        giveaway.winners = winners;
        await this._storage?.set(this._ns, giveawayId, giveaway);

        return { id: giveawayId, winners, prize: giveaway.prize, totalEntries: giveaway.entries.length };
    }

    async reroll(giveawayId, winnersCount) {
        const giveaway = await this._getGiveaway(giveawayId);
        if (!giveaway) return null;
        const shuffled = [...giveaway.entries].sort(() => Math.random() - 0.5);
        const winners = shuffled.slice(0, winnersCount ?? giveaway.winnersCount);
        giveaway.winners = winners;
        await this._storage?.set(this._ns, giveawayId, giveaway);
        return { id: giveawayId, winners, prize: giveaway.prize };
    }

    async get(giveawayId) {
        return this._getGiveaway(giveawayId);
    }

    async delete(giveawayId) {
        clearTimeout(this._timers.get(giveawayId));
        this._timers.delete(giveawayId);
        await this._storage?.delete(this._ns, giveawayId);
    }

    async _getGiveaway(id) {
        return this._storage ? this._storage.get(this._ns, id) : null;
    }
}

module.exports = { GiveawaySystem };
