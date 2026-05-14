function buildProgressBar(current, total, opts = {}) {
    const {
        width = 20,
        filled = '█',
        empty = '░',
        showPercent = true,
        showFraction = false,
        prefix = '',
        suffix = ''
    } = opts;

    const clamped = Math.min(Math.max(current, 0), total);
    const pct = total === 0 ? 0 : clamped / total;
    const filledCount = Math.round(pct * width);
    const bar = filled.repeat(filledCount) + empty.repeat(width - filledCount);

    const parts = [prefix, bar];
    if (showPercent) parts.push(`${Math.round(pct * 100)}%`);
    if (showFraction) parts.push(`(${clamped}/${total})`);
    if (suffix) parts.push(suffix);

    return parts.filter(Boolean).join(' ');
}

function buildMultiBar(items, opts = {}) {
    const { width = 16, labelWidth = 12 } = opts;
    return items.map(({ label, current, total, filled, empty }) => {
        const bar = buildProgressBar(current, total, { width, filled, empty, showPercent: true });
        const paddedLabel = String(label).padEnd(labelWidth).slice(0, labelWidth);
        return `${paddedLabel} ${bar}`;
    }).join('\n');
}

module.exports = { buildProgressBar, buildMultiBar };
