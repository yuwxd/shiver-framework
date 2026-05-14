function localizeCommand(commandData, i18n, locales = []) {
    if (!commandData || !i18n || locales.length === 0) return commandData;

    const json = typeof commandData.toJSON === 'function' ? commandData.toJSON() : commandData;
    const name = json.name;

    const nameLocalizations = {};
    const descLocalizations = {};

    for (const locale of locales) {
        const localeName = i18n.t(locale, `commands.${name}.name`);
        const localeDesc = i18n.t(locale, `commands.${name}.description`);
        if (localeName && localeName !== `commands.${name}.name`) nameLocalizations[locale] = localeName;
        if (localeDesc && localeDesc !== `commands.${name}.description`) descLocalizations[locale] = localeDesc;
    }

    if (Object.keys(nameLocalizations).length > 0) json.nameLocalizations = nameLocalizations;
    if (Object.keys(descLocalizations).length > 0) json.descriptionLocalizations = descLocalizations;

    if (Array.isArray(json.options)) {
        for (const opt of json.options) {
            _localizeOption(opt, name, i18n, locales);
        }
    }

    return json;
}

function _localizeOption(opt, commandName, i18n, locales) {
    const key = `commands.${commandName}.options.${opt.name}`;
    const nameLocalizations = {};
    const descLocalizations = {};

    for (const locale of locales) {
        const n = i18n.t(locale, `${key}.name`);
        const d = i18n.t(locale, `${key}.description`);
        if (n && n !== `${key}.name`) nameLocalizations[locale] = n;
        if (d && d !== `${key}.description`) descLocalizations[locale] = d;
    }

    if (Object.keys(nameLocalizations).length > 0) opt.nameLocalizations = nameLocalizations;
    if (Object.keys(descLocalizations).length > 0) opt.descriptionLocalizations = descLocalizations;

    if (Array.isArray(opt.options)) {
        for (const sub of opt.options) _localizeOption(sub, commandName, i18n, locales);
    }
}

function localizeAll(commands, i18n, locales = []) {
    return commands.map(cmd => ({
        ...cmd,
        data: localizeCommand(cmd.data, i18n, locales)
    }));
}

module.exports = { localizeCommand, localizeAll };
