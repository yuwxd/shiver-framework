const { ComponentType, ButtonStyle, MessageFlags } = require('discord.js');
const { buildConfirmContainerV2, textDisplay, separator, actionRow, button, container } = require('../components/v2/builders');

class ConfirmationSession {
    constructor(interaction, opts = {}) {
        this._interaction = interaction;
        this._userId = interaction.user?.id ?? interaction.author?.id;
        this._timeout = opts.timeout ?? 30000;
        this._ephemeral = opts.ephemeral ?? true;
        this._title = opts.title ?? 'Confirmation Required';
        this._description = opts.description ?? 'Are you sure you want to proceed?';
        this._confirmLabel = opts.confirmLabel ?? 'Confirm';
        this._cancelLabel = opts.cancelLabel ?? 'Cancel';
        this._confirmStyle = opts.confirmStyle ?? ButtonStyle.Success;
        this._cancelStyle = opts.cancelStyle ?? ButtonStyle.Danger;
        this._color = opts.color ?? 0x5865F2;
        this._dangerColor = opts.dangerColor ?? 0xFF0000;
        this._style = opts.style ?? 'v2';
        this._allowOthers = opts.allowOthers ?? false;
        this._deleteOnEnd = opts.deleteOnEnd ?? false;
        this._disableOnEnd = opts.disableOnEnd ?? true;
        this._prefix = `confirm_${this._userId}_${Date.now()}`;
        this._message = null;
        this._collector = null;
    }

    _buildPayload(opts = {}) {
        const isV2 = this._style === 'v2';
        const components = [];

        if (isV2) {
            if (this._title) components.push(textDisplay(`**${this._title}**`));
            if (this._description) {
                if (this._title) components.push(separator());
                components.push(textDisplay(this._description));
            }
        }

        const buttons = actionRow([
            button({
                customId: `${this._prefix}_yes`,
                label: this._confirmLabel,
                style: this._confirmStyle,
                disabled: opts.disabled ?? false
            }),
            button({
                customId: `${this._prefix}_no`,
                label: this._cancelLabel,
                style: this._cancelStyle,
                disabled: opts.disabled ?? false
            })
        ]);

        if (isV2) {
            return {
                components: [container(this._color, components), buttons],
                flags: MessageFlags.IsComponentsV2
            };
        }

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setColor(this._color)
            .setTitle(this._title)
            .setDescription(this._description);
        return { embeds: [embed], components: [buttons] };
    }

    async prompt() {
        return new Promise(async (resolve) => {
            const payload = this._buildPayload();
            if (this._ephemeral) {
                if (payload.flags !== undefined) {
                    payload.flags = payload.flags | MessageFlags.Ephemeral;
                } else {
                    payload.flags = MessageFlags.Ephemeral;
                }
            }

            try {
                if (this._interaction.deferred || this._interaction.replied) {
                    this._message = await this._interaction.editReply({ ...payload, fetchReply: true });
                } else {
                    this._message = await this._interaction.reply({ ...payload, fetchReply: true });
                }
            } catch (e) {
                resolve({ confirmed: false, reason: 'send_failed', error: e });
                return;
            }

            this._collector = this._message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: this._timeout,
                filter: (i) => {
                    return i.customId.startsWith(this._prefix);
                }
            });

            this._collector.on('collect', async (i) => {
                if (!this._allowOthers && i.user?.id !== this._userId) {
                    await i.reply({ content: 'This confirmation does not belong to you.', flags: MessageFlags.Ephemeral }).catch(() => {});
                    return;
                }
                const action = i.customId.replace(`${this._prefix}_`, '');
                await i.deferUpdate().catch(() => {});
                this._collector.stop(action);
            });

            this._collector.on('end', async (_, reason) => {
                const confirmed = reason === 'yes';
                const cancelled = reason === 'no';
                const timedOut = !confirmed && !cancelled;

                if (this._deleteOnEnd) {
                    await this._interaction.deleteReply().catch(() => {});
                } else if (this._disableOnEnd) {
                    const disabledPayload = this._buildPayload({ disabled: true });
                    await this._interaction.editReply(disabledPayload).catch(() => {});
                }

                resolve({
                    confirmed,
                    cancelled,
                    timedOut,
                    reason
                });
            });
        });
    }

    cancel() {
        this._collector?.stop('cancelled');
        return this;
    }
}

async function confirm(interaction, opts = {}) {
    const session = new ConfirmationSession(interaction, opts);
    return session.prompt();
}

async function confirmDangerous(interaction, opts = {}) {
    return confirm(interaction, {
        confirmStyle: ButtonStyle.Danger,
        cancelStyle: ButtonStyle.Secondary,
        color: 0xFF0000,
        ...opts
    });
}

module.exports = { ConfirmationSession, confirm, confirmDangerous };
