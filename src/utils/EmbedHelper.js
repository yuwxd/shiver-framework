const { EmbedBuilder, MessageFlags } = require('discord.js');

const DEFAULT_COLORS = {
    default: 0xC0C0C0,
    success: 0x57F287,
    error: 0xED4245,
    warning: 0xFEE75C,
    info: 0x5865F2,
    premium: 0xFFD700,
    blurple: 0x5865F2,
    fuchsia: 0xEB459E,
    white: 0xFFFFFF,
    black: 0x000000
};

class EmbedHelper {
    constructor(storage = null) {
        this._storage = storage;
        this._cache = new Map();
        this._cacheTtl = 30000;
    }

    setStorage(storage) {
        this._storage = storage;
        return this;
    }

    async getCommandEmbedColor(userId, commandName = null) {
        if (!this._storage) return DEFAULT_COLORS.default;

        const cacheKey = `${userId}:${commandName ?? 'default'}`;
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) return cached.color;

        try {
            const commandColor = commandName
                ? await this._storage.get('embed_colors', `${userId}:cmd:${commandName}`)
                : null;
            const userColor = await this._storage.get('embed_colors', `${userId}:default`);
            const color = commandColor ?? userColor ?? DEFAULT_COLORS.default;
            this._cache.set(cacheKey, { color, expiry: Date.now() + this._cacheTtl });
            return color;
        } catch (_) {
            return DEFAULT_COLORS.default;
        }
    }

    async setCommandEmbedColor(userId, color, commandName = null) {
        if (!this._storage) return;
        const key = commandName ? `${userId}:cmd:${commandName}` : `${userId}:default`;
        await this._storage.set('embed_colors', key, color);
        this._cache.delete(`${userId}:${commandName ?? 'default'}`);
    }

    async resetColors(userId) {
        if (!this._storage) return;
        const keys = await this._storage.keys('embed_colors');
        const userKeys = keys.filter(k => k.startsWith(`${userId}:`));
        await Promise.all(userKeys.map(k => this._storage.delete('embed_colors', k)));
        for (const [key] of this._cache) {
            if (key.startsWith(`${userId}:`)) this._cache.delete(key);
        }
    }

    shouldBeEphemeral(commandName, opts = {}) {
        if (opts.ephemeral !== undefined) return opts.ephemeral;
        const ephemeralCommands = opts.ephemeralCommands ?? [];
        if (ephemeralCommands.includes(commandName)) return true;
        return false;
    }

    buildEmbed(opts = {}) {
        const embed = new EmbedBuilder();
        if (opts.color !== undefined) embed.setColor(opts.color);
        if (opts.title) embed.setTitle(opts.title);
        if (opts.description) embed.setDescription(opts.description);
        if (opts.url) embed.setURL(opts.url);
        if (opts.author) embed.setAuthor(opts.author);
        if (opts.thumbnail) embed.setThumbnail(opts.thumbnail);
        if (opts.image) embed.setImage(opts.image);
        if (opts.footer) embed.setFooter(opts.footer);
        if (opts.timestamp !== false) embed.setTimestamp(opts.timestamp ?? null);
        if (opts.fields && opts.fields.length > 0) embed.addFields(...opts.fields);
        return embed;
    }

    buildSuccessEmbed(description, opts = {}) {
        return this.buildEmbed({
            color: opts.color ?? DEFAULT_COLORS.success,
            description,
            ...opts
        });
    }

    buildErrorEmbed(description, opts = {}) {
        return this.buildEmbed({
            color: opts.color ?? DEFAULT_COLORS.error,
            description,
            ...opts
        });
    }

    buildWarningEmbed(description, opts = {}) {
        return this.buildEmbed({
            color: opts.color ?? DEFAULT_COLORS.warning,
            description,
            ...opts
        });
    }

    buildInfoEmbed(description, opts = {}) {
        return this.buildEmbed({
            color: opts.color ?? DEFAULT_COLORS.info,
            description,
            ...opts
        });
    }

    buildPaginatedEmbed(opts = {}) {
        const { title, description, fields, currentPage, totalPages, color } = opts;
        const embed = this.buildEmbed({
            color: color ?? DEFAULT_COLORS.default,
            title,
            description,
            footer: { text: `Page ${currentPage} of ${totalPages}` }
        });
        if (fields && fields.length > 0) embed.addFields(...fields);
        return embed;
    }

    colorFromHex(hex) {
        const clean = hex.replace('#', '');
        return parseInt(clean.length === 3
            ? clean.split('').map(c => c + c).join('')
            : clean, 16);
    }

    colorToHex(color) {
        return `#${color.toString(16).padStart(6, '0')}`;
    }

    getDefaultColors() {
        return { ...DEFAULT_COLORS };
    }

    invalidateCache(userId) {
        for (const key of [...this._cache.keys()]) {
            if (key.startsWith(`${userId}:`)) this._cache.delete(key);
        }
    }
}

module.exports = { EmbedHelper, DEFAULT_COLORS };
