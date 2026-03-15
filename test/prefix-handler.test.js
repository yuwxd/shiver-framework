const test = require('node:test');
const assert = require('node:assert/strict');
const { PrefixHandler } = require('../src/handlers/PrefixHandler');
const { createMockMessage } = require('../src/testing/mocks');

function createFramework(options = {}) {
    return {
        options,
        container: {
            get() {
                return null;
            }
        },
        client: {},
        events: {
            async emit() {}
        },
        _prefixProcessedIds: new Set()
    };
}

function createRegistry(command) {
    return {
        getPrefix(name) {
            return name === command.name ? command : null;
        }
    };
}

test('PrefixHandler uses runtime prefix resolver', async () => {
    let executed = false;

    const command = {
        name: 'ping',
        async executePrefix() {
            executed = true;
        }
    };

    const framework = createFramework({
        prefix: ',',
        async getPrefix() {
            return '*';
        }
    });

    const handler = new PrefixHandler(createRegistry(command), framework);
    const message = createMockMessage({
        id: 'message-1',
        content: '*ping'
    });

    await handler.handle(message);

    assert.equal(executed, true);
});

test('PrefixHandler reacts immediately to changed runtime prefix and never accepts slash as custom prefix', async () => {
    const executed = [];
    let activePrefix = '*';

    const command = {
        name: 'ping',
        async executePrefix(message) {
            executed.push(message.content);
        }
    };

    const framework = createFramework({
        prefix: ';',
        async getPrefix() {
            return activePrefix;
        }
    });

    const handler = new PrefixHandler(createRegistry(command), framework);

    await handler.handle(createMockMessage({
        id: 'message-2',
        content: '*ping'
    }));

    activePrefix = ';';

    await handler.handle(createMockMessage({
        id: 'message-3',
        content: ';ping'
    }));

    activePrefix = '/';

    await handler.handle(createMockMessage({
        id: 'message-4',
        content: '/ping'
    }));

    await handler.handle(createMockMessage({
        id: 'message-5',
        content: ';ping'
    }));

    assert.deepEqual(executed, ['*ping', ';ping', ';ping']);
});
