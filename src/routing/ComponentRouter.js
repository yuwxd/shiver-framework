class ComponentRouter {
    constructor() {
        this._buttons = [];
        this._selects = [];
        this._modals = [];
        this._any = [];
    }

    _toRegex(pattern) {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)');
        return new RegExp(`^${escaped}$`);
    }

    _match(pattern, customId) {
        const regex = this._toRegex(pattern);
        const m = customId.match(regex);
        if (!m) return null;
        return { matched: true, groups: m.slice(1), customId };
    }

    button(pattern, handler) {
        this._buttons.push({ pattern, handler });
        return this;
    }

    select(pattern, handler) {
        this._selects.push({ pattern, handler });
        return this;
    }

    modal(pattern, handler) {
        this._modals.push({ pattern, handler });
        return this;
    }

    any(pattern, handler) {
        this._any.push({ pattern, handler });
        return this;
    }

    async routeButton(interaction) {
        return this._route(interaction, this._buttons) || this._route(interaction, this._any);
    }

    async routeSelect(interaction) {
        return this._route(interaction, this._selects) || this._route(interaction, this._any);
    }

    async routeModal(interaction) {
        return this._route(interaction, this._modals) || this._route(interaction, this._any);
    }

    async _route(interaction, handlers) {
        const customId = interaction.customId;
        for (const { pattern, handler } of handlers) {
            const match = this._match(pattern, customId);
            if (match) {
                await handler(interaction, match);
                return true;
            }
        }
        return false;
    }
}

module.exports = { ComponentRouter };
