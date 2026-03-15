const { ComponentType, ButtonStyle, MessageFlags } = require('discord.js');

function textDisplay(content) {
    return { type: ComponentType.TextDisplay, content: String(content) };
}

function separator(opts = {}) {
    return {
        type: ComponentType.Separator,
        divider: opts.divider ?? true,
        spacing: opts.spacing ?? 1
    };
}

function mediaGallery(items) {
    const normalized = items.map(item => {
        if (typeof item === 'string') return { media: { url: item } };
        if (item.url) return { media: { url: item.url }, description: item.description, spoiler: item.spoiler };
        return item;
    });
    return { type: ComponentType.MediaGallery, items: normalized };
}

function thumbnail(url, opts = {}) {
    return {
        type: ComponentType.Thumbnail,
        media: { url },
        description: opts.description ?? undefined,
        spoiler: opts.spoiler ?? false
    };
}

function fileComponent(url, opts = {}) {
    return {
        type: ComponentType.File,
        file: { url },
        spoiler: opts.spoiler ?? false
    };
}

function actionRow(components) {
    return { type: ComponentType.ActionRow, components };
}

function button(opts) {
    const btn = {
        type: ComponentType.Button,
        style: opts.style ?? ButtonStyle.Primary,
        label: opts.label ?? undefined,
        emoji: opts.emoji ?? undefined,
        custom_id: opts.customId ?? opts.custom_id ?? undefined,
        url: opts.url ?? undefined,
        disabled: opts.disabled ?? false
    };
    if (!btn.label && !btn.emoji) btn.label = 'Button';
    return btn;
}

function selectMenu(opts) {
    return {
        type: opts.type ?? ComponentType.StringSelect,
        custom_id: opts.customId ?? opts.custom_id,
        placeholder: opts.placeholder ?? undefined,
        min_values: opts.minValues ?? 1,
        max_values: opts.maxValues ?? 1,
        disabled: opts.disabled ?? false,
        options: opts.options ?? []
    };
}

function container(accentColor, components, opts = {}) {
    const comp = {
        type: ComponentType.Container,
        components: Array.isArray(components) ? components : [components],
        accent_color: accentColor ?? undefined,
        spoiler: opts.spoiler ?? false
    };
    return comp;
}

function section(components, accessory) {
    const sec = {
        type: ComponentType.Section,
        components: Array.isArray(components) ? components : [components]
    };
    if (accessory) sec.accessory = accessory;
    return sec;
}

function buildMessageContainerV2(accentColor, content, opts = {}) {
    const components = Array.isArray(content) ? content : [textDisplay(content)];
    return {
        components: [container(accentColor, components, opts)],
        flags: MessageFlags.IsComponentsV2
    };
}

function buildEmbedLikeV2(opts = {}) {
    const components = [];
    if (opts.title) components.push(textDisplay(`**${opts.title}**`));
    if (opts.title && opts.description) components.push(separator());
    if (opts.description) components.push(textDisplay(opts.description));
    if (opts.fields && opts.fields.length > 0) {
        components.push(separator());
        for (const field of opts.fields) {
            components.push(textDisplay(`**${field.name}**\n${field.value}`));
        }
    }
    if (opts.image) {
        components.push(separator());
        components.push(mediaGallery([opts.image]));
    }
    if (opts.footer) {
        components.push(separator());
        components.push(textDisplay(opts.footer));
    }
    return buildMessageContainerV2(opts.color ?? null, components);
}

function buildChartComponentsV2(opts = {}) {
    const { title, content, mediaUrl, footer, color } = opts;
    const components = [];
    if (title) components.push(textDisplay(title));
    if (content) {
        if (title) components.push(separator());
        components.push(textDisplay(content));
    }
    if (mediaUrl) {
        components.push(separator());
        components.push(mediaGallery([mediaUrl]));
    }
    if (footer) {
        components.push(separator());
        components.push(textDisplay(footer));
    }
    return buildMessageContainerV2(color ?? null, components);
}

