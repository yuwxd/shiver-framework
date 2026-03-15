const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockInteraction } = require('../src/testing/mocks');
const { safeRespond } = require('../src/handlers/safeRespond');

test('safeRespond calls reply when not replied or deferred', async () => {
    let replied = false;
    const interaction = createMockInteraction({
        onReply: () => { replied = true; }
    });
    await safeRespond(interaction, { content: 'ok' });
    assert.equal(replied, true);
});

test('safeRespond calls editReply when deferred', async () => {
    let edited = false;
    const interaction = createMockInteraction({
        onEditReply: () => { edited = true; },
        onDeferReply: () => {}
    });
    await interaction.deferReply?.();
    await safeRespond(interaction, { content: 'ok' });
    assert.equal(edited, true);
});

test('safeRespond dryRun does not call reply', async () => {
    let replied = false;
    const interaction = createMockInteraction({
        onReply: () => { replied = true; }
    });
    await safeRespond(interaction, { content: 'ok' }, { dryRun: true });
    assert.equal(replied, false);
});
