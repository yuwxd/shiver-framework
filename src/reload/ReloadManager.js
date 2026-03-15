class ReloadManager {
    constructor(framework) {
        this._framework = framework;
    }

    async all(options = {}) {
        const commandsPath = this._framework.options.commandsPath;
        if (!commandsPath) return { reloaded: 0, errors: [] };

        this._framework.commands.clear();
        const result = this._framework.commands.loadFromDirectory(commandsPath);
        if (options.syncDiscord && this._framework.client) {
            await this._framework.commands.syncToDiscord(this._framework.client, {
                guildIds: this._framework.options.slashSync?.guildIds
            });
        }
        console.log(`[ReloadManager] Reloaded ${result.loaded} commands`);
        const payload = {
            loaded: result.loaded,
            errors: result.errors,
            synced: !!options.syncDiscord
        };
        await this._framework.events.emit('commandsReloaded', payload);
        return payload;
    }

    async command(name, options = {}) {
        const commandsPath = this._framework.options.commandsPath;
        if (!commandsPath) return false;

        const existing = this._framework.commands.getSlash(name) || this._framework.commands.getPrefix(name);
        const sourcePath = this._framework.commands.getSourcePath(name);
        if (sourcePath) {
            try {
                delete require.cache[require.resolve(sourcePath)];
                const piece = require(sourcePath);
                piece.__sourcePath = sourcePath;
                this._framework.commands.registerCommand(piece);
                if (options.syncDiscord && this._framework.client) {
                    await this._framework.commands.syncToDiscord(this._framework.client, {
                        guildIds: this._framework.options.slashSync?.guildIds
                    });
                }
                console.log(`[ReloadManager] Reloaded command: ${name}`);
                const payload = { ok: true, name, sourcePath, synced: !!options.syncDiscord };
                await this._framework.events.emit('commandReloaded', payload);
                return payload;
            } catch (err) {
                safeError('ReloadManager', err);
            }
        }

        const files = this._collectFiles(commandsPath);
        for (const filePath of files) {
            try {
                delete require.cache[require.resolve(filePath)];
                const piece = require(filePath);
                if (piece?.name === name || piece?.data?.name === name) {
                    piece.__sourcePath = filePath;
                    this._framework.commands.registerCommand(piece);
                    if (options.syncDiscord && this._framework.client) {
                        await this._framework.commands.syncToDiscord(this._framework.client, {
                            guildIds: this._framework.options.slashSync?.guildIds
                        });
                    }
                    console.log(`[ReloadManager] Reloaded command: ${name}`);
                    const payload = { ok: true, name, sourcePath: filePath, synced: !!options.syncDiscord };
                    await this._framework.events.emit('commandReloaded', payload);
                    return payload;
                }
            } catch (err) {
                safeError('ReloadManager', err);
            }
        }
        if (existing) {
            const payload = { ok: false, name, sourcePath: sourcePath ?? null, synced: false };
            await this._framework.events.emit('commandReloaded', payload);
            return payload;
        }
        const payload = { ok: false, name, sourcePath: null, synced: false };
        await this._framework.events.emit('commandReloaded', payload);
        return payload;
    }

    _collectFiles(dir, out = []) {
        const fs = require('fs');
        const path = require('path');
const { safeError } = require('../security/redact');
        if (!fs.existsSync(dir)) return out;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) this._collectFiles(full, out);
            else if (entry.name.endsWith('.js') && !entry.name.startsWith('_')) out.push(full);
        }
        return out;
    }
}

module.exports = { ReloadManager };
