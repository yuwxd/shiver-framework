function ok(value) {
    return { ok: true, value, error: null };
}

function err(error, value = null) {
    return { ok: false, value, error };
}

const SNOWFLAKE_REGEX = /^\d{17,20}$/;
const URL_REGEX = /^https?:\/\/.+/i;
const COLOR_HEX_REGEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const INVITE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:\.gg|\.com\/invite)|discord\.gg)\/([a-zA-Z0-9-]+)/i;
const DURATION_REGEX = /^(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?|m|minutes?|h|hours?|d|days?|w|weeks?)$/i;
const MENTION_USER_REGEX = /^<@!?(\d{17,20})>$/;
const MENTION_CHANNEL_REGEX = /^<#(\d{17,20})>$/;
const MENTION_ROLE_REGEX = /^<@&(\d{17,20})>$/;
const MENTION_EMOJI_REGEX = /^<a?:([a-zA-Z0-9_]+):(\d{17,20})>$/;

const DURATION_MULTIPLIERS = {
    ms: 1, millisecond: 1, milliseconds: 1,
    s: 1000, second: 1000, seconds: 1000,
    m: 60000, minute: 60000, minutes: 60000,
    h: 3600000, hour: 3600000, hours: 3600000,
    d: 86400000, day: 86400000, days: 86400000,
    w: 604800000, week: 604800000, weeks: 604800000
};

function resolveString(value, opts = {}) {
    if (value === null || value === undefined || value === '') {
        if (opts.required !== false) return err('missing');
        return ok('');
    }
    const str = String(value);
    if (opts.minLength && str.length < opts.minLength) return err('too_short', str);
    if (opts.maxLength && str.length > opts.maxLength) return err('too_long', str.slice(0, opts.maxLength));
    if (opts.regex && !opts.regex.test(str)) return err('invalid_format', null);
    if (opts.choices && !opts.choices.includes(str)) return err('not_in_choices', null);
    return ok(str);
}

function resolveNumber(value, opts = {}) {
    if (value === null || value === undefined || value === '') return err('missing');
    const num = Number(value);
    if (isNaN(num)) return err('invalid_number');
    if (opts.min !== undefined && num < opts.min) return err('too_small');
    if (opts.max !== undefined && num > opts.max) return err('too_large');
    if (opts.integer && !Number.isInteger(num)) return err('not_integer');
    return ok(num);
}

function resolveInteger(value, opts = {}) {
    return resolveNumber(value, { ...opts, integer: true });
}

function resolveFloat(value, opts = {}) {
    return resolveNumber(value, opts);
}

function resolveBoolean(value) {
    if (value === true || value === 'true' || value === '1' || value === 'yes' || value === 'on') return ok(true);
    if (value === false || value === 'false' || value === '0' || value === 'no' || value === 'off') return ok(false);
    return err('invalid_boolean');
}

function resolveSnowflake(value) {
    if (!value) return err('missing');
    const str = String(value).trim();
    if (!SNOWFLAKE_REGEX.test(str)) return err('invalid_snowflake');
    return ok(str);
}

function resolveUrl(value, opts = {}) {
    if (!value) return err('missing');
    const str = String(value).trim();
    if (!URL_REGEX.test(str)) return err('invalid_url');
    try {
        const url = new URL(str);
        if (opts.allowedProtocols && !opts.allowedProtocols.includes(url.protocol.replace(':', ''))) {
            return err('disallowed_protocol');
        }
        if (opts.allowedHosts && !opts.allowedHosts.includes(url.hostname)) {
            return err('disallowed_host');
        }
        return ok(url.toString());
    } catch (_) {
        return err('invalid_url');
    }
}

function resolveHyperlink(value) {
    const mdLinkRegex = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/;
    const match = mdLinkRegex.exec(String(value ?? '').trim());
    if (!match) return resolveUrl(value);
    return ok({ label: match[1], url: match[2] });
}

function resolveColor(value) {
    if (!value) return err('missing');
    const str = String(value).trim();

    const named = {
        red: 0xFF0000, green: 0x00FF00, blue: 0x0000FF, yellow: 0xFFFF00,
        orange: 0xFFA500, purple: 0x800080, pink: 0xFFC0CB, cyan: 0x00FFFF,
        white: 0xFFFFFF, black: 0x000000, gray: 0x808080, grey: 0x808080,
        gold: 0xFFD700, silver: 0xC0C0C0, navy: 0x000080, teal: 0x008080,
        lime: 0x00FF00, maroon: 0x800000, olive: 0x808000, aqua: 0x00FFFF,
        blurple: 0x5865F2, fuchsia: 0xEB459E, greyple: 0x99AAB5,
        'dark-navy': 0x2C2F33, 'dark-but-not-black': 0x2C2F33,
        'not-quite-black': 0x23272A
    };

    if (named[str.toLowerCase()]) return ok(named[str.toLowerCase()]);

    if (COLOR_HEX_REGEX.test(str)) {
        const hex = str.replace('#', '');
        const expanded = hex.length === 3
            ? hex.split('').map(c => c + c).join('')
            : hex;
        return ok(parseInt(expanded, 16));
    }

    if (/^\d+$/.test(str)) {
        const num = parseInt(str, 10);
        if (num >= 0 && num <= 0xFFFFFF) return ok(num);
    }

    if (str.startsWith('0x') || str.startsWith('0X')) {
        const num = parseInt(str, 16);
        if (!isNaN(num) && num >= 0 && num <= 0xFFFFFF) return ok(num);
    }

    return err('invalid_color');
}

