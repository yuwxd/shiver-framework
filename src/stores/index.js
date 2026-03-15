const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class BaseStore extends EventEmitter {
    constructor(name) {
        super();
        this.name = name;
        this._entries = new Map();
        this._framework = null;
    }

    get size() { return this._entries.size; }

    set(key, value) {
        const existing = this._entries.has(key);
        this._entries.set(key, value);
        this.emit(existing ? 'update' : 'add', key, value);
        return this;
    }

    get(key) { return this._entries.get(key) ?? null; }
    has(key) { return this._entries.has(key); }

    delete(key) {
        const value = this._entries.get(key);
        const result = this._entries.delete(key);
        if (result) this.emit('delete', key, value);
        return result;
    }

    clear() {
        this._entries.clear();
        this.emit('clear');
        return this;
    }

    keys() { return [...this._entries.keys()]; }
    values() { return [...this._entries.values()]; }
    entries() { return [...this._entries.entries()]; }

    find(predicate) {
        for (const value of this._entries.values()) {
            if (predicate(value)) return value;
        }
        return null;
    }

    filter(predicate) {
        return [...this._entries.values()].filter(predicate);
    }

    map(fn) {
        return [...this._entries.values()].map(fn);
    }

    some(predicate) {
        for (const value of this._entries.values()) {
            if (predicate(value)) return true;
        }
        return false;
    }

    every(predicate) {
        for (const value of this._entries.values()) {
            if (!predicate(value)) return false;
        }
        return true;
    }

    toJSON() {
        return this.map(v => typeof v.toJSON === 'function' ? v.toJSON() : v);
    }

    [Symbol.iterator]() {
        return this._entries.values();
    }
}

class CommandStore extends BaseStore {
    constructor() {
        super('commands');
        this._aliases = new Map();
    }

    set(key, command) {
        super.set(key, command);
        if (command._store !== this) command._store = this;
        if (command.aliases) {
            for (const alias of command.aliases) {
                this._aliases.set(alias, key);
            }
        }
        return this;
    }

    delete(key) {
        const command = this._entries.get(key);
        if (command?.aliases) {
            for (const alias of command.aliases) {
                this._aliases.delete(alias);
            }
        }
        return super.delete(key);
    }

    resolve(nameOrAlias) {
        const direct = this._entries.get(nameOrAlias);
        if (direct) return direct;
        const aliasKey = this._aliases.get(nameOrAlias);
        if (aliasKey) return this._entries.get(aliasKey) ?? null;
        return null;
    }

    getByCategory(category) {
        return this.filter(cmd => cmd.category === category);
    }

    getCategories() {
        const cats = new Set();
        for (const cmd of this._entries.values()) {
            if (cmd.category) cats.add(cmd.category);
        }
        return [...cats];
    }

    async loadFromDirectory(dir, framework) {
        if (!fs.existsSync(dir)) return 0;
        const files = this._getFiles(dir);
        let loaded = 0;
        for (const file of files) {
            try {
                delete require.cache[require.resolve(file)];
                const mod = require(file);
                const command = mod.default ?? mod;
                if (!command || typeof command !== 'object') continue;
                const name = command.name ?? path.basename(file, path.extname(file));
                if (command._store !== undefined) command._store = this;
                if (command._framework !== undefined) command._framework = framework;
                this.set(name, command);
                loaded++;
            } catch (e) {
                console.error(`[CommandStore] Failed to load ${file}:`, e);
            }
        }
        return loaded;
    }

    async reload(name, framework) {
        const command = this._entries.get(name);
        if (!command) return false;
        const filePath = this._findFile(command);
        if (!filePath) return false;
        this.delete(name);
        delete require.cache[require.resolve(filePath)];
        const mod = require(filePath);
        const newCommand = mod.default ?? mod;
        if (!newCommand) return false;
        if (newCommand._store !== undefined) newCommand._store = this;
        if (newCommand._framework !== undefined) newCommand._framework = framework;
        this.set(name, newCommand);
        this.emit('reload', name, newCommand);
        return true;
    }

    _getFiles(dir) {
        const results = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...this._getFiles(full));
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                results.push(full);
            }
        }
        return results;
    }

    _findFile(command) {
        return null;
    }
}

class ListenerStore extends BaseStore {
    constructor() {
        super('listeners');
        this._client = null;
        this._boundHandlers = new Map();
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    set(key, listener) {
        super.set(key, listener);
        if (this._client) this._attach(key, listener);
        return this;
    }

    delete(key) {
        this._detach(key);
        return super.delete(key);
    }

    _attach(key, listener) {
        if (!this._client || !listener.enabled) return;
        const handler = (...args) => listener.run(...args);
        this._boundHandlers.set(key, handler);
        if (listener.once) {
            this._client.once(listener.event, handler);
        } else {
            this._client.on(listener.event, handler);
        }
    }

    _detach(key) {
        const handler = this._boundHandlers.get(key);
        if (!handler) return;
        const listener = this._entries.get(key);
        if (listener && this._client) {
            this._client.removeListener(listener.event, handler);
        }
        this._boundHandlers.delete(key);
    }

    attachAll(client) {
        this._client = client;
        for (const [key, listener] of this._entries) {
            this._attach(key, listener);
        }
    }

    detachAll() {
        for (const key of this._entries.keys()) {
            this._detach(key);
        }
    }

    async loadFromDirectory(dir, framework) {
        if (!fs.existsSync(dir)) return 0;
        const files = this._getFiles(dir);
        let loaded = 0;
        for (const file of files) {
            try {
                delete require.cache[require.resolve(file)];
                const mod = require(file);
                const listener = mod.default ?? mod;
                if (!listener || typeof listener !== 'object') continue;
                const name = listener.name ?? path.basename(file, path.extname(file));
                if (listener._store !== undefined) listener._store = this;
                if (listener._framework !== undefined) listener._framework = framework;
                this.set(name, listener);
                loaded++;
            } catch (e) {
                console.error(`[ListenerStore] Failed to load ${file}:`, e);
            }
        }
        return loaded;
    }

    _getFiles(dir) {
        const results = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...this._getFiles(full));
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                results.push(full);
            }
        }
        return results;
    }
}

class PreconditionStore extends BaseStore {
    constructor() { super('preconditions'); }

    async run(name, interaction, command, context) {
        const precondition = this._entries.get(name);
        if (!precondition) throw new Error(`Precondition "${name}" not found`);
        return precondition.run(interaction, command, context);
    }

    async runAll(names, interaction, command, context) {
        for (const name of names) {
            const result = await this.run(name, interaction, command, context);
            if (!result.ok) return result;
        }
        const { PreconditionResult } = require('../preconditions');
        return PreconditionResult.ok();
    }
}

class ArgumentStore extends BaseStore {
    constructor() { super('arguments'); }

    resolve(name) {
        const direct = this._entries.get(name);
        if (direct) return direct;
        for (const arg of this._entries.values()) {
            if (arg.aliases?.includes(name)) return arg;
        }
        return null;
    }

    async run(name, parameter, context, opts = {}) {
        const arg = this.resolve(name);
        if (!arg) throw new Error(`Argument "${name}" not found`);
        return arg.run(parameter, context, opts);
    }
}

module.exports = { BaseStore, CommandStore, ListenerStore, PreconditionStore, ArgumentStore };
