class PluginManager {
    constructor(framework) {
        this._framework = framework;
        this._plugins = new Map();
        this._initialized = new Set();
    }

    register(name, plugin) {
        this._plugins.set(name, plugin);
        return this;
    }

    async load(nameOrPlugin, options = {}) {
        let plugin = nameOrPlugin;
        let name = options.name;

        if (typeof nameOrPlugin === 'string') {
            name = nameOrPlugin;
            if (this._plugins.has(name)) {
                plugin = this._plugins.get(name);
            } else {
                try {
                    plugin = require(`./built-in/${name}`);
                } catch (_) {
                    console.error(`[PluginManager] Plugin "${name}" not found`);
                    return this;
                }
            }
        } else {
            name = plugin?.name || name || 'unknown';
        }

        if (this._initialized.has(name)) return this;

        try {
            if (typeof plugin?.init === 'function') {
                await plugin.init(this._framework, options);
            } else if (typeof plugin === 'function') {
                await plugin(this._framework, options);
            }
            this._initialized.add(name);
        } catch (err) {
            console.error(`[PluginManager] Failed to init plugin "${name}":`, err?.message);
        }

        return this;
    }

    async loadAll(plugins = []) {
        for (const entry of plugins) {
            if (typeof entry === 'string') {
                await this.load(entry);
            } else if (Array.isArray(entry)) {
                await this.load(entry[0], entry[1] || {});
            } else if (entry?.name) {
                await this.load(entry, {});
            }
        }
        return this;
    }

    isLoaded(name) {
        return this._initialized.has(name);
    }

    getLoaded() {
        return [...this._initialized];
    }
}

module.exports = { PluginManager };
