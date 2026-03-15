const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Sandbox } = require('../sandbox/Sandbox');

const SUPPORTED_LANGUAGES = {
    javascript: { pistonName: 'javascript', version: '*', aliases: ['js', 'node', 'nodejs'] },
    typescript: { pistonName: 'typescript', version: '*', aliases: ['ts'] },
    python: { pistonName: 'python', version: '*', aliases: ['py', 'python3'] },
    java: { pistonName: 'java', version: '*', aliases: [] },
    c: { pistonName: 'c', version: '*', aliases: [] },
    cpp: { pistonName: 'c++', version: '*', aliases: ['c++', 'cxx'] },
    csharp: { pistonName: 'csharp', version: '*', aliases: ['cs', 'c#'] },
    go: { pistonName: 'go', version: '*', aliases: ['golang'] },
    rust: { pistonName: 'rust', version: '*', aliases: ['rs'] },
    ruby: { pistonName: 'ruby', version: '*', aliases: ['rb'] },
    php: { pistonName: 'php', version: '*', aliases: [] },
    swift: { pistonName: 'swift', version: '*', aliases: [] },
    kotlin: { pistonName: 'kotlin', version: '*', aliases: ['kt'] },
    bash: { pistonName: 'bash', version: '*', aliases: ['sh', 'shell'] },
    lua: { pistonName: 'lua', version: '*', aliases: [] },
    r: { pistonName: 'r', version: '*', aliases: [] },
    haskell: { pistonName: 'haskell', version: '*', aliases: ['hs'] },
    elixir: { pistonName: 'elixir', version: '*', aliases: ['ex'] },
    erlang: { pistonName: 'erlang', version: '*', aliases: [] },
    dart: { pistonName: 'dart', version: '*', aliases: [] },
    scala: { pistonName: 'scala', version: '*', aliases: [] },
    perl: { pistonName: 'perl', version: '*', aliases: ['pl'] },
    ocaml: { pistonName: 'ocaml', version: '*', aliases: ['ml'] },
    fsharp: { pistonName: 'fsharp', version: '*', aliases: ['fs', 'f#'] },
    clojure: { pistonName: 'clojure', version: '*', aliases: ['clj'] },
    groovy: { pistonName: 'groovy', version: '*', aliases: [] },
    julia: { pistonName: 'julia', version: '*', aliases: ['jl'] },
    nim: { pistonName: 'nim', version: '*', aliases: [] },
    crystal: { pistonName: 'crystal', version: '*', aliases: ['cr'] },
    zig: { pistonName: 'zig', version: '*', aliases: [] },
    assembly: { pistonName: 'nasm', version: '*', aliases: ['asm', 'nasm'] },
    brainfuck: { pistonName: 'brainfuck', version: '*', aliases: ['bf'] },
    sqlite: { pistonName: 'sqlite3', version: '*', aliases: ['sql'] },
    coffeescript: { pistonName: 'coffeescript', version: '*', aliases: ['coffee'] }
};

class ExecuteResult {
    constructor(data) {
        this.language = data.language;
        this.version = data.version;
        this.stdout = data.stdout ?? '';
        this.stderr = data.stderr ?? '';
        this.output = data.output ?? (data.stdout + data.stderr);
        this.exitCode = data.exitCode ?? 0;
        this.signal = data.signal ?? null;
        this.wallTime = data.wallTime ?? 0;
        this.cpuTime = data.cpuTime ?? 0;
        this.memoryUsed = data.memoryUsed ?? 0;
        this.timedOut = data.timedOut ?? false;
        this.error = data.error ?? null;
    }

    get success() { return this.exitCode === 0 && !this.timedOut && !this.error; }
    get hasOutput() { return this.output.trim().length > 0; }
    get truncated() { return this._truncated ?? false; }

    truncate(maxLength = 2000) {
        if (this.output.length > maxLength) {
            this.output = this.output.slice(0, maxLength) + '\n... (output truncated)';
            this._truncated = true;
        }
        return this;
    }

    toDiscordCodeBlock(maxLength = 1900) {
        const out = this.output.slice(0, maxLength);
        return `\`\`\`${this.language}\n${out || '(no output)'}\n\`\`\``;
    }
}

