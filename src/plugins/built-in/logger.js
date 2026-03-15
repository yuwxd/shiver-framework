const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const name = 'logger';

async function init(framework, options = {}) {
    const level = options.level ?? 'info';
    const levelNum = LEVELS[level] ?? 1;
    const json = options.json ?? false;
    const category = options.category ?? 'shiver';

    const log = (lvl, tag, ...args) => {
        if ((LEVELS[lvl] ?? 0) < levelNum) return;
        if (json) {
            console.log(JSON.stringify({ level: lvl, category: tag, message: args.join(' '), ts: new Date().toISOString() }));
        } else {
            const fn = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
            fn(`[${lvl.toUpperCase()}][${tag}]`, ...args);
        }
    };

    const logger = {
        debug: (...a) => log('debug', category, ...a),
        info: (...a) => log('info', category, ...a),
        warn: (...a) => log('warn', category, ...a),
        error: (...a) => log('error', category, ...a),
        child: (tag) => ({
            debug: (...a) => log('debug', tag, ...a),
            info: (...a) => log('info', tag, ...a),
            warn: (...a) => log('warn', tag, ...a),
            error: (...a) => log('error', tag, ...a)
        })
    };

    framework.container.set('logger', logger);
    framework.logger = logger;
}

module.exports = { name, init };
