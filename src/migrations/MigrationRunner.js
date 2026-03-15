const fs = require('fs');
const path = require('path');

class MigrationRunner {
    constructor(storage, migrationsPath) {
        this._storage = storage;
        this._migrationsPath = migrationsPath;
    }

    async run() {
        if (!fs.existsSync(this._migrationsPath)) return { ran: 0 };

        const files = fs.readdirSync(this._migrationsPath)
            .filter(f => f.endsWith('.js') && /^\d{3}_/.test(f))
            .sort();

        const executed = await this._storage.get('migrations', 'executed') ?? [];
        const executedSet = new Set(executed);
        let ran = 0;

        for (const file of files) {
            if (executedSet.has(file)) continue;
            try {
                const migration = require(path.join(this._migrationsPath, file));
                if (typeof migration.up === 'function') {
                    await migration.up(this._storage);
                }
                executedSet.add(file);
                await this._storage.set('migrations', 'executed', [...executedSet]);
                ran++;
            } catch (err) {
                console.error(`[MigrationRunner] Failed to run ${file}:`, err?.message);
                throw err;
            }
        }

        return { ran };
    }
}

module.exports = { MigrationRunner };
