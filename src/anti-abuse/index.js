const { AntiSpam } = require('./AntiSpam');
const { AntiRaid } = require('./AntiRaid');
const { MessageFilter } = require('./MessageFilter');

class AntiAbuse {
    constructor(opts = {}) {
        this.antiSpam = opts.antiSpam !== false ? new AntiSpam(opts.antiSpam ?? {}) : null;
        this.antiRaid = opts.antiRaid !== false ? new AntiRaid(opts.antiRaid ?? {}) : null;
        this.messageFilter = opts.messageFilter !== false ? new MessageFilter(opts.messageFilter ?? {}) : null;
        this._client = null;
    }

    setClient(client) {
        this._client = client;
        return this;
    }

    setModerationAPI(api) {
        if (this.antiSpam) this.antiSpam.setModerationAPI(api);
        if (this.antiRaid) this.antiRaid.setModerationAPI(api);
        if (this.messageFilter) this.messageFilter.setModerationAPI(api);
        return this;
    }

    async onMessage(message) {
        const results = {};
        if (this.messageFilter) {
            results.filter = await this.messageFilter.check(message);
            if (results.filter.filtered) return results;
        }
        if (this.antiSpam) {
            results.spam = await this.antiSpam.check(message);
        }
        return results;
    }

    async onMemberJoin(member) {
        if (this.antiRaid) {
            return this.antiRaid.onMemberJoin(member);
        }
        return null;
    }

    destroy() {
        if (this.antiSpam) this.antiSpam.destroy();
        if (this.antiRaid) this.antiRaid.destroy();
    }
}

module.exports = { AntiAbuse, AntiSpam, AntiRaid, MessageFilter };
