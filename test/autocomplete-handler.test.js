const test = require('node:test');
const assert = require('node:assert/strict');
const { AutocompleteHandler } = require('../src/handlers/AutocompleteHandler');
const { createMockInteraction } = require('../src/testing/mocks');

function createFramework(options = {}) {
    return {
        options,
        client: {},
        container: {
            get() {
                return null;
            }
        }
    };
}

function createRegistry(command) {
    return {
        getSlash(name) {
            return name === 'roblox' ? command : null;
        }
    };
}

function createAutocompleteInteraction({ value, userId = 'user-1', onRespond }) {
    return createMockInteraction({
        type: 'autocomplete',
        commandName: 'roblox',
        userId,
        onRespond,
        extra: {
            options: {
                getFocused() {
                    return { name: 'username', value };
                },
                getSubcommand() {
                    return null;
                },
                getSubcommandGroup() {
                    return null;
                }
            }
        }
    });
}

test('AutocompleteHandler responds from returned choices and reuses exact cache', async () => {
    let calls = 0;
    const command = {
        async autocomplete() {
            calls++;
            return [{ name: 'roblox', value: '1' }];
        }
    };

    const handler = new AutocompleteHandler(createRegistry(command), createFramework({
        autocompleteDebounceMs: 0,
        autocompleteCacheMs: 1000
    }));

    const responses = [];
    await handler.handle(createAutocompleteInteraction({
        value: 'legacy',
        onRespond(choices) {
            responses.push(choices);
        }
    }));
    await handler.handle(createAutocompleteInteraction({
        value: 'legacy',
        onRespond(choices) {
            responses.push(choices);
        }
    }));

    assert.equal(calls, 1);
    assert.deepEqual(responses, [
        [{ name: 'roblox', value: '1' }],
        [{ name: 'roblox', value: '1' }]
    ]);
});

test('AutocompleteHandler keeps compatibility with handlers that call interaction.respond directly', async () => {
    let calls = 0;
    const command = {
        async autocomplete(interaction) {
            calls++;
            await interaction.respond([{ name: 'roblox', value: '42' }]);
        }
    };

    const handler = new AutocompleteHandler(createRegistry(command), createFramework({
        autocompleteDebounceMs: 0,
        autocompleteCacheMs: 1000
    }));

    const responses = [];
    await handler.handle(createAutocompleteInteraction({
        value: 'rob',
        onRespond(choices) {
            responses.push(choices);
        }
    }));
    await handler.handle(createAutocompleteInteraction({
        value: 'rob',
        onRespond(choices) {
            responses.push(choices);
        }
    }));

    assert.equal(calls, 1);
    assert.deepEqual(responses, [
        [{ name: 'roblox', value: '42' }],
        [{ name: 'roblox', value: '42' }]
    ]);
});

test('AutocompleteHandler does not answer with stale results from an older in-flight request', async () => {
    let releaseSlow;
    const slowGate = new Promise(resolve => {
        releaseSlow = resolve;
    });

    const command = {
        async autocomplete(interaction) {
            const focused = interaction.options.getFocused();
            if (focused.value === 'old-query') {
                await slowGate;
                return [{ name: 'old', value: '1' }];
            }
            return [{ name: 'new', value: '2' }];
        }
    };

    const handler = new AutocompleteHandler(createRegistry(command), createFramework({
        autocompleteDebounceMs: 0,
        autocompleteCacheMs: 1000
    }));

    const slowResponses = [];
    const fastResponses = [];
    const slowInteraction = createAutocompleteInteraction({
        value: 'old-query',
        onRespond(choices) {
            slowResponses.push(choices);
        }
    });
    const fastInteraction = createAutocompleteInteraction({
        value: 'new-query',
        onRespond(choices) {
            fastResponses.push(choices);
        }
    });

    const slowRun = handler.handle(slowInteraction);
    await Promise.resolve();
    const fastRun = handler.handle(fastInteraction);
    await fastRun;
    releaseSlow();
    await slowRun;

    assert.deepEqual(fastResponses, [[{ name: 'new', value: '2' }]]);
    assert.deepEqual(slowResponses, []);
});
