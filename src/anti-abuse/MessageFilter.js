const { EventEmitter } = require('events');

class MessageFilter extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._rules = [];
        this._ignoreBots = opts.ignoreBots ?? true;
        this._ignoredUsers = new Set(opts.ignoredUsers ?? []);
        this._ignoredRoles = new Set(opts.ignoredRoles ?? []);
        this._ignoredChannels = new Set(opts.ignoredChannels ?? []);
        this._deleteOnMatch = opts.deleteOnMatch ?? true;
        this._warnOnMatch = opts.warnOnMatch ?? false;
        this._logMatches = opts.logMatches ?? false;
        this._moderationAPI = opts.moderationAPI ?? null;

        if (opts.blockedWords) this.addWordFilter(opts.blockedWords);
        if (opts.blockedPatterns) {
            for (const pattern of opts.blockedPatterns) {
                this.addRegexFilter(pattern);
            }
        }
        if (opts.blockInvites) this.addInviteFilter();
        if (opts.blockLinks) this.addLinkFilter(opts.allowedDomains);
        if (opts.blockMassMentions) this.addMassMentionFilter(opts.maxMentions);
        if (opts.blockCaps) this.addCapsFilter(opts.capsThreshold);
        if (opts.blockDuplicates) this.addDuplicateFilter(opts.duplicateThreshold);
    }

    setModerationAPI(api) {
        this._moderationAPI = api;
        return this;
    }

    addRule(rule) {
        this._rules.push(rule);
        return this;
    }

    addWordFilter(words, opts = {}) {
        const wordSet = new Set(words.map(w => w.toLowerCase()));
        return this.addRule({
            name: opts.name ?? 'word_filter',
            test: (content) => {
                const lower = content.toLowerCase();
                const tokens = lower.split(/\s+/);
                for (const token of tokens) {
                    const clean = token.replace(/[^a-z0-9]/g, '');
                    if (wordSet.has(clean) || wordSet.has(token)) return true;
                }
                return false;
            },
            action: opts.action ?? 'delete',
            reason: opts.reason ?? 'Blocked word detected'
        });
    }

    addRegexFilter(pattern, opts = {}) {
        const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'gi');
        return this.addRule({
            name: opts.name ?? 'regex_filter',
            test: (content) => regex.test(content),
            action: opts.action ?? 'delete',
            reason: opts.reason ?? 'Content matches blocked pattern'
        });
    }

    addInviteFilter(opts = {}) {
        const inviteRegex = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:\.gg|\.com\/invite)|discord\.gg)\/[a-zA-Z0-9-]+/i;
        const allowedCodes = new Set(opts.allowedCodes ?? []);
        return this.addRule({
            name: 'invite_filter',
            test: (content) => {
                if (!inviteRegex.test(content)) return false;
                if (allowedCodes.size === 0) return true;
                const matches = content.match(/discord(?:\.gg|\.com\/invite)\/([a-zA-Z0-9-]+)/gi) ?? [];
                return matches.some(m => {
                    const code = m.split('/').pop();
                    return !allowedCodes.has(code);
                });
            },
            action: opts.action ?? 'delete',
            reason: opts.reason ?? 'Discord invite detected'
        });
    }

    addLinkFilter(allowedDomains = [], opts = {}) {
        const urlRegex = /https?:\/\/[^\s]+/gi;
        const allowed = new Set(allowedDomains.map(d => d.toLowerCase()));
        return this.addRule({
            name: 'link_filter',
            test: (content) => {
                const urls = content.match(urlRegex) ?? [];
                return urls.some(url => {
                    try {
                        const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
                        return allowed.size > 0 ? !allowed.has(domain) : true;
                    } catch (_) {
                        return false;
                    }
                });
            },
            action: opts.action ?? 'delete',
            reason: opts.reason ?? 'Unauthorized link detected'
        });
    }

    addMassMentionFilter(maxMentions = 5, opts = {}) {
        return this.addRule({
            name: 'mass_mention_filter',
            test: (content, message) => {
                const userMentions = (message?.mentions?.users?.size ?? 0);
                const roleMentions = (message?.mentions?.roles?.size ?? 0);
                return (userMentions + roleMentions) > maxMentions;
            },
            action: opts.action ?? 'delete',
            reason: opts.reason ?? 'Mass mention detected'
        });
    }

    addCapsFilter(threshold = 0.7, opts = {}) {
        return this.addRule({
            name: 'caps_filter',
            test: (content) => {
                const letters = content.replace(/[^a-zA-Z]/g, '');
                if (letters.length < 10) return false;
                const caps = letters.replace(/[^A-Z]/g, '');
                return caps.length / letters.length > threshold;
            },
            action: opts.action ?? 'delete',
            reason: opts.reason ?? 'Excessive caps detected'
        });
    }

    addDuplicateFilter(threshold = 3, opts = {}) {
        const recentMessages = new Map();
        return this.addRule({
            name: 'duplicate_filter',
            test: (content, message) => {
                if (!message) return false;
                const key = `${message.guild?.id}:${message.author.id}`;
                const normalized = content.toLowerCase().trim();
                const bucket = recentMessages.get(key) ?? [];
                const count = bucket.filter(m => m === normalized).length;
                bucket.push(normalized);
                if (bucket.length > 10) bucket.shift();
                recentMessages.set(key, bucket);
                return count >= threshold - 1;
            },
            action: opts.action ?? 'delete',
            reason: opts.reason ?? 'Duplicate message detected'
        });
    }

    addZalgoFilter(opts = {}) {
        const zalgoRegex = /[\u0300-\u036f\u0489\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]{3,}/;
        return this.addRule({
            name: 'zalgo_filter',
            test: (content) => zalgoRegex.test(content),
            action: opts.action ?? 'delete',
            reason: opts.reason ?? 'Zalgo text detected'
        });
    }

    addEmojiSpamFilter(maxEmojis = 10, opts = {}) {
        const emojiRegex = /\p{Emoji}/gu;
        return this.addRule({
            name: 'emoji_spam_filter',
            test: (content) => {
                const matches = content.match(emojiRegex) ?? [];
                return matches.length > maxEmojis;
            },
            action: opts.action ?? 'delete',
            reason: opts.reason ?? 'Emoji spam detected'
        });
    }

    _isIgnored(message) {
        if (this._ignoreBots && message.author?.bot) return true;
        if (this._ignoredUsers.has(message.author?.id)) return true;
        if (this._ignoredChannels.has(message.channel?.id)) return true;
        if (message.member) {
            for (const roleId of this._ignoredRoles) {
                if (message.member.roles.cache.has(roleId)) return true;
            }
        }
        return false;
    }

    async check(message) {
        if (this._isIgnored(message)) return { filtered: false };

        const content = message.content ?? '';
        for (const rule of this._rules) {
            let matched = false;
            try {
                matched = await rule.test(content, message);
            } catch (_) {}

            if (matched) {
                this.emit('match', message, rule);

                if (rule.action === 'delete' || this._deleteOnMatch) {
                    try {
                        if (message.deletable) await message.delete();
                    } catch (_) {}
                }

                if (rule.action === 'warn' || this._warnOnMatch) {
                    if (this._moderationAPI && message.guild) {
                        await this._moderationAPI.warn(message.guild, message.author.id, {
                            reason: rule.reason,
                            moderatorId: message.client.user?.id
                        }).catch(() => {});
                    }
                }

                if (rule.action === 'kick' && this._moderationAPI && message.guild) {
                    await this._moderationAPI.kick(message.guild, message.author.id, {
                        reason: rule.reason,
                        moderatorId: message.client.user?.id
                    }).catch(() => {});
                }

                if (rule.action === 'ban' && this._moderationAPI && message.guild) {
                    await this._moderationAPI.ban(message.guild, message.author.id, {
                        reason: rule.reason,
                        moderatorId: message.client.user?.id
                    }).catch(() => {});
                }

                return { filtered: true, rule: rule.name, reason: rule.reason };
            }
        }

        return { filtered: false };
    }

    removeRule(name) {
        this._rules = this._rules.filter(r => r.name !== name);
        return this;
    }

    getRules() {
        return this._rules.map(r => ({ name: r.name, action: r.action, reason: r.reason }));
    }
}

module.exports = { MessageFilter };
