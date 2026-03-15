const fs = require('fs');
const path = require('path');

class BaseStorageAdapter {
    async get(namespace, key) { throw new Error('Not implemented'); }
    async set(namespace, key, value, ttl) { throw new Error('Not implemented'); }
    async delete(namespace, key) { throw new Error('Not implemented'); }
    async has(namespace, key) { throw new Error('Not implemented'); }
    async keys(namespace) { throw new Error('Not implemented'); }
    async values(namespace) { throw new Error('Not implemented'); }
    async entries(namespace) { throw new Error('Not implemented'); }
    async clear(namespace) { throw new Error('Not implemented'); }
    async getMany(namespace, keys) {
        return Promise.all(keys.map(k => this.get(namespace, k)));
    }
    async setMany(namespace, entries, ttl) {
        await Promise.all(entries.map(([k, v]) => this.set(namespace, k, v, ttl)));
    }
    async deleteMany(namespace, keys) {
        await Promise.all(keys.map(k => this.delete(namespace, k)));
    }
    async increment(namespace, key, amount = 1) {
        const current = (await this.get(namespace, key)) ?? 0;
        const next = Number(current) + amount;
        await this.set(namespace, key, next);
        return next;
    }
    async decrement(namespace, key, amount = 1) {
        return this.increment(namespace, key, -amount);
    }
    async push(namespace, key, ...items) {
        const current = (await this.get(namespace, key)) ?? [];
        if (!Array.isArray(current)) throw new Error('Value is not an array');
        const next = [...current, ...items];
        await this.set(namespace, key, next);
        return next;
    }
    async pull(namespace, key, predicate) {
        const current = (await this.get(namespace, key)) ?? [];
        if (!Array.isArray(current)) throw new Error('Value is not an array');
        const next = current.filter(item => !predicate(item));
        await this.set(namespace, key, next);
        return next;
    }
    async update(namespace, key, updater, defaultValue = {}) {
        const current = (await this.get(namespace, key)) ?? defaultValue;
        const next = await updater(current);
        await this.set(namespace, key, next);
        return next;
    }
    async getOrSet(namespace, key, factory, ttl) {
        const existing = await this.get(namespace, key);
        if (existing !== null && existing !== undefined) return existing;
        const value = typeof factory === 'function' ? await factory() : factory;
        await this.set(namespace, key, value, ttl);
        return value;
    }
    async size(namespace) {
        const k = await this.keys(namespace);
        return k.length;
    }
    async toObject(namespace) {
        const entries = await this.entries(namespace);
        return Object.fromEntries(entries);
    }
    async fromObject(namespace, obj, ttl) {
        await this.setMany(namespace, Object.entries(obj), ttl);
    }
}

class JsonStorageAdapter extends BaseStorageAdapter {
    constructor(opts = {}) {
        super();
        this._filePath = opts.filePath ?? opts.path ?? './shiver-data.json';
        this._data = {};
        this._ttlMap = {};
        this._loaded = false;
        this._saveDebounce = null;
        this._saveDelay = opts.saveDelay ?? 500;
    }

    async _load() {
        if (this._loaded) return;
        try {
            const raw = fs.readFileSync(this._filePath, 'utf8');
            const parsed = JSON.parse(raw);
            this._data = parsed.data ?? {};
            this._ttlMap = parsed.ttl ?? {};
        } catch (_) {
            this._data = {};
            this._ttlMap = {};
        }
        this._loaded = true;
    }

    _scheduleSave() {
        if (this._saveDebounce) clearTimeout(this._saveDebounce);
        this._saveDebounce = setTimeout(() => this._persist(), this._saveDelay);
    }

    _persist() {
        const dir = path.dirname(this._filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this._filePath, JSON.stringify({ data: this._data, ttl: this._ttlMap }, null, 2));
    }

    _isExpired(namespace, key) {
        const expiry = this._ttlMap[namespace]?.[key];
        if (!expiry) return false;
        if (Date.now() > expiry) {
            delete this._data[namespace]?.[key];
            delete this._ttlMap[namespace]?.[key];
            return true;
        }
        return false;
    }

    async get(namespace, key) {
        await this._load();
        if (this._isExpired(namespace, key)) return null;
        return this._data[namespace]?.[key] ?? null;
    }

