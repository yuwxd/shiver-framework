class TableBuilder {
    constructor(opts = {}) {
        this._columns = [];
        this._rows = [];
        this._separators = new Set();
        this._maxWidth = opts.maxWidth ?? 80;
        this._border = opts.border ?? false;
    }

    addColumn(key, label, opts = {}) {
        this._columns.push({
            key,
            label: label ?? key,
            width: opts.width ?? Math.max(key.length, (label ?? key).length) + 2,
            align: opts.align ?? 'left'
        });
        return this;
    }

    addRow(data) {
        this._rows.push({ type: 'data', data });
        return this;
    }

    addSeparator() {
        this._rows.push({ type: 'separator' });
        return this;
    }

    _pad(str, width, align) {
        const s = String(str ?? '').slice(0, width);
        if (align === 'right') return s.padStart(width);
        if (align === 'center') {
            const pad = Math.max(0, width - s.length);
            return ' '.repeat(Math.floor(pad / 2)) + s + ' '.repeat(Math.ceil(pad / 2));
        }
        return s.padEnd(width);
    }

    _headerLine() {
        return this._columns.map(c => this._pad(c.label, c.width, 'left')).join(' | ');
    }

    _dividerLine() {
        return this._columns.map(c => '-'.repeat(c.width)).join('-+-');
    }

    _dataLine(data) {
        return this._columns.map(c => this._pad(data[c.key], c.width, c.align)).join(' | ');
    }

    build() {
        return this.buildLines().join('\n');
    }

    buildLines() {
        const lines = [];
        lines.push(this._headerLine());
        lines.push(this._dividerLine());
        for (const row of this._rows) {
            if (row.type === 'separator') {
                lines.push(this._dividerLine());
            } else {
                lines.push(this._dataLine(row.data));
            }
        }
        return lines;
    }

    toCodeBlock(lang = '') {
        return `\`\`\`${lang}\n${this.build()}\n\`\`\``;
    }
}

module.exports = { TableBuilder };
