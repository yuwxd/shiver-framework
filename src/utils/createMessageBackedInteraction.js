const { safeEdit } = require('./Helpers');

function createMessageBackedInteraction(message, overrides = {}) {
    let replyMessage = overrides.replyMessage ?? null;
    let deferred = overrides.deferred === true;
    let replied = overrides.replied === true;

    const interaction = {
        guild: message.guild ?? null,
        channel: message.channel,
        user: message.author,
        member: message.member ?? null,
        createdTimestamp: message.createdTimestamp,
        id: message.id,
        deferred,
        replied,
        options: overrides.options ?? {},
        async deferReply() {
            interaction.deferred = true;
        },
        async deferUpdate() {
            interaction.deferred = true;
        },
        async reply(payload) {
            replyMessage = await message.channel.send(payload);
            interaction.replied = true;
            return replyMessage;
        },
        async editReply(payload) {
            if (replyMessage && payload != null) {
                const edited = await safeEdit(replyMessage, payload);
                if (edited) {
                    replyMessage = edited;
                    interaction.replied = true;
                    return replyMessage;
                }
            }
            replyMessage = await message.channel.send(payload);
            interaction.replied = true;
            return replyMessage;
        },
        async followUp(payload) {
            return message.channel.send(payload);
        },
        async fetchReply() {
            return replyMessage;
        }
    };

    return Object.assign(interaction, overrides);
}

module.exports = { createMessageBackedInteraction };
