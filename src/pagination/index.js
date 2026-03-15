const { ComponentType, ButtonStyle, MessageFlags } = require('discord.js');
const { buildPaginatedContainerV2, textDisplay, separator, actionRow, button, container, selectMenu } = require('../components/v2/builders');

class PaginationSession {
    constructor(interaction, pages, opts = {}) {
        this._interaction = interaction;
        this._pages = pages;
        this._currentPage = opts.startPage ?? 0;
        this._timeout = opts.timeout ?? 120000;
        this._ephemeral = opts.ephemeral ?? false;
        this._userId = interaction.user?.id ?? interaction.author?.id;
        this._color = opts.color ?? null;
        this._showPageNumbers = opts.showPageNumbers ?? true;
        this._showJumpButtons = opts.showJumpButtons ?? true;
        this._showSelectMenu = opts.showSelectMenu ?? false;
        this._selectMenuLabels = opts.selectMenuLabels ?? null;
        this._idleTimeout = opts.idleTimeout ?? null;
        this._collector = null;
        this._message = null;
        this._onPageChange = opts.onPageChange ?? null;
        this._onEnd = opts.onEnd ?? null;
        this._style = opts.style ?? 'v2';
        this._prefix = `paginate_${this._userId}_${Date.now()}`;
    }

    get totalPages() { return this._pages.length; }
    get currentPage() { return this._currentPage; }

    _buildPayload(page) {
        const pageData = this._pages[page];
        const isV2 = this._style === 'v2';

        if (typeof pageData === 'function') {
            return pageData(page, this.totalPages);
        }

        if (isV2) {
            const components = [];
            if (typeof pageData === 'string') {
                components.push(textDisplay(pageData));
            } else if (pageData.content) {
                if (pageData.title) components.push(textDisplay(`**${pageData.title}**`));
                if (pageData.title) components.push(separator());
                components.push(textDisplay(pageData.content));
            } else {
                components.push(textDisplay(JSON.stringify(pageData)));
            }

            if (this._showPageNumbers) {
                components.push(separator());
                components.push(textDisplay(`Page ${page + 1} of ${this.totalPages}`));
            }

            const rows = [container(this._color, components)];
            rows.push(this._buildButtonRow(page));
            if (this._showSelectMenu && this.totalPages <= 25) {
                rows.push(this._buildSelectMenu());
            }

            return { components: rows, flags: MessageFlags.IsComponentsV2 };
        }

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder();
        if (typeof pageData === 'string') {
            embed.setDescription(pageData);
        } else {
            if (pageData.title) embed.setTitle(pageData.title);
            if (pageData.description) embed.setDescription(pageData.description);
            if (pageData.color) embed.setColor(pageData.color);
            if (pageData.fields) embed.addFields(...pageData.fields);
            if (pageData.image) embed.setImage(pageData.image);
            if (pageData.thumbnail) embed.setThumbnail(pageData.thumbnail);
        }
        if (this._showPageNumbers) {
            embed.setFooter({ text: `Page ${page + 1} of ${this.totalPages}` });
        }
        return {
            embeds: [embed],
            components: [this._buildButtonRow(page)]
        };
    }

    _buildButtonRow(page) {
        const buttons = [];
        if (this._showJumpButtons) {
            buttons.push(button({
                customId: `${this._prefix}_first`,
                label: '«',
                style: ButtonStyle.Secondary,
                disabled: page <= 0
            }));
        }
        buttons.push(button({
            customId: `${this._prefix}_prev`,
            label: '‹',
            style: ButtonStyle.Primary,
            disabled: page <= 0
        }));
        buttons.push(button({
            customId: `${this._prefix}_next`,
            label: '›',
            style: ButtonStyle.Primary,
            disabled: page >= this.totalPages - 1
        }));
        if (this._showJumpButtons) {
            buttons.push(button({
                customId: `${this._prefix}_last`,
                label: '»',
                style: ButtonStyle.Secondary,
                disabled: page >= this.totalPages - 1
            }));
        }
        buttons.push(button({
            customId: `${this._prefix}_stop`,
            label: '✕',
            style: ButtonStyle.Danger
        }));
        return actionRow(buttons);
    }

    _buildSelectMenu() {
        const options = this._pages.map((page, i) => {
            const label = this._selectMenuLabels?.[i] ?? `Page ${i + 1}`;
            return { label: label.slice(0, 100), value: String(i), default: i === this._currentPage };
        });
        return actionRow([selectMenu({
            customId: `${this._prefix}_select`,
            placeholder: 'Jump to page...',
            options
        })]);
    }

    async start() {
        const payload = this._buildPayload(this._currentPage);
        const sendOpts = { ...payload, fetchReply: true };
        if (this._ephemeral) {
            sendOpts.flags = (sendOpts.flags ?? 0) | MessageFlags.Ephemeral;
        }

        if (this._interaction.deferred || this._interaction.replied) {
            this._message = await this._interaction.editReply(sendOpts);
        } else {
            this._message = await this._interaction.reply(sendOpts);
        }

        if (this.totalPages <= 1) return this;

        this._collector = this._message.createMessageComponentCollector({
            time: this._timeout,
            idle: this._idleTimeout ?? undefined,
            filter: (i) => i.customId.startsWith(this._prefix)
        });

        this._collector.on('collect', async (i) => {
            const actorId = i.user?.id ?? i.author?.id;
            if (actorId !== this._userId) {
                await i.reply({ content: 'This pagination session does not belong to you.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return;
            }
            const action = i.customId.replace(`${this._prefix}_`, '');
            await i.deferUpdate().catch(() => {});

            if (action === 'stop') {
                this._collector.stop('user');
                return;
            }

            if (action === 'select' && i.values) {
                this._currentPage = parseInt(i.values[0], 10);
            } else {
                switch (action) {
                    case 'first': this._currentPage = 0; break;
                    case 'prev': this._currentPage = Math.max(0, this._currentPage - 1); break;
                    case 'next': this._currentPage = Math.min(this.totalPages - 1, this._currentPage + 1); break;
                    case 'last': this._currentPage = this.totalPages - 1; break;
                }
            }

            if (this._onPageChange) await this._onPageChange(this._currentPage, i);
            const newPayload = this._buildPayload(this._currentPage);
            await i.editReply(newPayload).catch(() => {});
        });

        this._collector.on('end', async (_, reason) => {
            if (this._onEnd) await this._onEnd(reason).catch(() => {});
            if (reason !== 'user') {
                const disabledPayload = this._buildPayload(this._currentPage);
                if (disabledPayload.components) {
                    const lastRow = disabledPayload.components[disabledPayload.components.length - 1];
                    if (lastRow?.components) {
                        lastRow.components = lastRow.components.map(c => ({ ...c, disabled: true }));
                    }
                }
                await this._interaction.editReply(disabledPayload).catch(() => {});
            }
        });

        return this;
    }

    stop() {
        this._collector?.stop('manual');
        return this;
    }

    setPage(page) {
        this._currentPage = Math.max(0, Math.min(this.totalPages - 1, page));
        return this;
    }
}

async function paginate(interaction, pages, opts = {}) {
    const session = new PaginationSession(interaction, pages, opts);
    await session.start();
    return session;
}

function chunkPages(items, itemsPerPage, formatter) {
    const pages = [];
    for (let i = 0; i < items.length; i += itemsPerPage) {
        const chunk = items.slice(i, i + itemsPerPage);
        pages.push(formatter ? formatter(chunk, i, items) : chunk.join('\n'));
    }
    return pages;
}

module.exports = { PaginationSession, paginate, chunkPages };
