class WizardSession {
    constructor(initialInteraction, steps, opts = {}) {
        this._interaction = initialInteraction;
        this._steps = steps;
        this._current = 0;
        this._data = {};
        this._timeoutMs = opts.timeoutMs ?? 300000;
        this._onTimeout = opts.onTimeout ?? null;
        this._onCancel = opts.onCancel ?? null;
        this._cancelled = false;
        this._timer = null;
    }

    get data() { return { ...this._data }; }
    get currentStep() { return this._steps[this._current] ?? null; }
    get stepIndex() { return this._current; }
    get totalSteps() { return this._steps.length; }

    setData(key, value) {
        this._data[key] = value;
        return this;
    }

    getData(key) {
        return this._data[key];
    }

    async run() {
        this._resetTimer();
        for (let i = 0; i < this._steps.length; i++) {
            this._current = i;
            if (this._cancelled) break;
            const step = this._steps[i];
            try {
                await step.run(this, this._interaction);
            } catch (err) {
                this._clearTimer();
                throw err;
            }
        }
        this._clearTimer();
        return this._data;
    }

    async next() {
        if (this._current < this._steps.length - 1) this._current++;
    }

    async back(n = 1) {
        this._current = Math.max(0, this._current - n);
    }

    async goTo(index) {
        if (index >= 0 && index < this._steps.length) this._current = index;
    }

    async cancel() {
        this._cancelled = true;
        this._clearTimer();
        if (typeof this._onCancel === 'function') await this._onCancel(this);
    }

    _resetTimer() {
        this._clearTimer();
        this._timer = setTimeout(async () => {
            this._cancelled = true;
            if (typeof this._onTimeout === 'function') await this._onTimeout(this).catch(() => {});
        }, this._timeoutMs);
    }

    _clearTimer() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }
}

module.exports = { WizardSession };
