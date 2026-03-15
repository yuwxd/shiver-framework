const fs = require('fs');
const path = require('path');
const { safeError } = require('../security/redact');

class CommandRegistry {
    constructor(options = {}) {
        this._slash = new Map();
        this._prefix = new Map();
        this._sourcePaths = new Map();
        this._options = options;
        this._lastSyncHash = null;
    }

    registerCommand(piece) {
        if (!piece || (!piece.name && !piece.data?.name)) return;
        if (piece.__sourcePath) {
            this.removeBySourcePath(piece.__sourcePath);
        }

        const slashName = piece.data?.name ?? null;
        const prefixName = piece.name ?? null;

        if (slashName) {
            this._slash.set(slashName, piece);
        }

        if (prefixName && !piece.adminOnly && typeof piece.executePrefix === 'function') {
            this._prefix.set(prefixName, piece);
            if (Array.isArray(piece.aliases)) {
                for (const alias of piece.aliases) {
                    this._prefix.set(alias, piece);
                }
            }
        }

        if (piece.__sourcePath) {
            if (slashName) this._sourcePaths.set(slashName, piece.__sourcePath);
            if (prefixName) this._sourcePaths.set(prefixName, piece.__sourcePath);
        }
    }

    getSlash(name) {
        return this._slash.get(name);
    }

    getPrefix(name) {
        return this._prefix.get(name);
    }

    getAllSlash() {
        const seen = new Set();
        const result = [];
        for (const cmd of this._slash.values()) {
            if (!seen.has(cmd.name)) {
                seen.add(cmd.name);
                result.push(cmd);
            }
        }
        return result;
    }

    getAllPrefix() {
        return [...new Set(this._prefix.values())];
    }

