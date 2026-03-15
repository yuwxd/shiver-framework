class Container {
    constructor() {
        this._store = new Map();
    }

    set(key, value) {
        this._store.set(key, value);
        return this;
    }

    get(key) {
        return this._store.get(key);
    }

    has(key) {
        return this._store.has(key);
    }

    delete(key) {
        return this._store.delete(key);
    }

    clear() {
        this._store.clear();
        return this;
    }

    entries() {
        return this._store.entries();
    }
}

module.exports = { Container };
