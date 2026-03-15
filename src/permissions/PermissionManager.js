const PERMISSION_LEVELS = {
    RESTRICTED: 0,
    MEMBER: 1,
    TRUSTED: 2,
    MODERATOR: 3,
    ADMIN: 4,
    OWNER: 5,
    BOT_OWNER: 6
};

const LEVEL_NAMES = Object.fromEntries(Object.entries(PERMISSION_LEVELS).map(([k, v]) => [v, k]));

class PermissionManager {
    constructor(opts = {}) {
        this._ownerIds = new Set(Array.isArray(opts.ownerIds) ? opts.ownerIds : (opts.ownerId ? [opts.ownerId] : []));
        this._storage = opts.storage ?? null;
        this._storageNamespace = opts.storageNamespace ?? 'permissions';
        this._defaultLevel = opts.defaultLevel ?? PERMISSION_LEVELS.MEMBER;
        this._guildConfigs = new Map();
        this._commandOverrides = new Map();
        this._cache = new Map();
        this._cacheTtl = opts.cacheTtl ?? 30000;
    }

    setOwners(ownerIds) {
        this._ownerIds = new Set(Array.isArray(ownerIds) ? ownerIds : [ownerIds]);
        return this;
    }

    isOwner(userId) {
        return this._ownerIds.has(userId);
    }

