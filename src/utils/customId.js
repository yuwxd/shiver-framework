const { LIMITS } = require('../config/LIMITS');

function buildCustomId(prefix, command, action, userId, separator = ':') {
    const parts = [prefix, command, action].filter(Boolean);
    if (userId) parts.push(userId);
    const result = parts.join(separator);
    if (result.length > LIMITS.customId) {
        return result.slice(0, LIMITS.customId);
    }
    return result;
}

function parseCustomId(customId, separator = ':') {
    if (!customId || typeof customId !== 'string') return null;
    const parts = customId.split(separator);
    if (parts.length < 2) return null;
    return {
        prefix: parts[0] ?? null,
        command: parts[1] ?? null,
        action: parts[2] ?? null,
        userId: parts[3] ?? null,
        raw: customId
    };
}

module.exports = { buildCustomId, parseCustomId };
