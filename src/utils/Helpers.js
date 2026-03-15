const { MessageFlags } = require('discord.js');
const { buildMessageContainerV2, textDisplay, separator } = require('../components/v2/builders');
const { randomUUID } = require('crypto');
const { safeError } = require('../security/redact');

const GENERIC_ERROR_MESSAGE = 'This command is currently unavailable. Please try again later.';
const GENERIC_WARNING_COLOR = 0xFEE75C;
const GENERIC_ERROR_COLOR = 0xED4245;
const GENERIC_SUCCESS_COLOR = 0x57F287;
const GENERIC_INFO_COLOR = 0x5865F2;

function generateTraceId() {
    return randomUUID().split('-')[0].toUpperCase();
}

function createGenericErrorPayload(userId, opts = {}) {
    const traceId = opts.traceId ?? generateTraceId();
    const message = opts.message ?? GENERIC_ERROR_MESSAGE;
    const content = [
        textDisplay(`> **▸ Error**\n> ${message}`),
        separator(),
        textDisplay(`> Trace ID: \`${traceId}\``)
    ];
    return {
        ...buildMessageContainerV2(opts.color ?? GENERIC_ERROR_COLOR, content),
        flags: (opts.ephemeral !== false ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
    };
}

function createWarningPayload(message, opts = {}) {
    const content = [textDisplay(`> **▸ Warning**\n> ${message}`)];
    if (opts.hint) {
        content.push(separator());
        content.push(textDisplay(`> ${opts.hint}`));
    }
    return {
        ...buildMessageContainerV2(opts.color ?? GENERIC_WARNING_COLOR, content),
        flags: (opts.ephemeral !== false ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
    };
}

function createSuccessPayload(message, opts = {}) {
    const content = [textDisplay(`> **▸ Success**\n> ${message}`)];
    if (opts.detail) {
        content.push(separator());
        content.push(textDisplay(`> ${opts.detail}`));
    }
    return {
        ...buildMessageContainerV2(opts.color ?? GENERIC_SUCCESS_COLOR, content),
        flags: (opts.ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
    };
}

function createInfoPayload(message, opts = {}) {
    const content = [textDisplay(`> **▸ Info**\n> ${message}`)];
    if (opts.detail) {
        content.push(separator());
        content.push(textDisplay(`> ${opts.detail}`));
    }
    return {
        ...buildMessageContainerV2(opts.color ?? GENERIC_INFO_COLOR, content),
        flags: (opts.ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
    };
}

function createLoadingPayload(message = 'Processing...', opts = {}) {
    return {
        ...buildMessageContainerV2(opts.color ?? 0x808080, [textDisplay(`> ${message}`)]),
        flags: (opts.ephemeral ? MessageFlags.Ephemeral : 0) | MessageFlags.IsComponentsV2
    };
}

function createNotFoundPayload(entity = 'Resource', opts = {}) {
    return createWarningPayload(`${entity} not found.`, opts);
}

function createNoPermissionPayload(opts = {}) {
    return createWarningPayload('You do not have permission to use this command.', opts);
}

function createCooldownPayload(remaining, opts = {}) {
    const seconds = (remaining / 1000).toFixed(1);
    return createWarningPayload(`You are on cooldown. Please wait **${seconds}s**.`, opts);
}

function createPremiumRequiredPayload(opts = {}) {
    return createWarningPayload('This command requires a premium subscription.', {
        ...opts,
        ephemeral: opts.ephemeral !== false
    });
}

function createDisabledPayload(opts = {}) {
    return createWarningPayload('This command is currently disabled.', opts);
}

function createBlacklistedPayload(opts = {}) {
    return createWarningPayload('You are not allowed to use this bot.', {
        ...opts,
        ephemeral: opts.ephemeral !== false
    });
}

async function safeReply(interaction, payload, opts = {}) {
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.editReply(payload);
        }
        return await interaction.reply(payload);
    } catch (e) {
        safeError('Helpers.safeReply', e);
        return null;
    }
}

async function safeFollowUp(interaction, payload) {
    try {
        return await interaction.followUp(payload);
    } catch (e) {
        safeError('Helpers.safeFollowUp', e);
        return null;
    }
}

async function safeDefer(interaction, opts = {}) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: opts.ephemeral ?? false });
        }
    } catch (e) {
        safeError('Helpers.safeDefer', e);
    }
}

