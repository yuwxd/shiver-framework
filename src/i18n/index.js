const fs = require('fs');
const path = require('path');

class I18n {
    constructor(opts = {}) {
        this._defaultLocale = opts.defaultLocale ?? 'en';
        this._fallbackLocale = opts.fallbackLocale ?? 'en';
        this._locales = new Map();
        this._userLocales = new Map();
        this._guildLocales = new Map();
        this._storage = opts.storage ?? null;
        this._missingKeyHandler = opts.missingKeyHandler ?? null;
        this._interpolationPattern = opts.interpolationPattern ?? /\{\{(\w+)\}\}/g;
        this._pluralRules = new Map();
        this._namespaces = new Set(['common']);
        this._loadedNamespaces = new Map();

        this._setupDefaultPluralRules();

        if (opts.localesDir) {
            this.loadFromDirectory(opts.localesDir);
        }
        if (opts.locales) {
            for (const [locale, data] of Object.entries(opts.locales)) {
                this.addLocale(locale, data);
            }
        }
    }

    _setupDefaultPluralRules() {
        this._pluralRules.set('en', (n) => n === 1 ? 'one' : 'other');
        this._pluralRules.set('pl', (n) => {
            if (n === 1) return 'one';
            if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'few';
            return 'many';
        });
        this._pluralRules.set('ru', (n) => {
            if (n % 10 === 1 && n % 100 !== 11) return 'one';
            if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'few';
            return 'many';
        });
        this._pluralRules.set('de', (n) => n === 1 ? 'one' : 'other');
        this._pluralRules.set('fr', (n) => n <= 1 ? 'one' : 'other');
        this._pluralRules.set('es', (n) => n === 1 ? 'one' : 'other');
        this._pluralRules.set('ja', () => 'other');
        this._pluralRules.set('zh', () => 'other');
        this._pluralRules.set('ko', () => 'other');
        this._pluralRules.set('ar', (n) => {
            if (n === 0) return 'zero';
            if (n === 1) return 'one';
            if (n === 2) return 'two';
            if (n % 100 >= 3 && n % 100 <= 10) return 'few';
            if (n % 100 >= 11 && n % 100 <= 99) return 'many';
            return 'other';
        });
    }

    addLocale(locale, data, namespace = 'common') {
        const key = `${locale}:${namespace}`;
        const existing = this._locales.get(key) ?? {};
        this._locales.set(key, this._deepMerge(existing, data));
        this._namespaces.add(namespace);
        return this;
    }

