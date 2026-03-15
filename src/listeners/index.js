class ListenerRegistry {
    constructor(framework) {
        this._framework = framework;
        this._listeners = new Map();
    }

    on(event, handler) {
        this._framework.events.on(event, handler);
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(handler);
        return this;
    }

    once(event, handler) {
        this._framework.events.once(event, handler);
        return this;
    }

    off(event, handler) {
        this._framework.events.off(event, handler);
        return this;
    }

    onCommandRun(handler) {
        return this.on('CommandRun', handler);
    }

    onCommandBlocked(handler) {
        return this.on('CommandBlocked', handler);
    }

    onCommandError(handler) {
        return this.on('CommandError', handler);
    }

    onCommandDenied(handler) {
        return this.on('CommandDenied', handler);
    }

    onAfterReady(handler) {
        return this.on('afterReady', handler);
    }

    onAfterSlashSync(handler) {
        return this.on('afterSlashSync', handler);
    }

    onAfterPrefixMessage(handler) {
        return this.on('afterPrefixMessage', handler);
    }
}

module.exports = { ListenerRegistry };
