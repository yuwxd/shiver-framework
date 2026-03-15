class Debouncer {
    constructor(fn, delay, opts = {}) {
        this._fn = fn;
        this._delay = delay;
        this._leading = opts.leading ?? false;
        this._trailing = opts.trailing ?? true;
        this._maxWait = opts.maxWait ?? null;
        this._timer = null;
        this._maxTimer = null;
        this._lastCallTime = null;
        this._lastInvokeTime = 0;
        this._lastArgs = null;
        this._lastThis = null;
        this._result = undefined;
    }

    call(...args) {
        const time = Date.now();
        const isInvoking = this._shouldInvoke(time);
        this._lastArgs = args;
        this._lastCallTime = time;

        if (isInvoking && this._leading && !this._timer) {
            this._result = this._invokeFunc(time);
        }

        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => this._timerExpired(), this._delay);

        if (this._maxWait !== null && !this._maxTimer) {
            this._maxTimer = setTimeout(() => {
                this._maxTimer = null;
                this._result = this._invokeFunc(Date.now());
            }, this._maxWait);
        }

        return this._result;
    }

    _shouldInvoke(time) {
        const timeSinceLastCall = this._lastCallTime === null ? 0 : time - this._lastCallTime;
        const timeSinceLastInvoke = time - this._lastInvokeTime;
        return this._lastCallTime === null ||
            timeSinceLastCall >= this._delay ||
            (this._maxWait !== null && timeSinceLastInvoke >= this._maxWait);
    }

    _invokeFunc(time) {
        this._lastInvokeTime = time;
        const args = this._lastArgs;
        this._lastArgs = null;
        return this._fn(...args);
    }

    _timerExpired() {
        this._timer = null;
        if (this._trailing && this._lastArgs) {
            this._result = this._invokeFunc(Date.now());
        }
    }

    cancel() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
        this._lastCallTime = null;
        this._lastArgs = null;
    }

    flush() {
        if (this._timer && this._lastArgs) {
            this.cancel();
            return this._invokeFunc(Date.now());
        }
        return this._result;
    }

    pending() {
        return this._timer !== null;
    }

    static create(fn, delay, opts) {
        const d = new Debouncer(fn, delay, opts);
        const wrapper = (...args) => d.call(...args);
        wrapper.cancel = () => d.cancel();
        wrapper.flush = () => d.flush();
        wrapper.pending = () => d.pending();
        return wrapper;
    }
}

class Throttler {
    constructor(fn, limit, opts = {}) {
        this._fn = fn;
        this._limit = limit;
        this._leading = opts.leading ?? true;
        this._trailing = opts.trailing ?? true;
        this._lastCallTime = null;
        this._lastResult = undefined;
        this._timer = null;
        this._pendingArgs = null;
    }

    call(...args) {
        const now = Date.now();
        const elapsed = this._lastCallTime ? now - this._lastCallTime : Infinity;

        if (elapsed >= this._limit) {
            if (this._timer) { clearTimeout(this._timer); this._timer = null; }
            this._lastCallTime = now;
            this._lastResult = this._fn(...args);
            return this._lastResult;
        }

        this._pendingArgs = args;
        if (!this._timer) {
            this._timer = setTimeout(() => {
                this._timer = null;
                this._lastCallTime = Date.now();
                if (this._trailing && this._pendingArgs) {
                    this._lastResult = this._fn(...this._pendingArgs);
                    this._pendingArgs = null;
                }
            }, this._limit - elapsed);
        }

        return this._lastResult;
    }

    cancel() {
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        this._pendingArgs = null;
    }

    static create(fn, limit, opts) {
        const t = new Throttler(fn, limit, opts);
        const wrapper = (...args) => t.call(...args);
        wrapper.cancel = () => t.cancel();
        return wrapper;
    }
}

module.exports = { Debouncer, Throttler };