function resolveDuration(value, opts = {}) {
    if (!value) return err('missing');
    const str = String(value).trim();

    const match = DURATION_REGEX.exec(str);
    if (!match) return err('invalid_duration');

    const amount = parseFloat(match[1]);
    const unit = match[2].toLowerCase().replace(/s$/, '');
    const multiplier = DURATION_MULTIPLIERS[unit] ?? DURATION_MULTIPLIERS[match[2].toLowerCase()];

    if (!multiplier) return err('invalid_duration_unit');

    const ms = Math.round(amount * multiplier);
    if (opts.min !== undefined && ms < opts.min) return err('duration_too_short');
    if (opts.max !== undefined && ms > opts.max) return err('duration_too_long');

    return ok({ ms, seconds: ms / 1000, raw: str, amount, unit: match[2].toLowerCase() });
}

function resolveEnum(value, choices) {
    if (!value) return err('missing');
    const str = String(value).trim().toLowerCase();
    const match = choices.find(c => String(c).toLowerCase() === str || String(c) === value);
    if (match === undefined) return err('not_in_enum');
    return ok(match);
}

async function resolveUser(interactionOrMessage, value, opts = {}) {
    if (!value) return err('missing');
    const client = interactionOrMessage?.client ?? interactionOrMessage;
    const str = String(value).trim();

    const mentionMatch = MENTION_USER_REGEX.exec(str);
    const id = mentionMatch ? mentionMatch[1] : (SNOWFLAKE_REGEX.test(str) ? str : null);

    if (id) {
        const cached = client.users?.cache?.get(id);
        if (cached) return ok(cached);
        try {
            const fetched = await client.users.fetch(id);
            return ok(fetched);
        } catch (_) {
            return err('user_not_found');
        }
    }

    if (opts.allowUsername) {
        const byTag = client.users?.cache?.find(u =>
            u.username?.toLowerCase() === str.toLowerCase() ||
            u.tag?.toLowerCase() === str.toLowerCase()
        );
        if (byTag) return ok(byTag);
    }

    return err('invalid_user');
}

async function resolveMember(interactionOrMessage, value, opts = {}) {
    if (!value) return err('missing');
    const guild = interactionOrMessage?.guild;
    if (!guild) return err('no_guild');

    const str = String(value).trim();
    const mentionMatch = MENTION_USER_REGEX.exec(str);
    const id = mentionMatch ? mentionMatch[1] : (SNOWFLAKE_REGEX.test(str) ? str : null);

    if (id) {
        const cached = guild.members.cache.get(id);
        if (cached) return ok(cached);
        try {
            const fetched = await guild.members.fetch(id);
            return ok(fetched);
        } catch (_) {
            return err('member_not_found');
        }
    }

    const byName = guild.members.cache.find(m =>
        m.displayName?.toLowerCase() === str.toLowerCase() ||
        m.user?.username?.toLowerCase() === str.toLowerCase()
    );
    if (byName) return ok(byName);

    if (opts.fetchAll) {
        try {
            const members = await guild.members.fetch({ query: str, limit: 1 });
            const found = members.first();
            if (found) return ok(found);
        } catch (_) {}
    }

    return err('member_not_found');
}