async function safeDeferUpdate(interaction) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }
    } catch (e) {
        safeError('Helpers.safeDeferUpdate', e);
    }
}

const BENIGN_DELETE_CODES = new Set([10008, 10003, 50001]);
const BENIGN_EDIT_CODES = new Set([10008, 10003, 50005, 50001, 50021]);

function isBenignError(e, codeSet) {
    if (!e) return false;
    const code = e.code ?? e.status ?? e.statusCode;
    if (code != null && codeSet.has(Number(code))) return true;
    const msg = String(e.message ?? e.body ?? '').toLowerCase();
    return msg.includes('unknown message') || msg.includes('unknown channel') || msg.includes('missing access') || msg.includes('cannot edit') || msg.includes('not sent by this');
}

async function safeDelete(message, opts = {}) {
    if (!message) return false;
    if (message.deletable === false) return false;
    try {
        await message.delete(opts.reason ? { reason: opts.reason } : undefined);
        return true;
    } catch (e) {
        if (isBenignError(e, BENIGN_DELETE_CODES)) return false;
        safeError('Helpers.safeDelete', e);
        return false;
    }
}

async function safeEdit(message, payload, opts = {}) {
    if (!message || payload == null) return null;
    if (typeof message.edit !== 'function') return null;
    const maxRetries = opts.retryOnce === true ? 1 : 0;
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await message.edit(payload);
        } catch (e) {
            lastErr = e;
            if (isBenignError(e, BENIGN_EDIT_CODES)) return null;
            const code = e.code ?? e.status ?? e.statusCode;
            const retryable = code === 500 || code === 502 || code === 503 || code === 429 || (e.retryAfter != null);
            if (retryable && attempt < maxRetries) continue;
            safeError('Helpers.safeEdit', e);
            return null;
        }
    }
    if (lastErr) safeError('Helpers.safeEdit', lastErr);
    return null;
}

function truncate(str, maxLength = 2000, suffix = '...') {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - suffix.length) + suffix;
}

function codeBlock(content, language = '') {
    return `\`\`\`${language}\n${content}\n\`\`\``;
}

function inlineCode(content) {
    return `\`${content}\``;
}

function bold(content) { return `**${content}**`; }
function italic(content) { return `*${content}*`; }
function underline(content) { return `__${content}__`; }
function strikethrough(content) { return `~~${content}~~`; }
function spoiler(content) { return `||${content}||`; }
function quote(content) { return `> ${content}`; }
function blockQuote(content) { return `>>> ${content}`; }
function hyperlink(label, url) { return `[${label}](${url})`; }

function userMention(id) { return `<@${id}>`; }
function channelMention(id) { return `<#${id}>`; }
function roleMention(id) { return `<@&${id}>`; }
function timestamp(date, style = 'f') {
    const unix = Math.floor((date instanceof Date ? date.getTime() : date) / 1000);
    return `<t:${unix}:${style}>`;
}

function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num);
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function titleCase(str) {
    return str.split(' ').map(capitalize).join(' ');
}

function escapeMarkdown(str) {
    return str.replace(/([*_`~\\|])/g, '\\$1');
}

function isValidUrl(str) {
    try { new URL(str); return true; } catch (_) { return false; }
}

function isSnowflake(str) {
    return /^\d{17,20}$/.test(String(str));
}

function parseFlags(args) {
    const flags = {};
    const remaining = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                flags[key] = args[++i];
            } else {
                flags[key] = true;
            }
        } else {
            remaining.push(args[i]);
        }
    }
    return { flags, remaining };
}

module.exports = {
    generateTraceId,
    createGenericErrorPayload, createWarningPayload, createSuccessPayload,
    createInfoPayload, createLoadingPayload, createNotFoundPayload,
    createNoPermissionPayload, createCooldownPayload, createPremiumRequiredPayload,
    createDisabledPayload, createBlacklistedPayload,
    safeReply, safeFollowUp, safeDefer, safeDeferUpdate, safeDelete, safeEdit,
    truncate, codeBlock, inlineCode, bold, italic, underline, strikethrough,
    spoiler, quote, blockQuote, hyperlink,
    userMention, channelMention, roleMention, timestamp,
    chunkArray, sleep, formatBytes, formatDuration, formatNumber,
    capitalize, titleCase, escapeMarkdown, isValidUrl, isSnowflake, parseFlags
};
