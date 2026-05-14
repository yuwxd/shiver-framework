class ListBuilder {
    constructor(opts = {}) {
        this._items = [];
        this._bullet = opts.bullet ?? '-';
        this._indent = opts.indent ?? 0;
    }

    add(label, value, opts = {}) {
        this._items.push({ type: 'item', label, value, opts });
        return this;
    }

    addSection(title) {
        this._items.push({ type: 'section', title });
        return this;
    }

    addBlank() {
        this._items.push({ type: 'blank' });
        return this;
    }

    build() {
        const lines = [];
        const indent = ' '.repeat(this._indent);
        for (const item of this._items) {
            if (item.type === 'blank') {
                lines.push('');
            } else if (item.type === 'section') {
                lines.push(`**${item.title}**`);
            } else {
                const { label, value, opts = {} } = item;
                let left = opts.bold ? `**${label}**` : label;
                if (opts.code) left = `\`${label}\``;
                const right = value !== undefined && value !== null ? String(value) : null;
                const line = right ? `${indent}${this._bullet} ${left}: ${right}` : `${indent}${this._bullet} ${left}`;
                lines.push(line);
            }
        }
        return lines.join('\n');
    }
}

module.exports = { ListBuilder };