async function resolveChannel(interactionOrMessage, value, opts = {}) {
    if (!value) return err('missing');
    const guild = interactionOrMessage?.guild;
    const client = interactionOrMessage?.client ?? interactionOrMessage;
    const str = String(value).trim();

    const mentionMatch = MENTION_CHANNEL_REGEX.exec(str);
    const id = mentionMatch ? mentionMatch[1] : (SNOWFLAKE_REGEX.test(str) ? str : null);

    if (id) {
        const guildChannel = guild?.channels?.cache?.get(id);
        if (guildChannel) {
            if (opts.types && !opts.types.includes(guildChannel.type)) return err('wrong_channel_type');
            return ok(guildChannel);
        }
        try {
            const fetched = await client.channels.fetch(id);
            if (fetched) {
                if (opts.types && !opts.types.includes(fetched.type)) return err('wrong_channel_type');
                return ok(fetched);
            }
        } catch (_) {}
        return err('channel_not_found');
    }

    if (guild) {
        const byName = guild.channels.cache.find(c =>
            c.name?.toLowerCase() === str.toLowerCase().replace(/^#/, '')
        );
        if (byName) {
            if (opts.types && !opts.types.includes(byName.type)) return err('wrong_channel_type');
            return ok(byName);
        }
    }

    return err('channel_not_found');
}

async function resolveRole(interactionOrMessage, value, opts = {}) {
    if (!value) return err('missing');
    const guild = interactionOrMessage?.guild;
    if (!guild) return err('no_guild');

    const str = String(value).trim();
    const mentionMatch = MENTION_ROLE_REGEX.exec(str);
    const id = mentionMatch ? mentionMatch[1] : (SNOWFLAKE_REGEX.test(str) ? str : null);

    if (id) {
        const cached = guild.roles.cache.get(id);
        if (cached) return ok(cached);
        try {
            const fetched = await guild.roles.fetch(id);
            if (fetched) return ok(fetched);
        } catch (_) {}
        return err('role_not_found');
    }

    const byName = guild.roles.cache.find(r => r.name?.toLowerCase() === str.toLowerCase());
    if (byName) return ok(byName);

    return err('role_not_found');
}

async function resolveMessage(interactionOrMessage, value, opts = {}) {
    if (!value) return err('missing');
    const str = String(value).trim();
    const channel = opts.channel ?? interactionOrMessage?.channel;
    const client = interactionOrMessage?.client ?? interactionOrMessage;

    const urlMatch = /channels\/(\d+)\/(\d+)\/(\d+)/.exec(str);
    if (urlMatch) {
        try {
            const ch = await client.channels.fetch(urlMatch[2]);
            if (ch?.messages) {
                const msg = await ch.messages.fetch(urlMatch[3]);
                return ok(msg);
            }
        } catch (_) {}
        return err('message_not_found');
    }

    if (SNOWFLAKE_REGEX.test(str) && channel?.messages) {
        try {
            const msg = await channel.messages.fetch(str);
            return ok(msg);
        } catch (_) {}
        return err('message_not_found');
    }

    return err('invalid_message_id');
}

async function resolveGuild(interactionOrMessage, value) {
    if (!value) return err('missing');
    const client = interactionOrMessage?.client ?? interactionOrMessage;
    const str = String(value).trim();

    if (SNOWFLAKE_REGEX.test(str)) {
        const cached = client.guilds?.cache?.get(str);
        if (cached) return ok(cached);
        try {
            const fetched = await client.guilds.fetch(str);
            return ok(fetched);
        } catch (_) {}
        return err('guild_not_found');
    }

    const byName = client.guilds?.cache?.find(g => g.name?.toLowerCase() === str.toLowerCase());
    if (byName) return ok(byName);

    return err('guild_not_found');
}

function resolveEmoji(value, guild) {
    if (!value) return err('missing');
    const str = String(value).trim();

    const customMatch = MENTION_EMOJI_REGEX.exec(str);
    if (customMatch) {
        const animated = str.startsWith('<a:');
        const name = customMatch[1];
        const id = customMatch[2];
        if (guild) {
            const guildEmoji = guild.emojis?.cache?.get(id);
            if (guildEmoji) return ok(guildEmoji);
        }
        return ok({ id, name, animated, toString: () => str });
    }

    const unicodeRegex = /\p{Emoji}/u;
    if (unicodeRegex.test(str)) {
        return ok({ id: null, name: str, animated: false, unicode: true, toString: () => str });
    }

    if (guild) {
        const byName = guild.emojis?.cache?.find(e => e.name?.toLowerCase() === str.toLowerCase());
        if (byName) return ok(byName);
    }

    return err('invalid_emoji');
}

function resolveInvite(value) {
    if (!value) return err('missing');
    const str = String(value).trim();
    const match = INVITE_REGEX.exec(str);
    if (!match) return err('invalid_invite');
    return ok({ code: match[1], url: `https://discord.gg/${match[1]}` });
}

function resolveDate(value, opts = {}) {
    if (!value) return err('missing');
    const str = String(value).trim();

    const relativeMatch = DURATION_REGEX.exec(str);
    if (relativeMatch) {
        const durationResult = resolveDuration(str);
        if (durationResult.ok) {
            const date = new Date(Date.now() + durationResult.value.ms);
            return ok(date);
        }
    }

    const date = new Date(str);
    if (isNaN(date.getTime())) {
        const timestamp = parseInt(str, 10);
        if (!isNaN(timestamp)) {
            const fromTimestamp = new Date(timestamp > 1e10 ? timestamp : timestamp * 1000);
            if (!isNaN(fromTimestamp.getTime())) return ok(fromTimestamp);
        }
        return err('invalid_date');
    }

    if (opts.min && date < opts.min) return err('date_too_early');
    if (opts.max && date > opts.max) return err('date_too_late');
    if (opts.future && date <= new Date()) return err('date_must_be_future');
    if (opts.past && date >= new Date()) return err('date_must_be_past');

    return ok(date);
}

module.exports = {
    ok, err,
    resolveString, resolveNumber, resolveInteger, resolveFloat,
    resolveBoolean, resolveSnowflake, resolveUrl, resolveHyperlink,
    resolveColor, resolveDuration, resolveEnum,
    resolveUser, resolveMember, resolveChannel, resolveRole,
    resolveMessage, resolveGuild, resolveEmoji, resolveInvite, resolveDate
};
