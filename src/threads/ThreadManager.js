const { ChannelType, ThreadAutoArchiveDuration } = require('discord.js');

class ThreadManager {
    constructor(opts = {}) {
        this._client = null;
        this._defaultAutoArchive = opts.defaultAutoArchive ?? ThreadAutoArchiveDuration.OneDay;
        this._defaultRateLimitPerUser = opts.defaultRateLimitPerUser ?? 0;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    async create(channel, opts = {}) {
        const {
            name,
            type = ChannelType.PublicThread,
            autoArchiveDuration = this._defaultAutoArchive,
            rateLimitPerUser = this._defaultRateLimitPerUser,
            reason,
            message,
            invitable,
            appliedTags
        } = opts;

        if (!name) throw new Error('Thread name is required');

        const createOpts = {
            name,
            autoArchiveDuration,
            rateLimitPerUser,
            reason,
            type
        };

        if (invitable !== undefined) createOpts.invitable = invitable;
        if (appliedTags) createOpts.appliedTags = appliedTags;

        if (message) {
            return channel.threads.create({ ...createOpts, startMessage: message });
        }

        return channel.threads.create(createOpts);
    }

    async createPrivate(channel, opts = {}) {
        return this.create(channel, { ...opts, type: ChannelType.PrivateThread, invitable: opts.invitable ?? false });
    }

    async createForumPost(forumChannel, opts = {}) {
        const { name, content, embeds, components, files, appliedTags, reason } = opts;
        if (!name) throw new Error('Forum post name is required');
        return forumChannel.threads.create({
            name,
            autoArchiveDuration: opts.autoArchiveDuration ?? this._defaultAutoArchive,
            reason,
            appliedTags: appliedTags ?? [],
            message: { content, embeds, components, files }
        });
    }

    async archive(thread, opts = {}) {
        const { locked = false, reason } = opts;
        return thread.setArchived(true, reason).then(t => locked ? t.setLocked(true, reason) : t);
    }

    async unarchive(thread, reason) {
        return thread.setArchived(false, reason);
    }

    async lock(thread, reason) {
        return thread.setLocked(true, reason);
    }

    async unlock(thread, reason) {
        return thread.setLocked(false, reason);
    }

    async addMember(thread, userId) {
        return thread.members.add(userId);
    }

    async removeMember(thread, userId) {
        return thread.members.remove(userId);
    }

    async addMembers(thread, userIds) {
        return Promise.all(userIds.map(id => thread.members.add(id)));
    }

    async removeMembers(thread, userIds) {
        return Promise.all(userIds.map(id => thread.members.remove(id)));
    }

    async fetchMembers(thread) {
        return thread.members.fetch();
    }

    async setAutoArchive(thread, duration, reason) {
        return thread.setAutoArchiveDuration(duration, reason);
    }

    async setName(thread, name, reason) {
        return thread.setName(name, reason);
    }

    async setRateLimit(thread, rateLimitPerUser, reason) {
        return thread.setRateLimitPerUser(rateLimitPerUser, reason);
    }

    async setSlowmode(thread, seconds, reason) {
        return this.setRateLimit(thread, seconds, reason);
    }

    async pin(thread, reason) {
        return thread.pin(reason);
    }

    async unpin(thread, reason) {
        return thread.unpin(reason);
    }

    async delete(thread, reason) {
        return thread.delete(reason);
    }

    async getActiveThreads(guild) {
        return guild.channels.fetchActiveThreads();
    }

    async getArchivedThreads(channel, opts = {}) {
        return channel.threads.fetchArchived(opts);
    }

    async getPublicArchivedThreads(channel, opts = {}) {
        return channel.threads.fetchArchived({ type: 'public', ...opts });
    }

    async getPrivateArchivedThreads(channel, opts = {}) {
        return channel.threads.fetchArchived({ type: 'private', ...opts });
    }

    async findThread(channel, name) {
        const active = await channel.threads.fetchActive();
        return active.threads.find(t => t.name.toLowerCase() === name.toLowerCase()) ?? null;
    }

    async getOrCreate(channel, name, opts = {}) {
        const existing = await this.findThread(channel, name);
        if (existing) return { thread: existing, created: false };
        const thread = await this.create(channel, { name, ...opts });
        return { thread, created: true };
    }

    async sendToThread(thread, payload) {
        return thread.send(payload);
    }

    async bulkArchive(guild, opts = {}) {
        const { maxAge, reason } = opts;
        const active = await guild.channels.fetchActiveThreads();
        const archived = [];
        for (const thread of active.threads.values()) {
            if (maxAge) {
                const age = Date.now() - thread.createdAt.getTime();
                if (age < maxAge) continue;
            }
            await this.archive(thread, { reason }).catch(() => {});
            archived.push(thread.id);
        }
        return archived;
    }

    async getStats(guild) {
        const active = await guild.channels.fetchActiveThreads();
        const threads = [...active.threads.values()];
        return {
            total: threads.length,
            public: threads.filter(t => t.type === ChannelType.PublicThread).length,
            private: threads.filter(t => t.type === ChannelType.PrivateThread).length,
            locked: threads.filter(t => t.locked).length
        };
    }
}

module.exports = { ThreadManager };
