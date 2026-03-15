#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const COMMAND_TEMPLATE = (name) => `const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('${name}')
        .setDescription('${name} command'),
    name: '${name}',
    aliases: [],

    async executeSlash(interaction, client) {
        await interaction.deferReply();
        await interaction.editReply({ content: '${name}' });
    },

    async executePrefix(message, args, client, commandName) {
        await message.reply('${name}');
    }
};
`;

const LISTENER_TEMPLATE = (name) => `module.exports = {
    name: '${name}',
    event: '${name}',
    once: false,

    async run(...args) {

    }
};
`;

const PRECONDITION_TEMPLATE = (name) => `const { BasePrecondition, PreconditionResult } = require('shiver-framework');

class ${name.charAt(0).toUpperCase() + name.slice(1)}Precondition extends BasePrecondition {
    constructor(opts = {}) {
        super({ name: '${name}', ...opts });
    }

    async run(interaction, command, context) {
        return PreconditionResult.ok();
    }
}

module.exports = { ${name.charAt(0).toUpperCase() + name.slice(1)}Precondition };
`;

const SYSTEM_TEMPLATE = (name) => `const { EventEmitter } = require('events');

class ${name.charAt(0).toUpperCase() + name.slice(1)}System extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._storage = opts.storage ?? null;
        this._client = null;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    async setup(guild, config) {
        if (this._storage) {
            await this._storage.set('${name}', guild.id, config);
        }
    }

    async getConfig(guildId) {
        if (!this._storage) return null;
        return this._storage.get('${name}', guildId);
    }
}

module.exports = { ${name.charAt(0).toUpperCase() + name.slice(1)}System };
`;

function generate(type, name, targetDir) {
    const templates = {
        command: { template: COMMAND_TEMPLATE, dir: 'src/commands', ext: '.js' },
        listener: { template: LISTENER_TEMPLATE, dir: 'src/listeners', ext: '.js' },
        precondition: { template: PRECONDITION_TEMPLATE, dir: 'src/preconditions', ext: '.js' },
        system: { template: SYSTEM_TEMPLATE, dir: 'src/systems', ext: '.js' }
    };

    const config = templates[type];
    if (!config) {
        console.error(`Unknown type: ${type}. Available: ${Object.keys(templates).join(', ')}`);
        process.exit(1);
    }

    const outDir = path.resolve(targetDir ?? process.cwd(), config.dir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `${name}${config.ext}`);
    if (fs.existsSync(outFile)) {
        console.error(`File already exists: ${outFile}`);
        process.exit(1);
    }

    fs.writeFileSync(outFile, config.template(name));
    console.log(`Generated ${type}: ${outFile}`);
}

function validate(commandsDir) {
    const dir = path.resolve(commandsDir ?? path.join(process.cwd(), 'src/commands'));
    if (!fs.existsSync(dir)) {
        console.error(`Commands directory not found: ${dir}`);
        process.exit(1);
    }

    const files = [];
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (entry.name.endsWith('.js')) files.push(full);
        }
    };
    walk(dir);

    let errors = 0;
    let ok = 0;

    for (const file of files) {
        try {
            const cmd = require(file);
            const issues = [];

            if (!cmd.name && !cmd.data?.name) issues.push('missing name');
            if (!cmd.executeSlash && !cmd.executePrefix) issues.push('missing executeSlash or executePrefix');
            if (cmd.executeSlash && typeof cmd.executeSlash !== 'function') issues.push('executeSlash must be a function');
            if (cmd.executePrefix && typeof cmd.executePrefix !== 'function') issues.push('executePrefix must be a function');

            if (issues.length > 0) {
                console.error(`✗ ${path.relative(process.cwd(), file)}: ${issues.join(', ')}`);
                errors++;
            } else {
                console.log(`✓ ${path.relative(process.cwd(), file)}`);
                ok++;
            }
        } catch (err) {
            console.error(`✗ ${path.relative(process.cwd(), file)}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\n${ok} valid, ${errors} invalid`);
    if (errors > 0) process.exit(1);
}

async function sync(token, commandsDir) {
    const { REST, Routes } = require('discord.js');
    const dir = path.resolve(commandsDir ?? path.join(process.cwd(), 'src/commands'));

    if (!token) {
        console.error('Token required. Pass as argument or set DISCORD_TOKEN env var.');
        process.exit(1);
    }

    const commands = [];
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (entry.name.endsWith('.js')) {
                try {
                    const cmd = require(full);
                    if (cmd.data?.toJSON) commands.push(cmd.data.toJSON());
                } catch (_) {}
            }
        }
    };

    if (fs.existsSync(dir)) walk(dir);

    if (commands.length === 0) {
        console.log('No slash commands found.');
        return;
    }

    const rest = new REST().setToken(token);
    const { clientId } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))?.shiver ?? {};

    if (!clientId) {
        console.error('clientId not found. Add "shiver": { "clientId": "..." } to package.json');
        process.exit(1);
    }

    console.log(`Syncing ${commands.length} commands...`);
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`Done. ${commands.length} commands registered globally.`);
}

const [,, command, ...args] = process.argv;

if (command === 'generate') {
    const [type, name, dir] = args;
    if (!type || !name) {
        console.error('Usage: shiver-framework generate <type> <name> [dir]');
        console.error('Types: command, listener, precondition, system');
        process.exit(1);
    }
    generate(type, name, dir);
} else if (command === 'validate') {
    validate(args[0]);
} else if (command === 'sync') {
    const token = args[0] ?? process.env.DISCORD_TOKEN;
    sync(token, args[1]).catch(err => { console.error(err.message); process.exit(1); });
} else {
    console.log('Shiver Framework CLI');
    console.log('');
    console.log('Commands:');
    console.log('  generate <type> <name> [dir]  Generate a new file from template');
    console.log('  validate [commandsDir]         Validate all command files');
    console.log('  sync [token] [commandsDir]     Sync slash commands to Discord');
    console.log('');
    console.log('Generate types: command, listener, precondition, system');
}
