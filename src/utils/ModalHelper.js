const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { LIMITS } = require('../config/LIMITS');

class ModalHelper {
    build({ title, customId, fields = [] }) {
        const modal = new ModalBuilder()
            .setTitle(title.slice(0, LIMITS.modal.title))
            .setCustomId(customId.slice(0, LIMITS.customId));

        const rows = fields.slice(0, LIMITS.modal.maxComponents).map(field => {
            const input = new TextInputBuilder()
                .setCustomId(field.customId)
                .setLabel(field.label.slice(0, LIMITS.modal.textInputLabel))
                .setStyle(field.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(field.required !== false);

            if (field.placeholder) input.setPlaceholder(field.placeholder.slice(0, 100));
            if (field.value) input.setValue(field.value.slice(0, LIMITS.modal.textInputMax));
            if (field.minLength != null) input.setMinLength(field.minLength);
            if (field.maxLength != null) input.setMaxLength(Math.min(field.maxLength, LIMITS.modal.textInputMax));

            return new ActionRowBuilder().addComponents(input);
        });

        modal.addComponents(...rows);
        return modal;
    }

    validate(interaction, schema = {}) {
        const errors = [];
        for (const [fieldId, rules] of Object.entries(schema)) {
            const value = interaction.fields?.getTextInputValue?.(fieldId) ?? '';
            if (rules.required && !value.trim()) {
                errors.push({ field: fieldId, error: 'required' });
                continue;
            }
            if (rules.minLength && value.length < rules.minLength) {
                errors.push({ field: fieldId, error: 'too_short', min: rules.minLength });
            }
            if (rules.maxLength && value.length > rules.maxLength) {
                errors.push({ field: fieldId, error: 'too_long', max: rules.maxLength });
            }
            if (rules.regex && !rules.regex.test(value)) {
                errors.push({ field: fieldId, error: 'invalid_format' });
            }
        }
        return { valid: errors.length === 0, errors };
    }
}

module.exports = { ModalHelper };
