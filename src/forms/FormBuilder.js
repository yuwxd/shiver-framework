const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

class FormBuilder {
    constructor(title, customId) {
        this._title = title;
        this._customId = customId;
        this._fields = [];
    }

    addField(key, label, opts = {}) {
        this._fields.push({
            key,
            label,
            required: opts.required ?? false,
            minLength: opts.minLength ?? null,
            maxLength: opts.maxLength ?? null,
            placeholder: opts.placeholder ?? null,
            value: opts.value ?? null,
            style: opts.style ?? TextInputStyle.Short,
            regex: opts.regex ?? null,
            validator: opts.validator ?? null
        });
        return this;
    }

    build() {
        const modal = new ModalBuilder()
            .setTitle(this._title)
            .setCustomId(this._customId);

        for (const field of this._fields) {
            const input = new TextInputBuilder()
                .setCustomId(field.key)
                .setLabel(field.label)
                .setStyle(field.style)
                .setRequired(field.required);
            if (field.minLength !== null) input.setMinLength(field.minLength);
            if (field.maxLength !== null) input.setMaxLength(field.maxLength);
            if (field.placeholder) input.setPlaceholder(field.placeholder);
            if (field.value) input.setValue(field.value);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
        }

        return modal;
    }

    parse(interaction) {
        const values = {};
        const errors = [];

        for (const field of this._fields) {
            const raw = interaction.fields.getTextInputValue(field.key) ?? '';
            values[field.key] = raw;

            if (field.required && !raw.trim()) {
                errors.push({ key: field.key, message: `${field.label} is required.` });
                continue;
            }
            if (field.minLength !== null && raw.length < field.minLength) {
                errors.push({ key: field.key, message: `${field.label} must be at least ${field.minLength} characters.` });
                continue;
            }
            if (field.maxLength !== null && raw.length > field.maxLength) {
                errors.push({ key: field.key, message: `${field.label} must be at most ${field.maxLength} characters.` });
                continue;
            }
            if (field.regex && !field.regex.test(raw)) {
                errors.push({ key: field.key, message: `${field.label} has an invalid format.` });
                continue;
            }
            if (typeof field.validator === 'function') {
                const result = field.validator(raw);
                if (result !== true && result) {
                    errors.push({ key: field.key, message: result });
                }
            }
        }

        return { values, errors, ok: errors.length === 0 };
    }
}

module.exports = { FormBuilder };
