class BaseArgument {
    constructor(name, opts = {}) {
        this.name = name;
        this.aliases = opts.aliases ?? [];
        this.description = opts.description ?? '';
        this.required = opts.required ?? false;
        this.default = opts.default ?? undefined;
        this._store = null;
        this._framework = null;
    }

    get store() { return this._store; }
    get framework() { return this._framework; }
    get client() { return this._framework?._client ?? null; }

    async run(parameter, context, opts = {}) {
        throw new Error(`Argument "${this.name}" does not implement run()`);
    }

    ok(value) { return { ok: true, value, error: null }; }
    err(error, value = null) { return { ok: false, value, error }; }

    toJSON() {
        return {
            name: this.name,
            aliases: this.aliases,
            description: this.description,
            required: this.required
        };
    }
}

module.exports = { BaseArgument };