function buildPaginatedContainerV2(opts = {}) {
    const { color, title, content, currentPage, totalPages, customIdPrefix, userId } = opts;
    const components = [];
    if (title) components.push(textDisplay(title));
    if (content) {
        if (title) components.push(separator());
        components.push(textDisplay(content));
    }
    components.push(separator());
    components.push(textDisplay(`Page ${currentPage} of ${totalPages}`));

    const prefix = customIdPrefix ?? 'paginate';
    const uid = userId ?? '0';
    const buttons = [];

    if (totalPages > 1) {
        buttons.push(button({
            customId: `${prefix}_first_${uid}`,
            label: '«',
            style: ButtonStyle.Secondary,
            disabled: currentPage <= 1
        }));
        buttons.push(button({
            customId: `${prefix}_prev_${uid}`,
            label: '‹',
            style: ButtonStyle.Primary,
            disabled: currentPage <= 1
        }));
        buttons.push(button({
            customId: `${prefix}_next_${uid}`,
            label: '›',
            style: ButtonStyle.Primary,
            disabled: currentPage >= totalPages
        }));
        buttons.push(button({
            customId: `${prefix}_last_${uid}`,
            label: '»',
            style: ButtonStyle.Secondary,
            disabled: currentPage >= totalPages
        }));
    }

    const result = {
        components: [container(color ?? null, components)],
        flags: MessageFlags.IsComponentsV2
    };

    if (buttons.length > 0) {
        result.components.push(actionRow(buttons));
    }

    return result;
}

function buildConfirmContainerV2(opts = {}) {
    const { color, title, description, confirmLabel, cancelLabel, customIdPrefix, userId } = opts;
    const components = [];
    if (title) components.push(textDisplay(`**${title}**`));
    if (description) {
        if (title) components.push(separator());
        components.push(textDisplay(description));
    }

    const prefix = customIdPrefix ?? 'confirm';
    const uid = userId ?? '0';

    return {
        components: [
            container(color ?? null, components),
            actionRow([
                button({
                    customId: `${prefix}_yes_${uid}`,
                    label: confirmLabel ?? 'Confirm',
                    style: ButtonStyle.Success
                }),
                button({
                    customId: `${prefix}_no_${uid}`,
                    label: cancelLabel ?? 'Cancel',
                    style: ButtonStyle.Danger
                })
            ])
        ],
        flags: MessageFlags.IsComponentsV2
    };
}

function buildErrorV2(message, opts = {}) {
    return buildMessageContainerV2(
        opts.color ?? 0xFF0000,
        [textDisplay(`> **▸ Error**\n> ${message}`)],
        opts
    );
}

function buildWarningV2(message, opts = {}) {
    return buildMessageContainerV2(
        opts.color ?? 0xFFFF00,
        [textDisplay(`> **▸ Warning**\n> ${message}`)],
        opts
    );
}

function buildSuccessV2(message, opts = {}) {
    return buildMessageContainerV2(
        opts.color ?? 0x00FF00,
        [textDisplay(`> **▸ Success**\n> ${message}`)],
        opts
    );
}

function buildInfoV2(message, opts = {}) {
    return buildMessageContainerV2(
        opts.color ?? 0x5865F2,
        [textDisplay(`> **▸ Info**\n> ${message}`)],
        opts
    );
}

function buildListV2(title, items, opts = {}) {
    const components = [];
    if (title) components.push(textDisplay(`**${title}**`));
    if (items.length > 0) {
        if (title) components.push(separator());
        components.push(textDisplay(items.map((item, i) => `${i + 1}. ${item}`).join('\n')));
    }
    return buildMessageContainerV2(opts.color ?? null, components, opts);
}

function buildFieldsV2(title, fields, opts = {}) {
    const components = [];
    if (title) components.push(textDisplay(`**${title}**`));
    if (fields.length > 0) {
        if (title) components.push(separator());
        const fieldText = fields.map(f => `**${f.name}**\n${f.value}`).join('\n\n');
        components.push(textDisplay(fieldText));
    }
    return buildMessageContainerV2(opts.color ?? null, components, opts);
}

module.exports = {
    textDisplay, separator, mediaGallery, thumbnail, fileComponent,
    actionRow, button, selectMenu, container, section,
    buildMessageContainerV2, buildEmbedLikeV2, buildChartComponentsV2,
    buildPaginatedContainerV2, buildConfirmContainerV2,
    buildErrorV2, buildWarningV2, buildSuccessV2, buildInfoV2,
    buildListV2, buildFieldsV2
};