    async set(namespace, key, value, ttl) {
        await this._load();
        if (!this._data[namespace]) this._data[namespace] = {};
        this._data[namespace][key] = value;
        if (ttl) {
            if (!this._ttlMap[namespace]) this._ttlMap[namespace] = {};
            this._ttlMap[namespace][key] = Date.now() + ttl;
        }
        this._scheduleSave();
    }

    async delete(namespace, key) {
        await this._load();
        if (this._data[namespace]) delete this._data[namespace][key];
        if (this._ttlMap[namespace]) delete this._ttlMap[namespace][key];
        this._scheduleSave();
    }

    async has(namespace, key) {
        await this._load();
        if (this._isExpired(namespace, key)) return false;
        return key in (this._data[namespace] ?? {});
    }

    async keys(namespace) {
        await this._load();
        const ns = this._data[namespace] ?? {};
        return Object.keys(ns).filter(k => !this._isExpired(namespace, k));
    }

    async values(namespace) {
        await this._load();
        const ns = this._data[namespace] ?? {};
        return Object.entries(ns)
            .filter(([k]) => !this._isExpired(namespace, k))
            .map(([, v]) => v);
    }

    async entries(namespace) {
        await this._load();
        const ns = this._data[namespace] ?? {};
        return Object.entries(ns).filter(([k]) => !this._isExpired(namespace, k));
    }

    async clear(namespace) {
        await this._load();
        if (namespace) {
            delete this._data[namespace];
            delete this._ttlMap[namespace];
        } else {
            this._data = {};
            this._ttlMap = {};
        }
        this._scheduleSave();
    }
}

class MemoryStorageAdapter extends BaseStorageAdapter {
    constructor() {
        super();
        this._data = new Map();
        this._ttl = new Map();
    }

    _key(namespace, key) { return `${namespace}:${key}`; }

    _isExpired(namespace, key) {
        const k = this._key(namespace, key);
        const expiry = this._ttl.get(k);
        if (!expiry) return false;
        if (Date.now() > expiry) {
            this._data.delete(k);
            this._ttl.delete(k);
            return true;
        }
        return false;
    }

    async get(namespace, key) {
        if (this._isExpired(namespace, key)) return null;
        return this._data.get(this._key(namespace, key)) ?? null;
    }

    async set(namespace, key, value, ttl) {
        const k = this._key(namespace, key);
        this._data.set(k, value);
        if (ttl) this._ttl.set(k, Date.now() + ttl);
        else this._ttl.delete(k);
    }

    async delete(namespace, key) {
        const k = this._key(namespace, key);
        this._data.delete(k);
        this._ttl.delete(k);
    }

    async has(namespace, key) {
        if (this._isExpired(namespace, key)) return false;
        return this._data.has(this._key(namespace, key));
    }

    async keys(namespace) {
        const prefix = `${namespace}:`;
        return [...this._data.keys()]
            .filter(k => k.startsWith(prefix) && !this._isExpiredByFullKey(k))
            .map(k => k.slice(prefix.length));
    }

    _isExpiredByFullKey(fullKey) {
        const expiry = this._ttl.get(fullKey);
        if (!expiry) return false;
        if (Date.now() > expiry) {
            this._data.delete(fullKey);
            this._ttl.delete(fullKey);
            return true;
        }
        return false;
    }

    async values(namespace) {
        const prefix = `${namespace}:`;
        return [...this._data.entries()]
            .filter(([k]) => k.startsWith(prefix) && !this._isExpiredByFullKey(k))
            .map(([, v]) => v);
    }

    async entries(namespace) {
        const prefix = `${namespace}:`;
        return [...this._data.entries()]
            .filter(([k]) => k.startsWith(prefix) && !this._isExpiredByFullKey(k))
            .map(([k, v]) => [k.slice(prefix.length), v]);
    }

    async clear(namespace) {
        if (namespace) {
            const prefix = `${namespace}:`;
            for (const k of [...this._data.keys()]) {
                if (k.startsWith(prefix)) { this._data.delete(k); this._ttl.delete(k); }
            }
        } else {
            this._data.clear();
            this._ttl.clear();
        }
    }
}

class MongoStorageAdapter extends BaseStorageAdapter {
    constructor(opts = {}) {
        super();
        this._uri = opts.uri;
        this._dbName = opts.database ?? 'shiver';
        this._collectionName = opts.collection ?? 'storage';
        this._client = null;
        this._collection = null;
        this._ttlIndexCreated = false;
    }

