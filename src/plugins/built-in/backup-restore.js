const name = 'backup-restore';

async function init(framework, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const backupDir = options.backupDir ?? './backups';
    const maxBackups = options.maxBackups ?? 10;

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const backup = async (guildId) => {
        const settings = framework._settings;
        if (!settings) return null;

        const data = guildId
            ? { [guildId]: await settings.getGuild(guildId) }
            : {};

        if (!guildId) {
            const storage = framework._storage;
            if (storage) {
                const allData = await storage.get('guild', '__all__').catch(() => null);
                if (allData) Object.assign(data, allData);
            }
        }

        const filename = `backup_${guildId ?? 'all'}_${Date.now()}.json`;
        const filePath = path.join(backupDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        const files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith(`backup_${guildId ?? 'all'}`))
            .sort();
        while (files.length > maxBackups) {
            fs.unlinkSync(path.join(backupDir, files.shift()));
        }

        return filePath;
    };

    const restore = async (filePath) => {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const settings = framework._settings;
        if (!settings) return;

        for (const [guildId, guildData] of Object.entries(data)) {
            await settings.setGuild(guildId, guildData);
        }
    };

    const backupRestore = { backup, restore };
    framework.container.set('backupRestore', backupRestore);
    framework.backupRestore = backupRestore;
}

module.exports = { name, init };
