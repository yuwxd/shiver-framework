class Scheduler {
    constructor() {
        this._tasks = new Map();
        this._paused = new Set();
    }

    every(intervalMs, name, fn) {
        this.cancel(name);
        const timer = setInterval(async () => {
            if (this._paused.has(name)) return;
            try { await fn(); } catch (err) { console.error(`[Scheduler] Task "${name}" error:`, err?.message); }
        }, intervalMs);
        this._tasks.set(name, { timer, type: 'interval', intervalMs, fn });
        return this;
    }

    once(delayMs, name, fn) {
        this.cancel(name);
        const timer = setTimeout(async () => {
            this._tasks.delete(name);
            try { await fn(); } catch (err) { console.error(`[Scheduler] Task "${name}" error:`, err?.message); }
        }, delayMs);
        this._tasks.set(name, { timer, type: 'timeout', fn });
        return this;
    }

    cron(expr, name, fn) {
        const ms = this._parseCronToMs(expr);
        if (ms === null) {
            console.error(`[Scheduler] Invalid cron expression: "${expr}"`);
            return this;
        }
        return this.every(ms, name, fn);
    }

    _parseCronToMs(expr) {
        if (expr === '* * * * *') return 60000;
        if (expr === '0 * * * *') return 3600000;
        if (expr === '0 0 * * *') return 86400000;
        if (expr === '0 0 * * 0') return 604800000;
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return null;
        const [min, hour] = parts;
        const m = parseInt(min, 10);
        const h = parseInt(hour, 10);
        if (!isNaN(m) && min !== '*' && hour === '*') return m * 60000;
        if (!isNaN(h) && hour !== '*' && min === '0') return h * 3600000;
        return 60000;
    }

    cancel(name) {
        const task = this._tasks.get(name);
        if (!task) return this;
        if (task.type === 'interval') clearInterval(task.timer);
        else clearTimeout(task.timer);
        this._tasks.delete(name);
        this._paused.delete(name);
        return this;
    }

    pause(name) {
        if (this._tasks.has(name)) this._paused.add(name);
        return this;
    }

    resume(name) {
        this._paused.delete(name);
        return this;
    }

    list() {
        return [...this._tasks.entries()].map(([name, task]) => ({
            name,
            type: task.type,
            paused: this._paused.has(name),
            intervalMs: task.intervalMs ?? null
        }));
    }

    destroy() {
        for (const name of [...this._tasks.keys()]) this.cancel(name);
    }
}

module.exports = { Scheduler };