    _deepMerge(target, source) {
        const result = { ...target };
        for (const [key, value] of Object.entries(source)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                result[key] = this._deepMerge(result[key] ?? {}, value);
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    loadFromDirectory(dir) {
        if (!fs.existsSync(dir)) return this;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const locale = entry.name;
                const localeDir = path.join(dir, locale);
                const files = fs.readdirSync(localeDir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const namespace = path.basename(file, '.json');
                    try {
                        const data = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
                        this.addLocale(locale, data, namespace);
                    } catch (_) {}
                }
            } else if (entry.isFile() && entry.name.endsWith('.json')) {
                const locale = path.basename(entry.name, '.json');
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
                    this.addLocale(locale, data);
                } catch (_) {}
            }
        }
        return this;
    }

    _getNestedValue(obj, key) {
        const parts = key.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            current = current[part];
        }
        return current;
    }

    _interpolate(template, vars) {
        if (!vars || typeof template !== 'string') return template;
        return template.replace(this._interpolationPattern, (match, key) => {
            return vars[key] !== undefined ? String(vars[key]) : match;
        });
    }

    _pluralize(locale, key, count, vars, namespace) {
        const pluralRule = this._pluralRules.get(locale) ?? this._pluralRules.get(this._fallbackLocale) ?? (() => 'other');
        const form = pluralRule(count);
        const pluralKey = `${key}_${form}`;
        const result = this._getRaw(locale, pluralKey, namespace);
        if (result !== undefined) return this._interpolate(result, { ...vars, count });
        const otherKey = `${key}_other`;
        const otherResult = this._getRaw(locale, otherKey, namespace) ?? this._getRaw(locale, key, namespace);
        return this._interpolate(otherResult ?? key, { ...vars, count });
    }

    _getRaw(locale, key, namespace = 'common') {
        const localeKey = `${locale}:${namespace}`;
        const data = this._locales.get(localeKey);
        if (data) {
            const value = this._getNestedValue(data, key);
            if (value !== undefined) return value;
        }
        if (namespace !== 'common') {
            const commonKey = `${locale}:common`;
            const commonData = this._locales.get(commonKey);
            if (commonData) {
                const value = this._getNestedValue(commonData, key);
                if (value !== undefined) return value;
            }
        }
        return undefined;
    }

    t(locale, key, vars, opts = {}) {
        const namespace = opts.namespace ?? 'common';
        const count = vars?.count;

        if (count !== undefined) {
            return this._pluralize(locale, key, count, vars, namespace);
        }

        let result = this._getRaw(locale, key, namespace);

        if (result === undefined && locale !== this._fallbackLocale) {
            result = this._getRaw(this._fallbackLocale, key, namespace);
        }

        if (result === undefined) {
            if (this._missingKeyHandler) {
                return this._missingKeyHandler(locale, key, vars);
            }
            return key;
        }

        return this._interpolate(result, vars);
    }

    translate(locale, key, vars, opts) {
        return this.t(locale, key, vars, opts);
    }

    createTranslator(locale) {
        return (key, vars, opts) => this.t(locale, key, vars, opts);
    }

    async getUserLocale(userId) {
        const cached = this._userLocales.get(userId);
        if (cached) return cached;
        if (this._storage) {
            const stored = await this._storage.get('i18n_user_locales', userId);
            if (stored) {
                this._userLocales.set(userId, stored);
                return stored;
            }
        }
        return this._defaultLocale;
    }

    async setUserLocale(userId, locale) {
        this._userLocales.set(userId, locale);
        if (this._storage) {
            await this._storage.set('i18n_user_locales', userId, locale);
        }
    }

    async getGuildLocale(guildId) {
        const cached = this._guildLocales.get(guildId);
        if (cached) return cached;
        if (this._storage) {
            const stored = await this._storage.get('i18n_guild_locales', guildId);
            if (stored) {
                this._guildLocales.set(guildId, stored);
                return stored;
            }
        }
        return this._defaultLocale;
    }

    async setGuildLocale(guildId, locale) {
        this._guildLocales.set(guildId, locale);
        if (this._storage) {
            await this._storage.set('i18n_guild_locales', guildId, locale);
        }
    }

    async getLocaleForContext(interaction) {
        const userId = interaction.user?.id ?? interaction.author?.id;
        const guildId = interaction.guild?.id;
        const discordLocale = interaction.locale ?? interaction.guildLocale;

        if (userId) {
            const userLocale = await this.getUserLocale(userId);
            if (userLocale !== this._defaultLocale) return userLocale;
        }
        if (guildId) {
            const guildLocale = await this.getGuildLocale(guildId);
            if (guildLocale !== this._defaultLocale) return guildLocale;
        }
        if (discordLocale && this._locales.has(`${discordLocale}:common`)) {
            return discordLocale;
        }
        return this._defaultLocale;
    }

    async tForContext(interaction, key, vars, opts) {
        const locale = await this.getLocaleForContext(interaction);
        return this.t(locale, key, vars, opts);
    }

    getAvailableLocales() {
        const locales = new Set();
        for (const key of this._locales.keys()) {
            locales.add(key.split(':')[0]);
        }
        return [...locales];
    }

    hasLocale(locale) {
        for (const key of this._locales.keys()) {
            if (key.startsWith(`${locale}:`)) return true;
        }
        return false;
    }

    addPluralRule(locale, fn) {
        this._pluralRules.set(locale, fn);
        return this;
    }

    setMissingKeyHandler(fn) {
        this._missingKeyHandler = fn;
        return this;
    }

    setStorage(storage) {
        this._storage = storage;
        return this;
    }
}

module.exports = { I18n };
