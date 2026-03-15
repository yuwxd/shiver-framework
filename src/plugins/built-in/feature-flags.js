const name = 'feature-flags';

async function init(framework, options = {}) {
    const flags = new Map(Object.entries(options.flags ?? {}));
    const storage = options.storage ?? null;
    const storageKey = options.storageKey ?? 'feature_flags';

    if (storage) {
        try {
            const stored = await storage.get('flags', storageKey);
            if (stored) {
                for (const [k, v] of Object.entries(stored)) flags.set(k, v);
            }
        } catch (_) {}
    }

    const save = async () => {
        if (!storage) return;
        await storage.set('flags', storageKey, Object.fromEntries(flags)).catch(() => {});
    };

    const featureFlags = {
        isEnabled(flag) {
            return flags.get(flag) === true;
        },
        enable(flag) {
            flags.set(flag, true);
            save();
        },
        disable(flag) {
            flags.set(flag, false);
            save();
        },
        toggle(flag) {
            flags.set(flag, !flags.get(flag));
            save();
        },
        getAll() {
            return Object.fromEntries(flags);
        }
    };

    framework.container.set('featureFlags', featureFlags);
    framework.featureFlags = featureFlags;
}

module.exports = { name, init };
