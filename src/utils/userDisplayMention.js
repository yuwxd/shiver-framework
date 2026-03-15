async function formatUserDisplay(client, opts = {}) {
    const { userId, userFromContext } = opts;
    if (userFromContext && typeof userFromContext?.toString === 'function') {
        const u = userFromContext;
        return {
            display: u.toString(),
            username: u.username || u.globalName || 'Unknown',
            avatarUrl: u.displayAvatarURL?.({ size: 256 })
        };
    }
    const id = (userId || userFromContext?.id)?.toString?.();
    if (!id || !client?.users?.fetch) {
        return {
            display: `**@${opts.username || 'Unknown'}**`,
            username: opts.username || 'Unknown',
            avatarUrl: null
        };
    }
    try {
        const fetched = await client.users.fetch(id, { force: true });
        const username = fetched.username || fetched.globalName || opts.username || 'Unknown';
        return {
            display: `**@${username}**`,
            username,
            avatarUrl: fetched.displayAvatarURL?.({ size: 256 })
        };
    } catch {
        return {
            display: `**@${opts.username || 'Unknown'}**`,
            username: opts.username || 'Unknown',
            avatarUrl: null
        };
    }
}

module.exports = { formatUserDisplay };
