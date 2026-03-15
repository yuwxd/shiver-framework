const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class FileWatcher extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._debounceMs = opts.debounceMs ?? 300;
        this._watchers = new Map();
        this._timers = new Map();
        this._dependencyMap = new Map();
        this._previousVersions = new Map();
        this._filter = opts.filter ?? ((f) => f.endsWith('.js'));
        this._onReload = opts.onReload ?? null;
        this._onError = opts.onError ?? null;
        this._commandRegistry = null;
    }

    setCommandRegistry(registry) {
        this._commandRegistry = registry;
        return this;
    }

    watch(dirPath, opts = {}) {
        if (!fs.existsSync(dirPath)) return this;

        const recursive = opts.recursive !== false;

        const watcher = fs.watch(dirPath, { recursive }, (event, filename) => {
            if (!filename) return;
            const fullPath = path.resolve(dirPath, filename);
            if (!this._filter(fullPath)) return;
            if (event === 'change' || event === 'rename') {
                this._scheduleReload(fullPath, opts);
            }
        });

        this._watchers.set(dirPath, watcher);
        this.emit('watching', dirPath);
        return this;
    }

    watchFile(filePath, opts = {}) {
        if (!fs.existsSync(filePath)) return this;

        fs.watchFile(filePath, { interval: opts.interval ?? 500 }, (curr, prev) => {
            if (curr.mtime > prev.mtime) {
                this._scheduleReload(filePath, opts);
            }
        });

        this._watchers.set(filePath, { close: () => fs.unwatchFile(filePath) });
        return this;
    }

    _scheduleReload(filePath, opts = {}) {
        if (this._timers.has(filePath)) {
            clearTimeout(this._timers.get(filePath));
        }

        const timer = setTimeout(() => {
            this._timers.delete(filePath);
            this._reload(filePath, opts);
        }, this._debounceMs);

        if (timer.unref) timer.unref();
        this._timers.set(filePath, timer);
    }

    async _reload(filePath, opts = {}) {
        if (!fs.existsSync(filePath)) {
            this.emit('deleted', filePath);
            return;
        }

        const previousVersion = this._previousVersions.get(filePath);

        try {
            this._clearRequireCache(filePath);
            const piece = require(filePath);

            this._previousVersions.set(filePath, piece);

            if (this._commandRegistry && (piece?.name || piece?.data?.name)) {
                this._commandRegistry.registerCommand(piece);
            }

            const dependents = this._getDependents(filePath);
            for (const dep of dependents) {
                await this._reload(dep, opts);
            }

            this.emit('reloaded', filePath, piece);
            if (this._onReload) await this._onReload(filePath, piece);
        } catch (err) {
            if (previousVersion && opts.rollback !== false) {
                try {
                    const resolved = require.resolve(filePath);
                    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: previousVersion };
                    this.emit('rollback', filePath, err);
                } catch (_) {}
            }

            this.emit('error', filePath, err);
            if (this._onError) this._onError(filePath, err);
        }
    }

    _clearRequireCache(filePath) {
        const resolved = require.resolve(filePath);
        delete require.cache[resolved];
    }

    registerDependency(dependentFile, dependencyFile) {
        const deps = this._dependencyMap.get(dependencyFile) ?? new Set();
        deps.add(dependentFile);
        this._dependencyMap.set(dependencyFile, deps);
        return this;
    }

    _getDependents(filePath) {
        return [...(this._dependencyMap.get(filePath) ?? [])];
    }

    autoTrackDependencies(dirPath) {
        if (!fs.existsSync(dirPath)) return this;

        const walk = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!this._filter(full)) continue;

                try {
                    const content = fs.readFileSync(full, 'utf8');
                    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
                    let match;
                    while ((match = requireRegex.exec(content)) !== null) {
                        const dep = match[1];
                        if (dep.startsWith('.')) {
                            const resolved = path.resolve(path.dirname(full), dep);
                            const withExt = fs.existsSync(resolved + '.js') ? resolved + '.js' : (fs.existsSync(resolved) ? resolved : null);
                            if (withExt) this.registerDependency(full, withExt);
                        }
                    }
                } catch (_) {}
            }
        };

        walk(dirPath);
        return this;
    }

    unwatch(dirPath) {
        const watcher = this._watchers.get(dirPath);
        if (watcher) {
            watcher.close();
            this._watchers.delete(dirPath);
        }
        return this;
    }

    destroy() {
        for (const [, timer] of this._timers) clearTimeout(timer);
        this._timers.clear();

        for (const [, watcher] of this._watchers) {
            try { watcher.close(); } catch (_) {}
        }
        this._watchers.clear();
        this.removeAllListeners();
    }

    getWatched() {
        return [...this._watchers.keys()];
    }
}

module.exports = { FileWatcher };
