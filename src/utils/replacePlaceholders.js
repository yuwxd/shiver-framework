function replacePlaceholders(template, vars = {}) {
    if (typeof template !== 'string') return template;
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        return vars[key] !== undefined ? String(vars[key]) : match;
    });
}

module.exports = { replacePlaceholders };