    async _connect() {
        if (this._collection) return;
        const { MongoClient } = require('mongodb');
        this._client = new MongoClient(this._uri);
        await this._client.connect();
        const db = this._client.db(this._dbName);
        this._collection = db.collection(this._collectionName);
        if (!this._ttlIndexCreated) {
            await this._collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
            this._ttlIndexCreated = true;
        }
    }

    async get(namespace, key) {
        await this._connect();
        const doc = await this._collection.findOne({ namespace, key });
        if (!doc) return null;
        if (doc.expiresAt && doc.expiresAt < new Date()) {
            await this._collection.deleteOne({ namespace, key });
            return null;
        }
        return doc.value;
    }

    async set(namespace, key, value, ttl) {
        await this._connect();
        const doc = { namespace, key, value };
        if (ttl) doc.expiresAt = new Date(Date.now() + ttl);
        await this._collection.replaceOne({ namespace, key }, doc, { upsert: true });
    }

    async delete(namespace, key) {
        await this._connect();
        await this._collection.deleteOne({ namespace, key });
    }

    async has(namespace, key) {
        await this._connect();
        const count = await this._collection.countDocuments({ namespace, key });
        return count > 0;
    }

    async keys(namespace) {
        await this._connect();
        const docs = await this._collection.find({ namespace }, { projection: { key: 1 } }).toArray();
        return docs.map(d => d.key);
    }

    async values(namespace) {
        await this._connect();
        const docs = await this._collection.find({ namespace }, { projection: { value: 1 } }).toArray();
        return docs.map(d => d.value);
    }

    async entries(namespace) {
        await this._connect();
        const docs = await this._collection.find({ namespace }).toArray();
        return docs.map(d => [d.key, d.value]);
    }

    async clear(namespace) {
        await this._connect();
        if (namespace) {
            await this._collection.deleteMany({ namespace });
        } else {
            await this._collection.deleteMany({});
        }
    }

    async close() {
        if (this._client) await this._client.close();
    }
}

class SupabaseStorageAdapter extends BaseStorageAdapter {
    constructor(opts = {}) {
        super();
        this._url = opts.url;
        this._key = opts.key;
        this._table = opts.table ?? 'shiver_storage';
        this._client = null;
    }

    _getClient() {
        if (this._client) return this._client;
        const { createClient } = require('@supabase/supabase-js');
        this._client = createClient(this._url, this._key);
        return this._client;
    }

    async get(namespace, key) {
        const sb = this._getClient();
        const { data, error } = await sb.from(this._table)
            .select('value, expires_at')
            .eq('namespace', namespace)
            .eq('key', key)
            .maybeSingle();
        if (error || !data) return null;
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
            await this.delete(namespace, key);
            return null;
        }
        return data.value;
    }

    async set(namespace, key, value, ttl) {
        const sb = this._getClient();
        const record = { namespace, key, value: JSON.stringify(value) };
        if (ttl) record.expires_at = new Date(Date.now() + ttl).toISOString();
        await sb.from(this._table).upsert(record, { onConflict: 'namespace,key' });
    }

    async delete(namespace, key) {
        const sb = this._getClient();
        await sb.from(this._table).delete().eq('namespace', namespace).eq('key', key);
    }

    async has(namespace, key) {
        const val = await this.get(namespace, key);
        return val !== null;
    }

    async keys(namespace) {
        const sb = this._getClient();
        const { data } = await sb.from(this._table).select('key').eq('namespace', namespace);
        return (data ?? []).map(d => d.key);
    }

    async values(namespace) {
        const sb = this._getClient();
        const { data } = await sb.from(this._table).select('value').eq('namespace', namespace);
        return (data ?? []).map(d => {
            try { return JSON.parse(d.value); } catch (_) { return d.value; }
        });
    }

    async entries(namespace) {
        const sb = this._getClient();
        const { data } = await sb.from(this._table).select('key,value').eq('namespace', namespace);
        return (data ?? []).map(d => {
            try { return [d.key, JSON.parse(d.value)]; } catch (_) { return [d.key, d.value]; }
        });
    }

    async clear(namespace) {
        const sb = this._getClient();
        if (namespace) {
            await sb.from(this._table).delete().eq('namespace', namespace);
        } else {
            await sb.from(this._table).delete().neq('namespace', '');
        }
    }
}

