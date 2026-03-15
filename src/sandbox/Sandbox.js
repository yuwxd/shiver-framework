const vm = require('vm');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const SAFE_GLOBALS = {
    Math, JSON, Date, parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    String, Number, Boolean, Array, Object, Map, Set, WeakMap, WeakSet,
    Promise, Symbol, BigInt, RegExp, Error, TypeError, RangeError,
    setTimeout: undefined, setInterval: undefined, clearTimeout: undefined, clearInterval: undefined,
    console: undefined, process: undefined, require: undefined, module: undefined,
    __dirname: undefined, __filename: undefined, global: undefined, globalThis: undefined,
    Buffer: undefined, fetch: undefined, XMLHttpRequest: undefined
};

class SandboxResult {
    constructor(opts) {
        this.ok = opts.ok;
        this.value = opts.value ?? null;
        this.error = opts.error ?? null;
        this.stdout = opts.stdout ?? '';
        this.executionTime = opts.executionTime ?? 0;
        this.timedOut = opts.timedOut ?? false;
    }
}

class Sandbox {
    constructor(opts = {}) {
        this._timeout = opts.timeout ?? 5000;
        this._allowConsole = opts.allowConsole !== false;
        this._allowAsync = opts.allowAsync !== false;
        this._maxOutputLength = opts.maxOutputLength ?? 2000;
        this._extraGlobals = opts.globals ?? {};
        this._useWorker = opts.useWorker ?? false;
    }

    async run(code, context = {}) {
        if (this._useWorker) {
            return this._runInWorker(code, context);
        }
        return this._runInVm(code, context);
    }

    async _runInVm(code, context = {}) {
        const start = Date.now();
        const output = [];

        const sandbox = {
            ...SAFE_GLOBALS,
            ...this._extraGlobals,
            ...context
        };

        if (this._allowConsole) {
            sandbox.console = {
                log: (...args) => output.push(args.map(a => this._stringify(a)).join(' ')),
                error: (...args) => output.push('[error] ' + args.map(a => this._stringify(a)).join(' ')),
                warn: (...args) => output.push('[warn] ' + args.map(a => this._stringify(a)).join(' ')),
                info: (...args) => output.push('[info] ' + args.map(a => this._stringify(a)).join(' '))
            };
        }

        const vmContext = vm.createContext(sandbox);

        try {
            const wrappedCode = this._allowAsync
                ? `(async () => { ${code} })()`
                : code;

            const script = new vm.Script(wrappedCode, { timeout: this._timeout });
            let value = script.runInContext(vmContext, { timeout: this._timeout });

            if (value && typeof value.then === 'function') {
                value = await Promise.race([
                    value,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Async timeout')), this._timeout))
                ]);
            }

            const stdout = output.join('\n').slice(0, this._maxOutputLength);

            return new SandboxResult({
                ok: true,
                value: this._serialize(value),
                stdout,
                executionTime: Date.now() - start
            });
        } catch (err) {
            const timedOut = err.message?.includes('timed out') || err.message?.includes('timeout') || err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
            return new SandboxResult({
                ok: false,
                error: timedOut ? 'Execution timed out' : this._sanitizeError(err.message),
                stdout: output.join('\n').slice(0, this._maxOutputLength),
                executionTime: Date.now() - start,
                timedOut
            });
        }
    }

    async _runInWorker(code, context = {}) {
        return new Promise((resolve) => {
            const workerCode = `
                const { parentPort, workerData } = require('worker_threads');
                const vm = require('vm');
                const { code, context, timeout, allowConsole, maxOutputLength } = workerData;
                const output = [];
                const sandbox = { ...context };
                if (allowConsole) {
                    sandbox.console = {
                        log: (...a) => output.push(a.map(String).join(' ')),
                        error: (...a) => output.push('[error] ' + a.map(String).join(' ')),
                        warn: (...a) => output.push('[warn] ' + a.map(String).join(' ')),
                        info: (...a) => output.push('[info] ' + a.map(String).join(' '))
                    };
                }
                const ctx = vm.createContext(sandbox);
                const start = Date.now();
                try {
                    const script = new vm.Script('(async () => { ' + code + ' })()', { timeout });
                    let val = script.runInContext(ctx, { timeout });
                    if (val && typeof val.then === 'function') {
                        val.then(v => {
                            parentPort.postMessage({ ok: true, value: String(v ?? ''), stdout: output.join('\\n').slice(0, maxOutputLength), executionTime: Date.now() - start });
                        }).catch(e => {
                            parentPort.postMessage({ ok: false, error: e.message, stdout: output.join('\\n').slice(0, maxOutputLength), executionTime: Date.now() - start });
                        });
                    } else {
                        parentPort.postMessage({ ok: true, value: String(val ?? ''), stdout: output.join('\\n').slice(0, maxOutputLength), executionTime: Date.now() - start });
                    }
                } catch(e) {
                    parentPort.postMessage({ ok: false, error: e.message, stdout: output.join('\\n').slice(0, maxOutputLength), executionTime: Date.now() - start, timedOut: e.message.includes('timed out') });
                }
            `;

            const worker = new Worker(workerCode, {
                eval: true,
                workerData: {
                    code,
                    context: JSON.parse(JSON.stringify(context, (k, v) => typeof v === 'function' ? undefined : v)),
                    timeout: this._timeout,
                    allowConsole: this._allowConsole,
                    maxOutputLength: this._maxOutputLength
                }
            });

            const killTimer = setTimeout(() => {
                worker.terminate();
                resolve(new SandboxResult({ ok: false, error: 'Worker execution timed out', timedOut: true }));
            }, this._timeout + 1000);

            worker.on('message', (result) => {
                clearTimeout(killTimer);
                worker.terminate();
                resolve(new SandboxResult(result));
            });

            worker.on('error', (err) => {
                clearTimeout(killTimer);
                resolve(new SandboxResult({ ok: false, error: this._sanitizeError(err.message) }));
            });
        });
    }

    _serialize(value) {
        if (value === undefined) return 'undefined';
        if (value === null) return 'null';
        if (typeof value === 'function') return '[Function]';
        if (typeof value === 'symbol') return value.toString();
        if (typeof value === 'bigint') return value.toString() + 'n';
        try {
            return JSON.stringify(value, null, 2);
        } catch (_) {
            return String(value);
        }
    }

    _stringify(value) {
        if (typeof value === 'object' && value !== null) {
            try { return JSON.stringify(value); } catch (_) { return String(value); }
        }
        return String(value);
    }

    _sanitizeError(message) {
        if (!message) return 'Unknown error';
        return message.replace(/\(.*?:\d+:\d+\)/g, '').replace(/at .+/g, '').trim().slice(0, 200);
    }
}

module.exports = { Sandbox, SandboxResult };
