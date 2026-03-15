const name = 'i18n';

async function init(framework, options = {}) {
    const messages = options.messages ?? framework.options.i18n?.messages ?? {};
    const defaultLocale = options.defaultLocale ?? framework.options.i18n?.defaultLocale ?? 'en';

    const resolveKey = (key, locale, vars = {}) => {
        const lang = messages[locale] ?? messages[defaultLocale] ?? {};
        let template = lang[key] ?? key;
        for (const [k, v] of Object.entries(vars)) {
            template = template.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
        }
        return template;
    };

    const fetchLanguage = async (userId, guildId) => {
        const settings = framework._settings;
        if (!settings) return defaultLocale;
        const userSettings = await settings.getUser(userId).catch(() => null);
        if (userSettings?.language) return userSettings.language;
        const guildSettings = await settings.getGuild(guildId).catch(() => null);
        if (guildSettings?.language) return guildSettings.language;
        return defaultLocale;
    };

    const i18n = {
        resolveKey,
        fetchLanguage,
        t: resolveKey,
        addMessages(locale, msgs) {
            if (!messages[locale]) messages[locale] = {};
            Object.assign(messages[locale], msgs);
        }
    };

    framework.container.set('i18n', i18n);
    framework.i18n = i18n;
}

module.exports = { name, init };
