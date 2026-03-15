const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF\u00AD\u034F\u2028\u2029\u202A-\u202E\u2060-\u2064\u206A-\u206F]/g;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const NULL_BYTES = /\x00/g;
const MARKDOWN_ESCAPE = /([*_`~|\\])/g;
const MENTION_ESCAPE = /@(everyone|here)/gi;

const HOMOGLYPH_MAP = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
    'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'Х': 'X', 'У': 'Y',
    'ℂ': 'C', 'ℍ': 'H', 'ℕ': 'N', 'ℙ': 'P', 'ℚ': 'Q', 'ℝ': 'R', 'ℤ': 'Z',
    '𝐀': 'A', '𝐁': 'B', '𝐂': 'C', '𝐃': 'D', '𝐄': 'E',
    '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
    '⓪': '0', '⓵': '1', '⓶': '2', '⓷': '3', '⓸': '4'
};

const ZALGO_REGEX = /[\u0300-\u036f\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u0816-\u082D\u0859-\u085B\u08D4-\u08E1\u08E3-\u0902\u093A\u093C\u0941-\u0948\u094D\u0951-\u0957\u0962\u0963\u0981\u09BC\u09BE\u09C1-\u09C4\u09CD\u09D7\u09E2\u09E3\u0A01\u0A02\u0A3C\u0A41\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81\u0A82\u0ABC\u0AC1-\u0AC5\u0AC7\u0AC8\u0ACD\u0AE2\u0AE3\u0B01\u0B3C\u0B3E\u0B3F\u0B41-\u0B44\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE\u0BC0\u0BCD\u0BD7\u0C00\u0C3E-\u0C40\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81\u0CBC\u0CBF\u0CC2\u0CC6\u0CCC\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D01\u0D3E\u0D41-\u0D44\u0D4D\u0D57\u0D62\u0D63\u0DCA\u0DCF\u0DD2-\u0DD4\u0DD6\u0DDF\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F71-\u0F7E\u0F80-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102D-\u1030\u1032-\u1037\u1039\u103A\u103D\u103E\u1058\u1059\u105E-\u1060\u1071-\u1074\u1082\u1085\u1086\u108D\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4\u17B5\u17B7-\u17BD\u17C6\u17C9-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193B\u1A17\u1A18\u1A1B\u1A56\u1A58-\u1A5E\u1A60\u1A62\u1A65-\u1A6C\u1A73-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B03\u1B34\u1B36-\u1B3A\u1B3C\u1B42\u1B6B-\u1B73\u1B80\u1B81\u1BA2-\u1BA5\u1BA8\u1BA9\u1BAB-\u1BAD\u1BE6\u1BE8\u1BE9\u1BED\u1BEF-\u1BF1\u1C2C-\u1C33\u1C36\u1C37\u1CD0\u1CD2\u1CD4-\u1CE0\u1CE2-\u1CE8\u1CED\u1CF4\u1CF8\u1CF9\u1DC0-\u1DF5\u1DFB-\u1DFF]/g;

function sanitize(str, opts = {}) {
    if (typeof str !== 'string') return '';

    let result = str;

    result = result.replace(NULL_BYTES, '');
    result = result.replace(CONTROL_CHARS, '');
    result = result.replace(ZERO_WIDTH_CHARS, '');

    if (opts.removeZalgo !== false) {
        result = result.replace(ZALGO_REGEX, '');
    }

    if (opts.normalizeHomoglyphs) {
        result = result.split('').map(c => HOMOGLYPH_MAP[c] ?? c).join('');
    }

    if (opts.maxLength) {
        result = result.slice(0, opts.maxLength);
    }

    result = result.trim();

    return result;
}

function sanitizeForEmbed(str, maxLength) {
    if (typeof str !== 'string') return '';
    let result = sanitize(str, { removeZalgo: true });
    result = result.replace(MENTION_ESCAPE, '@\u200B$1');
    if (maxLength) result = result.slice(0, maxLength);
    return result;
}

function sanitizeForCode(str, maxLength) {
    if (typeof str !== 'string') return '';
    let result = sanitize(str, { removeZalgo: true });
    result = result.replace(/`/g, '\u200B`');
    if (maxLength) result = result.slice(0, maxLength);
    return result;
}

function escapeMarkdown(str) {
    if (typeof str !== 'string') return '';
    return str.replace(MARKDOWN_ESCAPE, '\\$1').replace(MENTION_ESCAPE, '@\u200B$1');
}

function stripMarkdown(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/~~(.+?)~~/g, '$1')
        .replace(/`{1,3}(.+?)`{1,3}/gs, '$1')
        .replace(/\|\|(.+?)\|\|/g, '$1')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1');
}

function detectInjection(str) {
    if (typeof str !== 'string') return { safe: true, threats: [] };

    const threats = [];

    if (ZERO_WIDTH_CHARS.test(str)) threats.push('zero_width_chars');
    if (ZALGO_REGEX.test(str)) threats.push('zalgo');
    if (NULL_BYTES.test(str)) threats.push('null_bytes');
    if (CONTROL_CHARS.test(str)) threats.push('control_chars');

    const homoglyphCount = str.split('').filter(c => HOMOGLYPH_MAP[c]).length;
    if (homoglyphCount > 3) threats.push('homoglyphs');

    const combiningCount = (str.match(ZALGO_REGEX) ?? []).length;
    if (combiningCount > 10) threats.push('excessive_combining');

    if (/javascript:/i.test(str)) threats.push('javascript_protocol');
    if (/<script/i.test(str)) threats.push('script_tag');
    if (/on\w+\s*=/i.test(str)) threats.push('event_handler');

    const repeatedChar = /(.)\1{50,}/.test(str);
    if (repeatedChar) threats.push('repeated_chars');

    return { safe: threats.length === 0, threats };
}

function sanitizeName(str, opts = {}) {
    if (typeof str !== 'string') return '';
    let result = sanitize(str, { removeZalgo: true, normalizeHomoglyphs: opts.normalizeHomoglyphs });
    result = result.replace(/[^\w\s\-_.]/g, '').trim();
    if (opts.maxLength) result = result.slice(0, opts.maxLength);
    return result;
}

function sanitizeUrl(str) {
    if (typeof str !== 'string') return null;
    try {
        const url = new URL(str);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return url.toString();
    } catch (_) {
        return null;
    }
}

module.exports = {
    sanitize,
    sanitizeForEmbed,
    sanitizeForCode,
    escapeMarkdown,
    stripMarkdown,
    detectInjection,
    sanitizeName,
    sanitizeUrl
};
