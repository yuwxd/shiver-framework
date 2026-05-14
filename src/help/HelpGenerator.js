class HelpGenerator {
    static generate(command) {
        if (!command?.data) return null;
        const json = typeof command.data.toJSON === 'function' ? command.data.toJSON() : command.data;
        const lines = [];

        lines.push(`> **/${json.name}**`);
        if (json.description) lines.push(`> ${json.description}`);

        const subcommands = (json.options ?? []).filter(o => o.type === 1);
        const groups = (json.options ?? []).filter(o => o.type === 2);
        const options = (json.options ?? []).filter(o => o.type >= 3);

        if (subcommands.length > 0) {
            lines.push('');
            lines.push('**Subcommands:**');
            for (const sub of subcommands) {
                const opts = (sub.options ?? []).filter(o => o.type >= 3);
                const optStr = opts.map(o => o.required ? `<${o.name}>` : `[${o.name}]`).join(' ');
                lines.push(`- \`/${json.name} ${sub.name}${optStr ? ' ' + optStr : ''}\` - ${sub.description ?? ''}`);
            }
        }

        if (groups.length > 0) {
            for (const group of groups) {
                lines.push(`\n**${group.name}:**`);
                for (const sub of (group.options ?? []).filter(o => o.type === 1)) {
                    lines.push(`- \`/${json.name} ${group.name} ${sub.name}\` - ${sub.description ?? ''}`);
                }
            }
        }

        if (options.length > 0 && subcommands.length === 0) {
            lines.push('');
            lines.push('**Options:**');
            for (const opt of options) {
                const req = opt.required ? ' (required)' : ' (optional)';
                lines.push(`- \`${opt.name}\`${req} - ${opt.description ?? ''}`);
            }
        }

        if (command.aliases?.length) {
            lines.push('');
            lines.push(`**Prefix aliases:** ${command.aliases.map(a => `\`,${a}\``).join(', ')}`);
        }

        return lines.join('\n');
    }

    static generateList(commands, opts = {}) {
        const { filter, category } = opts;
        const list = commands
            .filter(cmd => cmd.data)
            .filter(cmd => !category || cmd.category === category)
            .filter(cmd => !filter || filter(cmd));

        return list.map(cmd => {
            const json = typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : cmd.data;
            return `\`/${json.name}\` - ${json.description ?? ''}`;
        }).join('\n');
    }

    static generateCategory(commands, category) {
        return HelpGenerator.generateList(commands, { category });
    }
}

module.exports = { HelpGenerator };
