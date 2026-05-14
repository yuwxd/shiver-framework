function diff(oldObj, newObj, opts = {}) {
    const added = {};
    const removed = {};
    const changed = {};
    const allKeys = new Set([...Object.keys(oldObj ?? {}), ...Object.keys(newObj ?? {})]);

    for (const key of allKeys) {
        const hasOld = Object.prototype.hasOwnProperty.call(oldObj ?? {}, key);
        const hasNew = Object.prototype.hasOwnProperty.call(newObj ?? {}, key);
        const oldVal = (oldObj ?? {})[key];
        const newVal = (newObj ?? {})[key];

        if (!hasOld && hasNew) {
            added[key] = newVal;
        } else if (hasOld && !hasNew) {
            removed[key] = oldVal;
        } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            changed[key] = { from: oldVal, to: newVal };
        }
    }

    return { added, removed, changed };
}

function formatDiff(diffResult, opts = {}) {
    const { addEmoji = '+', removeEmoji = '-', changeEmoji = '~', codeWrap = true } = opts;
    const lines = [];

    for (const [key, val] of Object.entries(diffResult.added ?? {})) {
        const v = codeWrap ? `\`${val}\`` : val;
        lines.push(`${addEmoji} **${key}**: ${v}`);
    }
    for (const [key, val] of Object.entries(diffResult.removed ?? {})) {
        const v = codeWrap ? `\`${val}\`` : val;
        lines.push(`${removeEmoji} **${key}**: ${v}`);
    }
    for (const [key, { from, to }] of Object.entries(diffResult.changed ?? {})) {
        const f = codeWrap ? `\`${from}\`` : from;
        const t = codeWrap ? `\`${to}\`` : to;
        lines.push(`${changeEmoji} **${key}**: ${f} to ${t}`);
    }

    return lines.join('\n') || 'No changes.';
}

module.exports = { diff, formatDiff };