class ExecuteRunner {
    constructor(opts = {}) {
        this._backend = opts.backend ?? 'piston';
        this._pistonUrl = opts.pistonUrl ?? 'https://emkc.org/api/v2/piston';
        this._dockerHost = opts.dockerHost ?? 'unix:/var/run/docker.sock';
        this._timeout = opts.timeout ?? 10000;
        this._maxOutputLength = opts.maxOutputLength ?? 65536;
        this._maxCodeLength = opts.maxCodeLength ?? 65536;
        this._maxFiles = opts.maxFiles ?? 10;
        this._allowedLanguages = opts.allowedLanguages ?? null;
        this._blockedLanguages = opts.blockedLanguages ?? [];
        this._runtimeCache = null;
        this._runtimeCacheExpiry = 0;
        this._runtimeCacheTtl = opts.runtimeCacheTtl ?? 300000;
        this._requestQueue = [];
        this._activeRequests = 0;
        this._maxConcurrent = opts.maxConcurrent ?? 5;
        this._pythonExecutable = opts.pythonExecutable ?? 'python3';
        this._luaExecutable = opts.luaExecutable ?? 'lua';
        this._opts = opts;
    }

    resolveLanguage(input) {
        const lower = input.toLowerCase().trim();
        if (SUPPORTED_LANGUAGES[lower]) return { key: lower, ...SUPPORTED_LANGUAGES[lower] };
        for (const [key, lang] of Object.entries(SUPPORTED_LANGUAGES)) {
            if (lang.aliases.includes(lower)) return { key, ...lang };
        }
        return null;
    }

    getSupportedLanguages() {
        return Object.entries(SUPPORTED_LANGUAGES).map(([key, lang]) => ({
            key, pistonName: lang.pistonName, aliases: lang.aliases
        }));
    }

    isLanguageAllowed(language) {
        const resolved = this.resolveLanguage(language);
        if (!resolved) return false;
        if (this._blockedLanguages.includes(resolved.key)) return false;
        if (this._allowedLanguages && !this._allowedLanguages.includes(resolved.key)) return false;
        return true;
    }

    async getRuntimes() {
        if (this._runtimeCache && Date.now() < this._runtimeCacheExpiry) {
            return this._runtimeCache;
        }
        const data = await this._httpRequest('GET', `${this._pistonUrl}/runtimes`);
        this._runtimeCache = data;
        this._runtimeCacheExpiry = Date.now() + this._runtimeCacheTtl;
        return data;
    }

    async _resolveVersion(pistonName) {
        try {
            const runtimes = await this.getRuntimes();
            const runtime = runtimes.find(r => r.language === pistonName || r.aliases?.includes(pistonName));
            return runtime?.version ?? '*';
        } catch (_) {
            return '*';
        }
    }

    async execute(language, code, opts = {}) {
        if (!this.isLanguageAllowed(language)) {
            throw new ExecuteError('LANGUAGE_NOT_ALLOWED', `Language "${language}" is not allowed`);
        }

        const resolved = this.resolveLanguage(language);
        if (!resolved) {
            throw new ExecuteError('UNKNOWN_LANGUAGE', `Unknown language: "${language}"`);
        }

        if (code.length > this._maxCodeLength) {
            throw new ExecuteError('CODE_TOO_LONG', `Code exceeds maximum length of ${this._maxCodeLength} characters`);
        }

        const files = opts.files ?? [{ name: `main.${this._getExtension(resolved.key)}`, content: code }];
        if (files.length > this._maxFiles) {
            throw new ExecuteError('TOO_MANY_FILES', `Maximum ${this._maxFiles} files allowed`);
        }

        return this._enqueue(() => this._executeWithBackend(resolved, files, opts));
    }

    async _enqueue(fn) {
        if (this._activeRequests < this._maxConcurrent) {
            this._activeRequests++;
            try {
                return await fn();
            } finally {
                this._activeRequests--;
                this._processQueue();
            }
        }
        return new Promise((resolve, reject) => {
            this._requestQueue.push({ fn, resolve, reject });
        });
    }

    _processQueue() {
        if (this._requestQueue.length === 0 || this._activeRequests >= this._maxConcurrent) return;
        const { fn, resolve, reject } = this._requestQueue.shift();
        this._activeRequests++;
        fn().then(resolve).catch(reject).finally(() => {
            this._activeRequests--;
            this._processQueue();
        });
    }