    async getLevel(userId, guildId) {
        if (this._ownerIds.has(userId)) return PERMISSION_LEVELS.BOT_OWNER;

        const cacheKey = `${guildId}:${userId}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < this._cacheTtl) return cached.level;

        const config = await this._getGuildConfig(guildId);
        if (!config) return this._defaultLevel;

        if (config.owners?.includes(userId)) {
            this._setCache(cacheKey, PERMISSION_LEVELS.OWNER);
            return PERMISSION_LEVELS.OWNER;
        }

        for (const [level, data] of Object.entries(config.levels ?? {})) {
            const numLevel = Number(level);
            if (data.users?.includes(userId)) {
                this._setCache(cacheKey, numLevel);
                return numLevel;
            }
        }

        return this._defaultLevel;
    }

    async getLevelByMember(member, guildId) {
        const userId = member?.user?.id ?? member?.id;
        if (!userId) return this._defaultLevel;

        if (this._ownerIds.has(userId)) return PERMISSION_LEVELS.BOT_OWNER;
        if (guildId && member?.guild?.ownerId === userId) return PERMISSION_LEVELS.OWNER;

        const config = await this._getGuildConfig(guildId);
        if (!config) return this._defaultLevel;

        let highest = this._defaultLevel;

        for (const [level, data] of Object.entries(config.levels ?? {})) {
            const numLevel = Number(level);
            if (numLevel <= highest) continue;

            if (data.users?.includes(userId)) { highest = numLevel; continue; }

            if (data.roles && member?.roles?.cache) {
                for (const roleId of data.roles) {
                    if (member.roles.cache.has(roleId)) { highest = numLevel; break; }
                }
            }

            if (data.permissions && member?.permissions) {
                for (const perm of data.permissions) {
                    if (member.permissions.has(perm)) { highest = numLevel; break; }
                }
            }
        }

        return highest;
    }

    async canRun(userId, commandName, context = {}) {
        const { guildId, member, channelId } = context;

        if (this._ownerIds.has(userId)) return { allowed: true, level: PERMISSION_LEVELS.BOT_OWNER, reason: null };

        const userLevel = member
            ? await this.getLevelByMember(member, guildId)
            : await this.getLevel(userId, guildId);

        const override = await this._getCommandOverride(commandName, guildId);
        const required = override?.requiredLevel ?? this._getDefaultCommandLevel(commandName);

        if (userLevel < required) {
            return {
                allowed: false,
                level: userLevel,
                required,
                reason: `Requires level ${required} (${LEVEL_NAMES[required] ?? required}), you have ${userLevel} (${LEVEL_NAMES[userLevel] ?? userLevel})`,
                explanation: this._buildExplanation('missing_level', {
                    commandName,
                    requiredLevel: required,
                    currentLevel: userLevel
                })
            };
        }

        if (override?.allowedUsers && !override.allowedUsers.includes(userId)) {
            return {
                allowed: false,
                level: userLevel,
                reason: 'Not in allowed users list',
                explanation: this._buildExplanation('allowed_users', { commandName, userId })
            };
        }

        if (override?.blockedUsers && override.blockedUsers.includes(userId)) {
            return {
                allowed: false,
                level: userLevel,
                reason: 'Blocked from this command',
                explanation: this._buildExplanation('blocked_user', { commandName, userId })
            };
        }

        if (override?.allowedChannels && channelId && !override.allowedChannels.includes(channelId)) {
            return {
                allowed: false,
                level: userLevel,
                reason: 'Command not allowed in this channel',
                explanation: this._buildExplanation('allowed_channels', { commandName, channelId })
            };
        }

        if (override?.blockedChannels && channelId && override.blockedChannels.includes(channelId)) {
            return {
                allowed: false,
                level: userLevel,
                reason: 'Command blocked in this channel',
                explanation: this._buildExplanation('blocked_channel', { commandName, channelId })
            };
        }

        if (override?.allowedRoles && member?.roles?.cache) {
            const hasRole = override.allowedRoles.some(r => member.roles.cache.has(r));
            if (!hasRole) {
                return {
                    allowed: false,
                    level: userLevel,
                    reason: 'Missing required role',
                    explanation: this._buildExplanation('missing_role', { commandName, allowedRoles: override.allowedRoles })
                };
            }
        }

        return { allowed: true, level: userLevel, reason: null, explanation: null };
    }

    _getDefaultCommandLevel(commandName) {
        const overrides = this._commandOverrides.get(commandName);
        return overrides?.defaultLevel ?? PERMISSION_LEVELS.MEMBER;
    }

    async setCommandRequiredLevel(commandName, level, guildId = null) {
        const key = guildId ? `${guildId}:${commandName}` : commandName;
        const existing = this._commandOverrides.get(key) ?? {};
        existing.requiredLevel = level;
        this._commandOverrides.set(key, existing);

        if (this._storage && guildId) {
            const config = await this._getGuildConfig(guildId) ?? {};
            config.commandOverrides = config.commandOverrides ?? {};
            config.commandOverrides[commandName] = { ...config.commandOverrides[commandName], requiredLevel: level };
            await this._saveGuildConfig(guildId, config);
        }
    }

    async setUserLevel(userId, level, guildId) {
        const config = await this._getGuildConfig(guildId) ?? {};
        config.levels = config.levels ?? {};
        config.levels[level] = config.levels[level] ?? {};
        config.levels[level].users = config.levels[level].users ?? [];
        if (!config.levels[level].users.includes(userId)) config.levels[level].users.push(userId);

        for (const [lvl, data] of Object.entries(config.levels)) {
            if (Number(lvl) !== level && data.users) {
                data.users = data.users.filter(id => id !== userId);
            }
        }

        await this._saveGuildConfig(guildId, config);
        this._cache.delete(`${guildId}:${userId}`);
    }

    async setRoleLevel(roleId, level, guildId) {
        const config = await this._getGuildConfig(guildId) ?? {};
        config.levels = config.levels ?? {};
        config.levels[level] = config.levels[level] ?? {};
        config.levels[level].roles = config.levels[level].roles ?? [];
        if (!config.levels[level].roles.includes(roleId)) config.levels[level].roles.push(roleId);
        await this._saveGuildConfig(guildId, config);
        this._clearGuildCache(guildId);
    }

    async _getGuildConfig(guildId) {
        if (!guildId) return null;
        if (this._guildConfigs.has(guildId)) return this._guildConfigs.get(guildId);
        if (this._storage) {
            const config = await this._storage.get(this._storageNamespace, guildId).catch(() => null);
            if (config) this._guildConfigs.set(guildId, config);
            return config;
        }
        return null;
    }

    async _getCommandOverride(commandName, guildId) {
        if (guildId) {
            const config = await this._getGuildConfig(guildId);
            if (config?.commandOverrides?.[commandName]) return config.commandOverrides[commandName];
        }
        return this._commandOverrides.get(commandName) ?? null;
    }

    async _saveGuildConfig(guildId, config) {
        this._guildConfigs.set(guildId, config);
        if (this._storage) {
            await this._storage.set(this._storageNamespace, guildId, config).catch(() => {});
        }
    }

    _setCache(key, level) {
        this._cache.set(key, { level, ts: Date.now() });
    }

    _clearGuildCache(guildId) {
        for (const key of this._cache.keys()) {
            if (key.startsWith(`${guildId}:`)) this._cache.delete(key);
        }
        this._guildConfigs.delete(guildId);
    }

    getLevelName(level) {
        return LEVEL_NAMES[level] ?? `LEVEL_${level}`;
    }

    getLevelValue(name) {
        return PERMISSION_LEVELS[name.toUpperCase()] ?? null;
    }

    async detectConflicts(userId, guildId, context = {}) {
        const config = await this._getGuildConfig(guildId);
        const conflicts = [];

        for (const [commandName, override] of Object.entries(config?.commandOverrides ?? {})) {
            if (override.allowedUsers?.includes(userId) && override.blockedUsers?.includes(userId)) {
                conflicts.push({
                    type: 'user_override_conflict',
                    commandName,
                    userId,
                    message: `User ${userId} is both allowed and blocked for ${commandName}`
                });
            }

            for (const roleId of override.allowedRoles ?? []) {
                if (override.blockedRoles?.includes(roleId)) {
                    conflicts.push({
                        type: 'role_override_conflict',
                        commandName,
                        roleId,
                        message: `Role ${roleId} is both allowed and blocked for ${commandName}`
                    });
                }
            }

            for (const channelId of override.allowedChannels ?? []) {
                if (override.blockedChannels?.includes(channelId)) {
                    conflicts.push({
                        type: 'channel_override_conflict',
                        commandName,
                        channelId,
                        message: `Channel ${channelId} is both allowed and blocked for ${commandName}`
                    });
                }
            }
        }

        if (context.member?.roles?.cache) {
            const levelRoles = new Map();
            for (const [level, data] of Object.entries(config?.levels ?? {})) {
                for (const roleId of data.roles ?? []) {
                    const previous = levelRoles.get(roleId);
                    if (previous !== undefined && previous !== Number(level)) {
                        conflicts.push({
                            type: 'level_role_conflict',
                            roleId,
                            levels: [previous, Number(level)],
                            message: `Role ${roleId} is assigned to multiple permission levels`
                        });
                    }
                    levelRoles.set(roleId, Number(level));
                }
            }
        }

        return conflicts;
    }

    async explain(userId, commandName, context = {}) {
        const result = await this.canRun(userId, commandName, context);
        const conflicts = await this.detectConflicts(userId, context.guildId, context);
        return {
            allowed: result.allowed,
            reason: result.reason,
            explanation: result.explanation ?? (result.allowed ? 'Command can run.' : 'Command cannot run.'),
            conflicts
        };
    }

    _buildExplanation(type, data = {}) {
        if (type === 'missing_level') {
            return `Missing permission level for ${data.commandName}. Fix: raise the user to ${this.getLevelName(data.requiredLevel)} or lower the command requirement.`;
        }
        if (type === 'allowed_users') {
            return `Command ${data.commandName} is limited to an explicit allow-list. Fix: add user ${data.userId} to allowedUsers.`;
        }
        if (type === 'blocked_user') {
            return `Command ${data.commandName} is explicitly blocked for this user. Fix: remove the user from blockedUsers.`;
        }
        if (type === 'allowed_channels') {
            return `Command ${data.commandName} is not enabled in channel ${data.channelId}. Fix: add the channel to allowedChannels or remove the restriction.`;
        }
        if (type === 'blocked_channel') {
            return `Command ${data.commandName} is blocked in channel ${data.channelId}. Fix: remove the channel from blockedChannels.`;
        }
        if (type === 'missing_role') {
            return `Command ${data.commandName} requires one of these roles: ${data.allowedRoles.join(', ')}. Fix: assign an allowed role to the user.`;
        }
        return 'Permission denied.';
    }
}

module.exports = { PermissionManager, PERMISSION_LEVELS, LEVEL_NAMES };