class SqliteStorageAdapter extends BaseStorageAdapter {
    constructor(opts = {}) {
        super();
        this._dbPath = opts.path ?? './shiver.db';
        this._db = null;
    }

    _getDb() {
        if (this._db) return this._db;
        const Database = require('better-sqlite3');
        this._db = new Database(this._dbPath);
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS shiver_storage (
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                expires_at INTEGER,
                PRIMARY KEY (namespace, key)
            )
        `);
        this._db.exec(`CREATE INDEX IF NOT EXISTS idx_ns ON shiver_storage(namespace)`);
        return this._db;
    }

    _isExpiredRow(row) {
        if (!row) return true;
        if (row.expires_at && Date.now() > row.expires_at) {
            this._getDb().prepare('DELETE FROM shiver_storage WHERE namespace=? AND key=?')
                .run(row.namespace, row.key);
            return true;
        }
        return false;
    }

    async get(namespace, key) {
        const row = this._getDb().prepare('SELECT * FROM shiver_storage WHERE namespace=? AND key=?').get(namespace, key);
        if (!row || this._isExpiredRow(row)) return null;
        try { return JSON.parse(row.value); } catch (_) { return row.value; }
    }

    async set(namespace, key, value, ttl) {
        const serialized = JSON.stringify(value);
        const expiresAt = ttl ? Date.now() + ttl : null;
        this._getDb().prepare(
            'INSERT OR REPLACE INTO shiver_storage (namespace, key, value, expires_at) VALUES (?,?,?,?)'
        ).run(namespace, key, serialized, expiresAt);
    }

    async delete(namespace, key) {
        this._getDb().prepare('DELETE FROM shiver_storage WHERE namespace=? AND key=?').run(namespace, key);
    }

    async has(namespace, key) {
        const row = this._getDb().prepare('SELECT expires_at FROM shiver_storage WHERE namespace=? AND key=?').get(namespace, key);
        if (!row) return false;
        if (row.expires_at && Date.now() > row.expires_at) {
            await this.delete(namespace, key);
            return false;
        }
        return true;
    }

    async keys(namespace) {
        const rows = this._getDb().prepare('SELECT key, expires_at FROM shiver_storage WHERE namespace=?').all(namespace);
        return rows.filter(r => !r.expires_at || Date.now() <= r.expires_at).map(r => r.key);
    }

    async values(namespace) {
        const rows = this._getDb().prepare('SELECT value, expires_at FROM shiver_storage WHERE namespace=?').all(namespace);
        return rows
            .filter(r => !r.expires_at || Date.now() <= r.expires_at)
            .map(r => { try { return JSON.parse(r.value); } catch (_) { return r.value; } });
    }

    async entries(namespace) {
        const rows = this._getDb().prepare('SELECT key, value, expires_at FROM shiver_storage WHERE namespace=?').all(namespace);
        return rows
            .filter(r => !r.expires_at || Date.now() <= r.expires_at)
            .map(r => {
                try { return [r.key, JSON.parse(r.value)]; } catch (_) { return [r.key, r.value]; }
            });
    }

    async clear(namespace) {
        if (namespace) {
            this._getDb().prepare('DELETE FROM shiver_storage WHERE namespace=?').run(namespace);
        } else {
            this._getDb().prepare('DELETE FROM shiver_storage').run();
        }
    }

    async vacuum() {
        this._getDb().prepare('DELETE FROM shiver_storage WHERE expires_at IS NOT NULL AND expires_at < ?').run(Date.now());
        this._getDb().exec('VACUUM');
    }

    close() {
        if (this._db) { this._db.close(); this._db = null; }
    }
}

function createStorageAdapter(type, opts = {}) {
    switch (type) {
        case 'json': return new JsonStorageAdapter(opts);
        case 'memory': return new MemoryStorageAdapter();
        case 'mongo':
        case 'mongodb': return new MongoStorageAdapter(opts);
        case 'supabase': return new SupabaseStorageAdapter(opts);
        case 'sqlite': return new SqliteStorageAdapter(opts);
        default: throw new Error(`Unknown storage adapter type: ${type}`);
    }
}

module.exports = {
    BaseStorageAdapter, JsonStorageAdapter, MemoryStorageAdapter,
    MongoStorageAdapter, SupabaseStorageAdapter, SqliteStorageAdapter,
    createStorageAdapter
};
