const { OAuth2Scopes, PermissionFlagsBits } = require('discord.js');

function getInviteUrl(client, options = {}) {
    const scopes = options.scopes ?? [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands];
    const permissions = options.permissions ?? [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.UseExternalEmojis
    ];

    return client.generateInvite({ scopes, permissions });
}

module.exports = { getInviteUrl };
