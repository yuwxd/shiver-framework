const { LIMITS } = require('../config/LIMITS');

function safeEmbed(embed, opts = {}) {
    const throwMode = opts.strict ?? false;
    const e = { ...embed };

    if (e.title && e.title.length > LIMITS.embed.title) {
        if (throwMode) throw new Error(`Embed title exceeds ${LIMITS.embed.title} chars`);
        e.title = e.title.slice(0, LIMITS.embed.title);
    }
    if (e.description && e.description.length > LIMITS.embed.description) {
        if (throwMode) throw new Error(`Embed description exceeds ${LIMITS.embed.description} chars`);
        e.description = e.description.slice(0, LIMITS.embed.description);
    }
    if (e.footer?.text && e.footer.text.length > LIMITS.embed.footer) {
        if (throwMode) throw new Error(`Embed footer exceeds ${LIMITS.embed.footer} chars`);
        e.footer = { ...e.footer, text: e.footer.text.slice(0, LIMITS.embed.footer) };
    }
    if (e.author?.name && e.author.name.length > LIMITS.embed.authorName) {
        if (throwMode) throw new Error(`Embed author name exceeds ${LIMITS.embed.authorName} chars`);
        e.author = { ...e.author, name: e.author.name.slice(0, LIMITS.embed.authorName) };
    }
    if (Array.isArray(e.fields)) {
        if (e.fields.length > LIMITS.embed.fields) {
            if (throwMode) throw new Error(`Embed has more than ${LIMITS.embed.fields} fields`);
            e.fields = e.fields.slice(0, LIMITS.embed.fields);
        }
        e.fields = e.fields.map(f => ({
            ...f,
            name: (f.name || '').slice(0, LIMITS.embed.fieldName) || '\u200b',
            value: (f.value || '').slice(0, LIMITS.embed.fieldValue) || '\u200b'
        }));
    }
    return e;
}

function safeComponents(components, opts = {}) {
    const throwMode = opts.strict ?? false;
    if (!Array.isArray(components)) return components;
    if (components.length > LIMITS.components.actionRows) {
        if (throwMode) throw new Error(`More than ${LIMITS.components.actionRows} action rows`);
        components = components.slice(0, LIMITS.components.actionRows);
    }
    return components.map(row => {
        if (!row?.components) return row;
        const comps = row.components.slice(0, LIMITS.components.buttonsPerRow);
        return { ...row, components: comps };
    });
}

function safeContainer(container, opts = {}) {
    const throwMode = opts.strict ?? false;
    if (!container?.components) return container;

    let comps = container.components;
    if (comps.length > LIMITS.componentsV2.maxComponents) {
        if (throwMode) throw new Error(`Container has more than ${LIMITS.componentsV2.maxComponents} components`);
        comps = comps.slice(0, LIMITS.componentsV2.maxComponents);
    }

    let totalChars = 0;
    const safeComps = [];
    for (const comp of comps) {
        if (comp.content) {
            const remaining = LIMITS.componentsV2.maxTextChars - totalChars;
            if (remaining <= 0) {
                if (throwMode) throw new Error(`Container text exceeds ${LIMITS.componentsV2.maxTextChars} chars`);
                break;
            }
            const text = comp.content.slice(0, remaining);
            totalChars += text.length;
            safeComps.push({ ...comp, content: text });
        } else {
            safeComps.push(comp);
        }
    }

    return { ...container, components: safeComps };
}

function safeFiles(files, opts = {}) {
    const throwMode = opts.strict ?? false;
    if (!Array.isArray(files)) return files;

    if (files.length > LIMITS.files.maxFiles) {
        if (throwMode) throw new Error(`More than ${LIMITS.files.maxFiles} files`);
        files = files.slice(0, LIMITS.files.maxFiles);
    }

    const maxBytes = LIMITS.files.maxSizeMb * 1024 * 1024;
    return files.filter(f => {
        const size = f?.attachment?.length ?? f?.size ?? 0;
        if (size > maxBytes) {
            if (throwMode) throw new Error(`File exceeds ${LIMITS.files.maxSizeMb}MB`);
            return false;
        }
        return true;
    });
}

module.exports = { safeEmbed, safeComponents, safeContainer, safeFiles };
