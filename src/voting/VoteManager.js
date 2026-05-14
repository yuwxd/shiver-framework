const { randomUUID } = require('crypto');

class VoteManager {
    constructor() {
        this._polls = new Map();
    }

    create(channelId, options, opts = {}) {
        const id = opts.id ?? randomUUID();
        const poll = {
            id,
            channelId,
            title: opts.title ?? 'Poll',
            options: options.map((label, i) => ({ label, index: i, votes: new Set() })),
            anonymous: opts.anonymous ?? false,
            maxVotes: opts.maxVotes ?? 1,
            createdAt: Date.now(),
            endsAt: opts.timeoutMs ? Date.now() + opts.timeoutMs : null,
            ended: false
        };
        this._polls.set(id, poll);

        if (opts.timeoutMs) {
            setTimeout(() => this.end(id), opts.timeoutMs);
        }

        return id;
    }

    cast(pollId, userId, optionIndex) {
        const poll = this._polls.get(pollId);
        if (!poll || poll.ended) return { ok: false, reason: poll ? 'Poll ended' : 'Not found' };

        const currentVotes = poll.options.filter(o => o.votes.has(userId));
        if (currentVotes.length >= poll.maxVotes) {
            for (const opt of currentVotes) opt.votes.delete(userId);
        }

        const option = poll.options[optionIndex];
        if (!option) return { ok: false, reason: 'Invalid option' };

        option.votes.add(userId);
        return { ok: true };
    }

    retract(pollId, userId) {
        const poll = this._polls.get(pollId);
        if (!poll || poll.ended) return false;
        for (const opt of poll.options) opt.votes.delete(userId);
        return true;
    }

    getResults(pollId) {
        const poll = this._polls.get(pollId);
        if (!poll) return null;
        const total = poll.options.reduce((s, o) => s + o.votes.size, 0);
        const options = poll.options.map(o => ({
            label: o.label,
            index: o.index,
            votes: o.votes.size,
            percent: total === 0 ? 0 : Math.round((o.votes.size / total) * 100)
        }));
        const winner = [...options].sort((a, b) => b.votes - a.votes)[0] ?? null;
        return { id: pollId, title: poll.title, options, total, winner, ended: poll.ended };
    }

    end(pollId) {
        const poll = this._polls.get(pollId);
        if (!poll) return null;
        poll.ended = true;
        return this.getResults(pollId);
    }

    delete(pollId) {
        this._polls.delete(pollId);
    }

    get(pollId) {
        return this._polls.get(pollId) ?? null;
    }
}

module.exports = { VoteManager };
