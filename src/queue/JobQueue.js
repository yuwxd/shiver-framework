const { EventEmitter } = require('events');

const JOB_STATUS = { PENDING: 'pending', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed', RETRYING: 'retrying', CANCELLED: 'cancelled' };

class Job {
    constructor(opts) {
        this.id = opts.id ?? `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.type = opts.type;
        this.data = opts.data ?? {};
        this.priority = opts.priority ?? 0;
        this.maxRetries = opts.maxRetries ?? 3;
        this.retryDelay = opts.retryDelay ?? 1000;
        this.delay = opts.delay ?? 0;
        this.timeout = opts.timeout ?? 30000;
        this.status = JOB_STATUS.PENDING;
        this.attempts = 0;
        this.createdAt = Date.now();
        this.runAt = Date.now() + this.delay;
        this.completedAt = null;
        this.error = null;
        this.result = null;
    }

    toJSON() {
        return {
            id: this.id, type: this.type, data: this.data, priority: this.priority,
            maxRetries: this.maxRetries, retryDelay: this.retryDelay, delay: this.delay,
            timeout: this.timeout, status: this.status, attempts: this.attempts,
            createdAt: this.createdAt, runAt: this.runAt, completedAt: this.completedAt,
            error: this.error, result: this.result
        };
    }

    static fromJSON(data) {
        const job = new Job(data);
        job.status = data.status;
        job.attempts = data.attempts;
        job.createdAt = data.createdAt;
        job.runAt = data.runAt;
        job.completedAt = data.completedAt;
        job.error = data.error;
        job.result = data.result;
        return job;
    }
}

class JobQueue extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._handlers = new Map();
        this._queue = [];
        this._running = new Map();
        this._concurrency = opts.concurrency ?? 5;
        this._storage = opts.storage ?? null;
        this._storageNamespace = opts.storageNamespace ?? 'jobqueue';
        this._pollInterval = opts.pollInterval ?? 1000;
        this._pollTimer = null;
        this._paused = false;
        this._completed = [];
        this._maxCompleted = opts.maxCompleted ?? 500;
        this._processingEnabled = true;
    }

    register(type, handler) {
        this._handlers.set(type, handler);
        return this;
    }

    async add(type, data = {}, opts = {}) {
        const job = new Job({ type, data, ...opts });

        if (this._storage) {
            await this._storage.set(this._storageNamespace, job.id, job.toJSON()).catch(() => {});
        }

        this._enqueue(job);
        return job;
    }

    _enqueue(job) {
        this._queue.push(job);
        this._queue.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return a.createdAt - b.createdAt;
        });
        this._tryProcess();
    }

    async cancel(jobId) {
        const idx = this._queue.findIndex(j => j.id === jobId);
        if (idx !== -1) {
            const job = this._queue.splice(idx, 1)[0];
            job.status = JOB_STATUS.CANCELLED;
            await this._persist(job);
            this.emit('jobCancelled', job);
            return true;
        }
        return false;
    }

    pause() {
        this._paused = true;
        return this;
    }

    resume() {
        this._paused = false;
        this._tryProcess();
        return this;
    }

    _tryProcess() {
        if (this._paused || !this._processingEnabled) return;
        while (this._running.size < this._concurrency && this._queue.length > 0) {
            const job = this._queue.find(j => j.runAt <= Date.now());
            if (!job) break;
            this._queue.splice(this._queue.indexOf(job), 1);
            this._processJob(job);
        }

        const hasDelayed = this._queue.some(j => j.runAt > Date.now());
        if (hasDelayed && !this._pollTimer) {
            this._pollTimer = setTimeout(() => {
                this._pollTimer = null;
                this._tryProcess();
            }, this._pollInterval);
            if (this._pollTimer.unref) this._pollTimer.unref();
        }
    }

    async _processJob(job) {
        const handler = this._handlers.get(job.type);
        if (!handler) {
            job.status = JOB_STATUS.FAILED;
            job.error = `No handler registered for type: ${job.type}`;
            job.completedAt = Date.now();
            await this._persist(job);
            this.emit('jobFailed', job, new Error(job.error));
            this._tryProcess();
            return;
        }

        job.status = JOB_STATUS.RUNNING;
        job.attempts++;
        this._running.set(job.id, job);
        await this._persist(job);
        this.emit('jobStart', job);

        let timeoutTimer = null;
        try {
            const result = await Promise.race([
                handler(job),
                new Promise((_, reject) => {
                    timeoutTimer = setTimeout(() => reject(new Error(`Job timeout after ${job.timeout}ms`)), job.timeout);
                    if (timeoutTimer.unref) timeoutTimer.unref();
                })
            ]);

            clearTimeout(timeoutTimer);
            job.status = JOB_STATUS.COMPLETED;
            job.result = result ?? null;
            job.completedAt = Date.now();
            this._running.delete(job.id);
            await this._persist(job);
            this._addToCompleted(job);
            this.emit('jobComplete', job, result);
        } catch (err) {
            clearTimeout(timeoutTimer);
            this._running.delete(job.id);

            if (job.attempts < job.maxRetries) {
                job.status = JOB_STATUS.RETRYING;
                job.error = err.message;
                const delay = job.retryDelay * Math.pow(2, job.attempts - 1);
                job.runAt = Date.now() + delay;
                await this._persist(job);
                this.emit('jobRetry', job, err, job.attempts);
                this._enqueue(job);
            } else {
                job.status = JOB_STATUS.FAILED;
                job.error = err.message;
                job.completedAt = Date.now();
                await this._persist(job);
                this._addToCompleted(job);
                this.emit('jobFailed', job, err);
            }
        }

        this._tryProcess();
    }

    _addToCompleted(job) {
        this._completed.push(job);
        if (this._completed.length > this._maxCompleted) this._completed.shift();
    }

    async _persist(job) {
        if (!this._storage) return;
        if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.CANCELLED) {
            await this._storage.delete(this._storageNamespace, job.id).catch(() => {});
        } else {
            await this._storage.set(this._storageNamespace, job.id, job.toJSON()).catch(() => {});
        }
    }

    async restore() {
        if (!this._storage) return 0;
        const keys = await this._storage.keys(this._storageNamespace).catch(() => []);
        let count = 0;
        for (const key of keys) {
            const data = await this._storage.get(this._storageNamespace, key).catch(() => null);
            if (!data) continue;
            const job = Job.fromJSON(data);
            if (job.status === JOB_STATUS.RUNNING) {
                job.status = JOB_STATUS.PENDING;
                job.runAt = Date.now();
            }
            if (job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.RETRYING) {
                this._enqueue(job);
                count++;
            }
        }
        return count;
    }

    getJob(jobId) {
        return this._queue.find(j => j.id === jobId)
            ?? this._running.get(jobId)
            ?? this._completed.find(j => j.id === jobId)
            ?? null;
    }

    getStats() {
        return {
            pending: this._queue.length,
            running: this._running.size,
            completed: this._completed.filter(j => j.status === JOB_STATUS.COMPLETED).length,
            failed: this._completed.filter(j => j.status === JOB_STATUS.FAILED).length,
            paused: this._paused,
            handlers: [...this._handlers.keys()]
        };
    }

    getCompleted(limit = 50) {
        return this._completed.slice(-limit);
    }

    async drain() {
        return new Promise(resolve => {
            if (this._queue.length === 0 && this._running.size === 0) return resolve();
            const check = () => {
                if (this._queue.length === 0 && this._running.size === 0) {
                    this.off('jobComplete', check);
                    this.off('jobFailed', check);
                    resolve();
                }
            };
            this.on('jobComplete', check);
            this.on('jobFailed', check);
        });
    }

    destroy() {
        this._processingEnabled = false;
        if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    }
}

module.exports = { JobQueue, Job, JOB_STATUS };
