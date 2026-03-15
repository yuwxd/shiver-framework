const { safeError } = require('../security/redact');

const _cache = new Map();
const _debounce = new Map();
const _latest = new Map();

function normalizeChoices(choices) {
    if (!Array.isArray(choices)) return [];
    return choices
        .filter(choice => choice && typeof choice === 'object')
        .map(choice => ({
            name: String(choice.name ?? '').slice(0, 100),
            value: typeof choice.value === 'string' ? choice.value : String(choice.value ?? '')
        }))
        .filter(choice => choice.name.length > 0 && choice.value.length > 0)
        .slice(0, 25);
}

class AutocompleteHandler {
    constructor(registry, framework) {
        this._registry = registry;
        this._framework = framework;
    }

    async handle(interaction) {
        if (!interaction.isAutocomplete()) return;

        const command = this._registry.getSlash(interaction.commandName);
        if (!command?.autocomplete && !command?.handleAutocomplete) return;

        const focused = interaction.options.getFocused(true);
        const cacheKey = `${interaction.commandName}:${focused.name}:${focused.value}`;

        const cached = _cache.get(cacheKey);
        if (cached && Date.now() - cached.ts < (this._framework.options?.autocompleteCacheMs ?? 5000)) {
            return interaction.respond(cached.choices).catch(() => {});
        }

        const requestKey = `${interaction.user.id}:${interaction.commandName}:${focused.name}`;
        const requestId = (_latest.get(requestKey) ?? 0) + 1;
        _latest.set(requestKey, requestId);

        const pending = _debounce.get(requestKey);
        if (pending) {
            clearTimeout(pending.timeout);
            pending.resolve();
        }

        const debounceMs = Math.max(0, this._framework.options?.autocompleteDebounceMs ?? 0);

        if (debounceMs > 0) {
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, debounceMs);
                _debounce.set(requestKey, { timeout, resolve });
            });
            const activeDebounce = _debounce.get(requestKey);
            if (activeDebounce && _latest.get(requestKey) === requestId) {
                _debounce.delete(requestKey);
            }
        }

        if (_latest.get(requestKey) !== requestId) {
            return;
        }

        const originalRespond = typeof interaction.respond === 'function'
            ? interaction.respond.bind(interaction)
            : null;
        let responded = false;
        let respondedChoices = [];

        try {
            if (originalRespond) {
                interaction.respond = async (choices) => {
                    responded = true;
                    respondedChoices = normalizeChoices(choices);
                    return originalRespond(respondedChoices).catch(() => {});
                };
            }

            const handler = command.autocomplete || command.handleAutocomplete;
            const choices = await handler(interaction, this._framework.client);
            const limited = responded ? respondedChoices : normalizeChoices(choices);

            if (_latest.get(requestKey) !== requestId) {
                return;
            }

            _cache.set(cacheKey, { choices: limited, ts: Date.now() });
            setTimeout(() => _cache.delete(cacheKey), this._framework.options?.autocompleteCacheMs ?? 5000);

            if (!responded && originalRespond) {
                await originalRespond(limited).catch(() => {});
            }
        } catch (err) {
            safeError('AutocompleteHandler', err);
            if (_latest.get(requestKey) !== requestId) {
                return;
            }
            if (!responded && originalRespond) {
                await originalRespond([]).catch(() => {});
            }
        } finally {
            if (originalRespond) {
                interaction.respond = originalRespond;
            }
            if (_latest.get(requestKey) === requestId) {
                _latest.delete(requestKey);
            }
        }
    }
}

module.exports = { AutocompleteHandler };
