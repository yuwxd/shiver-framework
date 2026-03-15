const { ShardingManager } = require('discord.js');

function createShardingManager(scriptPath, options = {}) {
    const manager = new ShardingManager(scriptPath, {
        token: options.token ?? process.env.DISCORD_TOKEN,
        totalShards: options.totalShards ?? 'auto',
        shardList: options.shardList ?? 'auto',
        mode: options.mode ?? 'process',
        respawn: options.respawn !== false,
        ...options.extra
    });

    manager.on('shardCreate', (shard) => {
        console.log(`[ShardingManager] Launched shard ${shard.id}`);
    });

    return manager;
}

module.exports = { createShardingManager };
