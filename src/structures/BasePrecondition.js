const { PreconditionResult } = require('../preconditions');

class BasePrecondition {
    constructor(name, opts = {}) {
        this.name = name;
        this.enabled = opts.enabled ?? true;
        this.position = opts.position ?? 'any';
        this._store = null;
        this._framework = null;
    }

    get store() { return this._store; }
    get framework() { return this._framework; }
    get client() { return this._framework?._client ?? null; }
    get container() { return this._framework?.container ?? null; }

    async run(interaction, command, context) {
        throw new Error(`Precondition "${this.name}" does not implement run()`);
    }

    ok() { return PreconditionResult.ok(); }
    err(error) { return PreconditionResult.err(error); }

    toJSON() {
        return { name: this.name, enabled: this.enabled, position: this.position };
    }
}

module.exports = { BasePrecondition };
