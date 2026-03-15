const test = require('node:test');
const assert = require('node:assert/strict');
const { CommandRegistry } = require('../src/core/CommandRegistry');

test('CommandRegistry replaces stale aliases when the same source path is reloaded', () => {
    const registry = new CommandRegistry();

    registry.registerCommand({
        name: 'roblox',
        aliases: ['rbx'],
        executePrefix: async () => {},
        data: { name: 'roblox' },
        __sourcePath: '/commands/roblox.js'
    });

    registry.registerCommand({
        name: 'roblox',
        aliases: ['rob'],
        executePrefix: async () => {},
        data: { name: 'roblox' },
        __sourcePath: '/commands/roblox.js'
    });

    assert.equal(registry.getPrefix('rbx'), undefined);
    assert.equal(registry.getPrefix('rob')?.name, 'roblox');
});

test('CommandRegistry exposes current source path map without extra scans', () => {
    const registry = new CommandRegistry();

    registry.registerCommand({
        name: 'help',
        executePrefix: async () => {},
        data: { name: 'help' },
        __sourcePath: '/commands/help.js'
    });

    const sourcePaths = registry.getSourcePathsMap();

    assert.equal(sourcePaths.get('help'), '/commands/help.js');
});