    _collectFiles(dir, out = []) {
        if (!fs.existsSync(dir)) return out;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) this._collectFiles(full, out);
            else if (entry.name.endsWith('.js') && !entry.name.startsWith('_')) out.push(full);
        }
        return out;
    }

    loadFromDirectory(dirPath) {
        const files = this._collectFiles(dirPath);
        const errors = [];
        for (const filePath of files) {
            try {
                delete require.cache[require.resolve(filePath)];
                const piece = require(filePath);
                if (piece && (piece.data?.name || piece.name)) {
                    piece.__sourcePath = filePath;
                    this._validateDefinition(piece, filePath);
                    this.registerCommand(piece);
                }
            } catch (err) {
                errors.push({ file: filePath, error: err });
                if (this._options.debug) {
                    safeError('CommandRegistry', err);
                }
            }
        }
        return { loaded: this._slash.size, errors };
    }

    loadPiece({ name, piece }) {
        if (!piece) return;
        if (name && !piece.__sourcePath) piece.__sourcePath = name;
        this._validateDefinition(piece, name);
        this.registerCommand(piece);
    }

    getSourcePath(name) {
        return this._sourcePaths.get(name) ?? null;
    }

    getSourcePathsMap() {
        return new Map(this._sourcePaths);
    }

    registerPath(dirPath) {
        return this.loadFromDirectory(dirPath);
    }

    removeBySourcePath(sourcePath) {
        if (!sourcePath) return;
        for (const [name, command] of [...this._slash.entries()]) {
            if (command?.__sourcePath === sourcePath) {
                this._slash.delete(name);
            }
        }
        for (const [name, command] of [...this._prefix.entries()]) {
            if (command?.__sourcePath === sourcePath) {
                this._prefix.delete(name);
            }
        }
        for (const [name, registeredPath] of [...this._sourcePaths.entries()]) {
            if (registeredPath === sourcePath) {
                this._sourcePaths.delete(name);
            }
        }
    }

    _validateDefinition(piece, source) {
        if (!this._options.debug) return;
        if (!piece.name) console.warn(`[CommandRegistry] Command at ${source} missing "name"`);
        if (!piece.data) console.warn(`[CommandRegistry] Command "${piece.name}" at ${source} missing "data"`);
        if (!piece.executeSlash && !piece.executePrefix && !piece.executeContextMenu) {
            console.warn(`[CommandRegistry] Command "${piece.name}" at ${source} has no execute handler`);
        }
        if (piece.data?.description && piece.data.description.length > 100) {
            console.warn(`[CommandRegistry] Command "${piece.name}": description exceeds 100 characters`);
        }
        if (piece.data?.name && piece.data.name.length > 32) {
            console.warn(`[CommandRegistry] Command "${piece.name}": name exceeds 32 characters`);
        }
    }

    async syncToDiscord(client, options = {}) {
        const { guildIds = null } = options;
        const commands = this.getAllSlash();
        const payloads = [];
        const validationErrors = [];

        for (const cmd of commands) {
            if (!cmd.data) continue;
            try {
                const json = typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : cmd.data;
                if (!json?.name) continue;
                if (json.name.length > 32) {
                    validationErrors.push(`Command "${json.name}": name exceeds 32 characters`);
                    continue;
                }
                if (json.description && json.description.length > 100) {
                    validationErrors.push(`Command "${json.name}": description exceeds 100 characters`);
                    continue;
                }
                payloads.push(json);
            } catch (err) {
                if (this._options.debug) safeError('CommandRegistry', err);
            }
        }

        if (validationErrors.length > 0) {
            for (const e of validationErrors) console.warn(`[CommandRegistry] Validation: ${e}`);
        }

        if (payloads.length === 0) return { synced: 0, applicationCommands: null };

        const appCommands = guildIds
            ? null
            : client.application?.commands;

        if (!appCommands && !guildIds) return { synced: 0, applicationCommands: null };

        let applicationCommands = null;
        const maxRetries = this._options.registration?.maxRetries ?? 3;
        const retryOnRateLimit = this._options.registration?.retryOnRateLimit !== false;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (guildIds) {
                    const ids = Array.isArray(guildIds) ? guildIds : [guildIds];
                    for (const guildId of ids) {
                        const guild = client.guilds.cache.get(guildId);
                        if (guild) await guild.commands.set(payloads);
                    }
                    applicationCommands = null;
                } else {
                    applicationCommands = await appCommands.set(payloads);
                }
                break;
            } catch (err) {
                const isRateLimit = err?.status === 429 || err?.httpStatus === 429 || err?.code === 429;
                if (isRateLimit && retryOnRateLimit && attempt < maxRetries) {
                    const retryAfterMs = (err?.retryAfter ?? 5) * 1000;
                    const jitter = Math.random() * 1000;
                    const delay = Math.min(retryAfterMs + jitter, this._options.registration?.maxRetryDelayMs ?? 30000);
                    console.warn(`[CommandRegistry] Rate limit on slash sync, retry in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`);
                    if (typeof this._options.registration?.onRateLimit === 'function') {
                        this._options.registration.onRateLimit({ retryAfterMs: delay, attemptedCount: payloads.length });
                    }
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    throw err;
                }
            }
        }

        return { synced: payloads.length, applicationCommands };
    }

    getCommandsList() {
        const result = [];
        for (const cmd of this.getAllSlash()) {
            if (!cmd.data) continue;
            const json = typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : cmd.data;
            const subcommands = (json.options || []).filter(o => o.type === 1);
            if (subcommands.length > 0) {
                for (const sub of subcommands) {
                    result.push({
                        command: `/${json.name} ${sub.name}`,
                        description: sub.description || '',
                        prefixForms: Array.isArray(cmd.aliases) ? cmd.aliases.map(a => `,${a} ${sub.name}`) : []
                    });
                }
            } else {
                result.push({
                    command: `/${json.name}`,
                    description: json.description || '',
                    prefixForms: Array.isArray(cmd.aliases) ? cmd.aliases.map(a => `,${a}`) : []
                });
            }
        }
        return result;
    }

    clear() {
        this._slash.clear();
        this._prefix.clear();
        this._sourcePaths.clear();
    }
}

module.exports = { CommandRegistry };