    async _executeWithBackend(resolved, files, opts) {
        switch (this._backend) {
            case 'piston': return this._executePiston(resolved, files, opts);
            case 'docker': return this._executeDocker(resolved, files, opts);
            case 'sandbox': return this._executeSandbox(resolved, files, opts);
            case 'local':
                if (resolved.key === 'javascript') return this._executeSandbox(resolved, files, opts);
                if (resolved.key === 'python') return this._executePythonSubprocess(resolved, files, opts);
                if (resolved.key === 'lua') return this._executeLuaSubprocess(resolved, files, opts);
                throw new ExecuteError('LANGUAGE_NOT_SUPPORTED', 'Only JavaScript, Python and Lua are supported in local mode.');
            default: throw new ExecuteError('UNKNOWN_BACKEND', `Unknown backend: ${this._backend}`);
        }
    }

    async _executePythonSubprocess(resolved, files, opts) {
        const timeoutMs = opts.runTimeout ?? this._timeout;
        const code = (files[0]?.content ?? '').slice(0, this._maxCodeLength);
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiver-exec-'));
        const scriptPath = path.join(tmpDir, 'main.py');
        try {
            fs.writeFileSync(scriptPath, code, 'utf8');
            const startTime = Date.now();
            const result = await this._spawnWithTimeout(this._pythonExecutable, [scriptPath], {
                timeout: timeoutMs,
                maxBuffer: this._maxOutputLength,
                cwd: tmpDir
            });
            const stdout = (result.stdout ?? '').slice(0, this._maxOutputLength);
            const stderr = (result.stderr ?? '').slice(0, this._maxOutputLength);
            return new ExecuteResult({
                language: resolved.key,
                version: 'Python 3',
                stdout,
                stderr,
                output: (stdout + (stderr ? '\n' + stderr : '')).slice(0, this._maxOutputLength),
                exitCode: result.exitCode ?? 0,
                wallTime: Date.now() - startTime,
                timedOut: result.timedOut ?? false,
                error: result.timedOut ? 'Execution timed out' : (result.exitCode !== 0 ? stderr : null)
            });
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
    }

    async _executeLuaSubprocess(resolved, files, opts) {
        const timeoutMs = opts.runTimeout ?? this._timeout;
        const code = (files[0]?.content ?? '').slice(0, this._maxCodeLength);
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiver-exec-'));
        const scriptPath = path.join(tmpDir, 'main.lua');
        try {
            fs.writeFileSync(scriptPath, code, 'utf8');
            const startTime = Date.now();
            const env = {
                ...process.env,
                LUA_PATH: '',
                LUA_CPATH: ''
            };
            const result = await this._spawnWithTimeout(this._luaExecutable, [scriptPath], {
                timeout: timeoutMs,
                maxBuffer: this._maxOutputLength,
                cwd: tmpDir,
                env
            });
            const stdout = (result.stdout ?? '').slice(0, this._maxOutputLength);
            const stderr = (result.stderr ?? '').slice(0, this._maxOutputLength);
            return new ExecuteResult({
                language: resolved.key,
                version: 'Lua',
                stdout,
                stderr,
                output: (stdout + (stderr ? '\n' + stderr : '')).slice(0, this._maxOutputLength),
                exitCode: result.exitCode ?? 0,
                wallTime: Date.now() - startTime,
                timedOut: result.timedOut ?? false,
                error: result.timedOut ? 'Execution timed out' : (result.exitCode !== 0 ? stderr : null)
            });
        } finally {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
    }

    _spawnWithTimeout(command, args, opts) {
        const timeoutMs = opts.timeout ?? 10000;
        const maxBuffer = opts.maxBuffer ?? 65536;
        const spawnEnv = opts.env ?? { ...process.env, PYTHONIOENCODING: 'utf-8' };
        return new Promise((resolve) => {
            const child = spawn(command, args, {
                cwd: opts.cwd,
                env: spawnEnv,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';
            let done = false;
            const finish = (exitCode, timedOut) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                try { child.kill('SIGKILL'); } catch (_) {}
                resolve({
                    stdout: stdout.slice(0, maxBuffer),
                    stderr: stderr.slice(0, maxBuffer),
                    exitCode: exitCode ?? (timedOut ? 124 : 1),
                    timedOut: !!timedOut
                });
            };
            const timer = setTimeout(() => finish(null, true), timeoutMs);
            child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
            child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
            child.on('error', (err) => {
                if (stderr === '' && err.message) stderr = err.message;
                if (!done) finish(1, false);
            });
            child.on('close', (code, signal) => {
                if (!done) finish(code ?? 0, signal === 'SIGKILL');
            });
        });
    }

    async _executeSandbox(resolved, files, opts) {
        if (resolved.key !== 'javascript') {
            throw new ExecuteError('LANGUAGE_NOT_SUPPORTED', 'Only JavaScript is supported in sandbox mode.');
        }
        const code = (files[0]?.content ?? '').slice(0, this._maxCodeLength);
        const timeoutMs = opts.runTimeout ?? this._timeout;
        const sandbox = new Sandbox({
            timeout: timeoutMs,
            maxOutputLength: this._maxOutputLength,
            allowConsole: true,
            allowAsync: true
        });
        const result = await sandbox.run(code);
        const stdout = (result.stdout ?? '').slice(0, this._maxOutputLength);
        const stderr = (result.error ?? '').slice(0, this._maxOutputLength);
        return new ExecuteResult({
            language: resolved.key,
            version: 'Node.js',
            stdout,
            stderr,
            output: (stdout + (stderr ? '\n' + stderr : '')).slice(0, this._maxOutputLength),
            exitCode: result.ok ? 0 : 1,
            wallTime: result.executionTime ?? 0,
            timedOut: result.timedOut ?? false,
            error: result.error ?? null
        });
    }

    async _executePiston(resolved, files, opts) {
        const version = opts.version ?? await this._resolveVersion(resolved.pistonName);
        const body = {
            language: resolved.pistonName,
            version,
            files: files.map(f => ({ name: f.name, content: f.content })),
            stdin: opts.stdin ?? '',
            args: opts.args ?? [],
            compile_timeout: opts.compileTimeout ?? this._timeout,
            run_timeout: opts.runTimeout ?? this._timeout,
            compile_memory_limit: opts.compileMemoryLimit ?? -1,
            run_memory_limit: opts.runMemoryLimit ?? -1
        };

        const startTime = Date.now();
        let response;
        try {
            response = await this._httpRequest('POST', `${this._pistonUrl}/execute`, body);
        } catch (e) {
            throw new ExecuteError('BACKEND_ERROR', e.message);
        }

        const wallTime = Date.now() - startTime;
        const run = response.run ?? {};
        const compile = response.compile ?? {};

        const stdout = run.stdout ?? '';
        const stderr = (compile.stderr ?? '') + (run.stderr ?? '');
        const output = (stdout + stderr).slice(0, this._maxOutputLength);

        return new ExecuteResult({
            language: resolved.key,
            version: response.language ?? resolved.pistonName,
            stdout: stdout.slice(0, this._maxOutputLength),
            stderr: stderr.slice(0, this._maxOutputLength),
            output,
            exitCode: run.code ?? 0,
            signal: run.signal ?? null,
            wallTime,
            timedOut: run.signal === 'SIGKILL' || compile.signal === 'SIGKILL'
        });
    }

    async _executeDocker(resolved, files, opts) {
        const { execSync } = require('child_process');
        const os = require('os');
        const path = require('path');
        const fs = require('fs');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiver-exec-'));
        const mainFile = files[0];
        const filePath = path.join(tmpDir, mainFile.name);

        try {
            fs.writeFileSync(filePath, mainFile.content, 'utf8');
            for (const f of files.slice(1)) {
                fs.writeFileSync(path.join(tmpDir, f.name), f.content, 'utf8');
            }

            const image = this._getDockerImage(resolved.key);
            const cmd = this._getDockerRunCmd(resolved.key, mainFile.name);
            const timeoutSec = Math.ceil(this._timeout / 1000);

            const dockerCmd = [
                'docker', 'run', '--rm',
                '--network=none',
                `--memory=${opts.memoryLimit ?? '128m'}`,
                `--cpus=${opts.cpuLimit ?? '0.5'}`,
                '--read-only',
                `--tmpfs=/tmp:size=${opts.tmpSize ?? '64m'}`,
                `-v`, `${tmpDir}:/code:ro`,
                `-w`, `/code`,
                image,
                'timeout', String(timeoutSec),
                ...cmd
            ].join(' ');

            const startTime = Date.now();
            let stdout = '', stderr = '', exitCode = 0;

            try {
                stdout = execSync(dockerCmd, {
                    timeout: this._timeout + 5000,
                    maxBuffer: this._maxOutputLength,
                    encoding: 'utf8'
                });
            } catch (e) {
                stderr = e.stderr ?? '';
                stdout = e.stdout ?? '';
                exitCode = e.status ?? 1;
            }

            return new ExecuteResult({
                language: resolved.key,
                version: 'docker',
                stdout: stdout.slice(0, this._maxOutputLength),
                stderr: stderr.slice(0, this._maxOutputLength),
                output: (stdout + stderr).slice(0, this._maxOutputLength),
                exitCode,
                wallTime: Date.now() - startTime,
                timedOut: exitCode === 124
            });
        } finally {
            try { require('fs').rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        }
    }

    _getDockerImage(language) {
        const images = {
            javascript: 'node:20-alpine',
            typescript: 'node:20-alpine',
            python: 'python:3.12-alpine',
            java: 'openjdk:21-alpine',
            c: 'gcc:latest',
            cpp: 'gcc:latest',
            go: 'golang:alpine',
            rust: 'rust:alpine',
            ruby: 'ruby:alpine',
            php: 'php:8.3-cli-alpine',
            bash: 'alpine:latest'
        };
        return images[language] ?? 'alpine:latest';
    }

    _getDockerRunCmd(language, filename) {
        const cmds = {
            javascript: ['node', filename],
            typescript: ['npx', 'ts-node', filename],
            python: ['python3', filename],
            java: ['sh', '-c', `javac ${filename} && java ${filename.replace('.java', '')}`],
            c: ['sh', '-c', `gcc -o /tmp/out ${filename} && /tmp/out`],
            cpp: ['sh', '-c', `g++ -o /tmp/out ${filename} && /tmp/out`],
            go: ['go', 'run', filename],
            rust: ['sh', '-c', `rustc -o /tmp/out ${filename} && /tmp/out`],
            ruby: ['ruby', filename],
            php: ['php', filename],
            bash: ['bash', filename]
        };
        return cmds[language] ?? ['sh', filename];
    }

    _getExtension(language) {
        const exts = {
            javascript: 'js', typescript: 'ts', python: 'py', java: 'java',
            c: 'c', cpp: 'cpp', csharp: 'cs', go: 'go', rust: 'rs',
            ruby: 'rb', php: 'php', swift: 'swift', kotlin: 'kt',
            bash: 'sh', lua: 'lua', r: 'r', haskell: 'hs', elixir: 'ex',
            dart: 'dart', scala: 'scala', perl: 'pl', julia: 'jl',
            nim: 'nim', crystal: 'cr', zig: 'zig', brainfuck: 'bf',
            coffeescript: 'coffee', assembly: 'asm', fsharp: 'fs',
            clojure: 'clj', groovy: 'groovy', ocaml: 'ml', erlang: 'erl'
        };
        return exts[language] ?? 'txt';
    }

    async _httpRequest(method, url, body) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const isHttps = parsed.protocol === 'https:';
            const lib = isHttps ? https : http;
            const payload = body ? JSON.stringify(body) : null;

            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'shiver-framework/1.0',
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
                },
                timeout: this._timeout
            };

            const req = lib.request(options, (res) => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString();
                    if (res.statusCode >= 400) {
                        reject(new ExecuteError('HTTP_ERROR', `HTTP ${res.statusCode}: ${raw}`));
                        return;
                    }
                    try { resolve(JSON.parse(raw)); } catch (_) { resolve(raw); }
                });
            });

            req.on('timeout', () => { req.destroy(); reject(new ExecuteError('TIMEOUT', 'Request timed out')); });
            req.on('error', reject);
            if (payload) req.write(payload);
            req.end();
        });
    }
}

class ExecuteError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ExecuteError';
    }
}

module.exports = { ExecuteRunner, ExecuteResult, ExecuteError, SUPPORTED_LANGUAGES };
