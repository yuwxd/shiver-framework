const fs = require('fs/promises');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

function normalizeAssetName(name) {
    return String(name ?? '')
        .trim()
        .toLowerCase()
        .replace(/\\/g, '/');
}

function inferType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (FONT_EXTENSIONS.has(ext)) return 'font';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    return null;
}

async function readDirectoryRecursive(targetPath) {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await readDirectoryRecursive(fullPath));
            continue;
        }
        if (entry.isFile()) files.push(fullPath);
    }

    return files;
}

class AssetLoader {
    constructor(opts = {}) {
        this._assets = new Map();
        this._stats = {
            fonts: 0,
            images: 0,
            loads: 0,
            hits: 0,
            misses: 0,
            preloaded: 0
        };
        this._baseDir = opts.baseDir ?? process.cwd();
        this._canvas = null;
        this._canvasLoadAttempted = false;
    }

    setBaseDir(baseDir) {
        this._baseDir = baseDir;
        return this;
    }

    async loadFont(name, filePath, opts = {}) {
        return this._load('font', name, filePath, opts);
    }

    async loadImage(name, filePath, opts = {}) {
        return this._load('image', name, filePath, opts);
    }

    async _load(type, name, filePath, opts = {}) {
        const normalizedName = normalizeAssetName(name || path.basename(filePath, path.extname(filePath)));
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(this._baseDir, filePath);
        const eager = opts.eager !== false;
        const entry = {
            name: normalizedName,
            type,
            path: resolvedPath,
            aliases: new Set((opts.aliases ?? []).map(normalizeAssetName)),
            buffer: null,
            loadedAt: null,
            meta: { ...opts.meta }
        };

        if (eager) {
            entry.buffer = await fs.readFile(resolvedPath);
            entry.loadedAt = Date.now();
            this._stats.loads++;
        }

        this._assets.set(normalizedName, entry);
        for (const alias of entry.aliases) this._assets.set(alias, entry);

        if (type === 'font') this._stats.fonts++;
        if (type === 'image') this._stats.images++;

        if (type === 'font' && opts.registerCanvas !== false) {
            this.registerFont(normalizedName, opts.canvasOptions ?? {});
        }

        return entry;
    }

    async ensureLoaded(name) {
        const entry = this._assets.get(normalizeAssetName(name));
        if (!entry) {
            this._stats.misses++;
            return null;
        }
        if (!entry.buffer) {
            entry.buffer = await fs.readFile(entry.path);
            entry.loadedAt = Date.now();
            this._stats.loads++;
        } else {
            this._stats.hits++;
        }
        return entry;
    }

    async getFont(name) {
        const entry = await this.ensureLoaded(name);
        if (!entry || entry.type !== 'font') return null;
        return entry.buffer;
    }

    async getImage(name) {
        const entry = await this.ensureLoaded(name);
        if (!entry || entry.type !== 'image') return null;
        return entry.buffer;
    }

    async get(name) {
        const entry = await this.ensureLoaded(name);
        if (!entry) return null;
        return {
            name: entry.name,
            type: entry.type,
            path: entry.path,
            buffer: entry.buffer,
            loadedAt: entry.loadedAt,
            meta: { ...entry.meta }
        };
    }

    has(name) {
        return this._assets.has(normalizeAssetName(name));
    }

    async preload(targetDir, opts = {}) {
        const resolvedDir = path.isAbsolute(targetDir) ? targetDir : path.resolve(this._baseDir, targetDir);
        const files = await readDirectoryRecursive(resolvedDir);
        const loaded = [];

        for (const filePath of files) {
            const type = inferType(filePath);
            if (!type) continue;
            const relativeName = normalizeAssetName(path.relative(resolvedDir, filePath).replace(path.extname(filePath), ''));
            const asset = type === 'font'
                ? await this.loadFont(relativeName, filePath, { ...opts, eager: opts.eager !== false })
                : await this.loadImage(relativeName, filePath, { ...opts, eager: opts.eager !== false });
            loaded.push(asset);
        }

        this._stats.preloaded += loaded.length;
        return loaded;
    }

    list(type = null) {
        const unique = new Map();
        for (const entry of this._assets.values()) {
            if (unique.has(entry.path)) continue;
            if (type && entry.type !== type) continue;
            unique.set(entry.path, {
                name: entry.name,
                type: entry.type,
                path: entry.path,
                loadedAt: entry.loadedAt,
                meta: { ...entry.meta }
            });
        }
        return [...unique.values()];
    }

    remove(name) {
        const normalizedName = normalizeAssetName(name);
        const entry = this._assets.get(normalizedName);
        if (!entry) return false;
        for (const [key, value] of this._assets.entries()) {
            if (value === entry) this._assets.delete(key);
        }
        return true;
    }

    clear() {
        this._assets.clear();
        this._stats = {
            fonts: 0,
            images: 0,
            loads: 0,
            hits: 0,
            misses: 0,
            preloaded: 0
        };
        return this;
    }

    async toAttachment(name, filename = 'shiver.bin') {
        const entry = await this.ensureLoaded(name);
        if (!entry) return null;
        return new AttachmentBuilder(entry.buffer, { name: filename });
    }

    registerFont(name, opts = {}) {
        const entry = this._assets.get(normalizeAssetName(name));
        if (!entry || entry.type !== 'font') return false;
        const canvas = this._getCanvas();
        if (!canvas?.registerFont) return false;
        canvas.registerFont(entry.path, {
            family: opts.family ?? path.basename(entry.path, path.extname(entry.path)),
            weight: opts.weight,
            style: opts.style
        });
        return true;
    }

    registerAllFonts(opts = {}) {
        const results = [];
        for (const entry of this.list('font')) {
            results.push({ name: entry.name, registered: this.registerFont(entry.name, opts[entry.name] ?? {}) });
        }
        return results;
    }

    getStats() {
        return {
            ...this._stats,
            totalAssets: this.list().length,
            registeredFonts: this.list('font').length,
            registeredImages: this.list('image').length
        };
    }

    _getCanvas() {
        if (this._canvasLoadAttempted) return this._canvas;
        this._canvasLoadAttempted = true;
        try {
            this._canvas = require('canvas');
        } catch (_) {
            this._canvas = null;
        }
        return this._canvas;
    }
}

module.exports = {
    AssetLoader,
    FONT_EXTENSIONS,
    IMAGE_EXTENSIONS
};
