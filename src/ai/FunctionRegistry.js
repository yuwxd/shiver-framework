class FunctionRegistry {
    constructor() {
        this._functions = new Map();
    }

    register(name, description, parameters, handler) {
        this._functions.set(name, { name, description, parameters, handler });
        return this;
    }

    registerFromCommand(command) {
        if (!command?.data) return this;
        const json = typeof command.data.toJSON === 'function' ? command.data.toJSON() : command.data;
        const name = json.name;
        const description = json.description ?? `Execute the ${name} command`;
        const properties = {};
        const required = [];

        for (const opt of (json.options ?? [])) {
            properties[opt.name] = {
                type: _discordTypeToJsonSchema(opt.type),
                description: opt.description ?? opt.name
            };
            if (opt.required) required.push(opt.name);
        }

        const parameters = {
            type: 'object',
            properties,
            required
        };

        this.register(name, description, parameters, command.executeSlash ?? null);
        return this;
    }

    registerAllFromCommands(commands) {
        for (const cmd of commands) this.registerFromCommand(cmd);
        return this;
    }

    async call(name, args = {}) {
        const fn = this._functions.get(name);
        if (!fn) throw new Error(`Function "${name}" not registered`);
        if (typeof fn.handler !== 'function') throw new Error(`Function "${name}" has no handler`);
        return fn.handler(args);
    }

    exportSchema() {
        return [...this._functions.values()].map(({ name, description, parameters }) => ({
            name,
            description,
            parameters
        }));
    }

    exportOpenAITools() {
        return this.exportSchema().map(fn => ({
            type: 'function',
            function: fn
        }));
    }

    exportAnthropicTools() {
        return this.exportSchema().map(({ name, description, parameters }) => ({
            name,
            description,
            input_schema: parameters
        }));
    }

    toJSON() {
        return JSON.stringify(this.exportSchema(), null, 2);
    }

    has(name) {
        return this._functions.has(name);
    }

    list() {
        return [...this._functions.keys()];
    }
}

function _discordTypeToJsonSchema(type) {
    const map = { 3: 'string', 4: 'integer', 5: 'boolean', 6: 'string', 7: 'string', 8: 'string', 10: 'number' };
    return map[type] ?? 'string';
}

module.exports = { FunctionRegistry };
