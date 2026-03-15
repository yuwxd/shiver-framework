class BaseListener {
    constructor(event, opts = {}) {
        this.event = event;
        this.name = opts.name ?? event;
        this.once = opts.once ?? false;
        this.enabled = opts.enabled ?? true;
        this.priority = opts.priority ?? 0;
        this._store = null;
        this._framework = null;
    }

    get store() { return this._store; }
    get framework() { return this._framework; }
    get client() { return this._framework?._client ?? null; }
    get container() { return this._framework?.container ?? null; }

    async run(...args) {
        throw new Error(`Listener "${this.name}" does not implement run()`);
    }

    toJSON() {
        return {
            name: this.name,
            event: this.event,
            once: this.once,
            enabled: this.enabled,
            priority: this.priority
        };
    }
}

module.exports = { BaseListener };
