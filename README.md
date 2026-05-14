# Shiver Framework

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![discord.js](https://img.shields.io/badge/discord.js-14-blue.svg)](https://discord.js.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Modules](https://img.shields.io/badge/modules-50+-blueviolet.svg)](#module-index)
[![AI Ready](https://img.shields.io/badge/AI-ready-orange.svg)](#ai-features)

**A high-performance, infrastructure-first Discord bot framework built on [discord.js](https://discord.js.org/) v14.**

Stop writing boilerplate. Shiver Framework handles command registration, middleware chains, hot-reload, storage adapters, AI integration, and 50+ utilities so you can focus on what your bot actually does.

**Full documentation:** [shiver.one/framework](https://shiver.one/framework)

---

## What's New

| Module | Description |
|--------|-------------|
| `FunctionRegistry` | Export bot commands as OpenAI/Anthropic function-calling schemas |
| `AIContext` | Build structured Discord context for AI agents from any interaction |
| `ConversationContext` | Track per-channel message history in OpenAI messages format |
| `PromptBuilder` | Fluent builder for AI system prompts with guild/user/command context |
| `NaturalCommandRouter` | Route natural language input to registered commands (no external API) |
| `StructuredOutput` | Wrap command handlers to emit typed, AI-readable output events |
| `ComponentRouter` | Declarative wildcard routing for buttons, selects, and modals |
| `WizardSession` | Multi-step interaction wizards with state management and timeout |
| `UserSessionStore` | Per-user key-value sessions with TTL and auto-cleanup |
| `FormBuilder` | Fluent Discord modal builder with validation and parsing |
| `VoteManager` | Full polls/voting system with results and winner calculation |
| `MessageCollector` | High-level prompt-and-collect helper with validation |
| `Scheduler` | Named interval/timeout/cron tasks with pause, resume, cancel |
| `BroadcastManager` | Mass-send to channels, guilds, or DMs with rate-safe delays |
| `RequestDeduplicator` | Deduplicate parallel identical async calls with TTL cache |
| `SafeExecutor` | `safeRun`, `withRetry`, `withTimeout` wrappers |
| `FeatureFlagManager` | Per-guild/user/global feature flags backed by storage |
| `CommandDisabledManager` | Per-guild runtime command enable/disable via storage |
| `AlertManager` | Metric-based alerting with polling and cooldowns |
| `HelpGenerator` | Auto-generate help text from slash command definitions |
| `CommandSuggester` | Fuzzy "did you mean?" matching for prefix typos |
| `DiffTracker` | Compare objects and format changes as Discord-friendly text |
| `LocaleSync` | Apply i18n localizations to slash command definitions |
| `ProgressBar` | Text-based progress bars for Components v2 output |
| `TableBuilder` | ASCII table builder with column alignment and code block export |
| `ListBuilder` | Formatted Discord-markdown lists with sections and styling |
| `TicketSystem` | Full ticket channels: open, close, transcript |
| `GiveawaySystem` | Giveaways with entries, draw, reroll, and persistence |
| `TagSystem` | Per-guild custom tags with variable interpolation and search |
| `StarboardSystem` | Automatic starboard with configurable emoji and threshold |
| `Guards` | `OwnerGuard`, `GuildGuard`, `ChannelGuard`, `RoleGuard`, `TimeGuard`, `RateLimitGuard` |

---

## Install

```bash
npm install shiver-framework
```

Or link locally:

```json
{ "dependencies": { "shiver-framework": "file:./shiver-framework" } }
```

---

## Quick Start

```js
const { ShiverFramework } = require('shiver-framework');
const { Client, GatewayIntentBits } = require('discord.js');

const framework = new ShiverFramework({
    commandsPath: './src/commands',
    prefix: ',',
    storage: { backend: 'json', path: './data' }
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', async () => {
    await framework.init(client);
    await framework.syncSlashCommands(client);
    console.log(`Ready as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
```

---

## Command File Shape

```js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'ping',
    category: 'utility',
    disabled: false,
    aliases: ['p'],
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency'),

    async executeSlash(interaction, client) {
        await interaction.reply('Pong!');
    },

    async executePrefix(message, args, client) {
        await message.reply('Pong!');
    }
};
```

- Set `disabled: true` to hide a command from Discord without deleting code.
- Set `category: 'moderation'` to group commands - use `framework.commands.getByCategory('moderation')`.

---

## AI Features

Shiver Framework is built with AI-first workflows in mind. Whether you're vibe-coding a chatbot, wiring Discord to GPT-4, or building an AI agent that can execute bot actions - all the scaffolding is ready.

### Export bot as AI functions

```js
const { FunctionRegistry } = require('shiver-framework');

const registry = new FunctionRegistry();
registry.registerAllFromCommands(framework.commands.getAllSlash());

const tools = registry.exportOpenAITools();
const response = await openai.chat.completions.create({ model: 'gpt-4o', tools, messages });
```

### Build context for an AI from an interaction

```js
const { AIContext } = require('shiver-framework');

const ctx = await AIContext.fromInteraction(interaction, framework);
const systemPrompt = ctx.toPromptString();
```

### Track conversation history

```js
framework.conversation.add(channelId, { role: 'user', content: message.content, userId: user.id });
const history = framework.conversation.toMessages(channelId, 20);
```

### Build prompts fluently

```js
const { PromptBuilder } = require('shiver-framework');

const messages = PromptBuilder.create()
    .addRule('Always respond in the same language the user used.')
    .addGuildContext(interaction.guild)
    .addUserContext(interaction.user, interaction.member)
    .addCommandList(framework.commands.getAllSlash())
    .addHistory(framework.conversation, channelId)
    .addRole('user', userMessage)
    .toOpenAI();
```

### Natural language command routing

```js
const result = framework.naturalRouter.route('show me server stats');
if (result) {
    const command = framework.commands.getSlash(result.command);
}
```

---

## Interaction Flows

### ComponentRouter

```js
framework.router.button('confirm:*', async (interaction, match) => {
    const [, userId] = match.groups;
    await interaction.reply({ content: 'Confirmed!', ephemeral: true });
});
```

### WizardSession

```js
const { WizardSession } = require('shiver-framework');

const wizard = new WizardSession(interaction, [
    {
        name: 'name',
        async run(wizard, i) {
            await i.reply({ content: 'What is your name?', ephemeral: true });
            const msg = await i.channel.awaitMessages({ filter: m => m.author.id === i.user.id, max: 1, time: 30000 });
            wizard.setData('name', msg.first()?.content);
        }
    }
], { timeoutMs: 60000 });

const data = await wizard.run();
```

### FormBuilder

```js
const { FormBuilder } = require('shiver-framework');

const form = new FormBuilder('Submit Report', 'report:modal')
    .addField('title', 'Report Title', { required: true, maxLength: 100 })
    .addField('details', 'Details', { style: TextInputStyle.Paragraph, required: true });

await interaction.showModal(form.build());

const submitted = await interaction.awaitModalSubmit({ time: 120000 });
const { values, errors, ok } = form.parse(submitted);
```

---

## Scheduler

```js
framework.scheduler.every(60000, 'status-check', async () => {
    console.log('ping:', framework.client.ws.ping);
});

framework.scheduler.cron('0 9 * * *', 'daily-report', async () => {
    await reportChannel.send('Daily summary ready.');
});

framework.scheduler.cancel('status-check');
```

---

## Feature Flags

```js
framework.flags.define('new-leveling', { default: false, description: 'New XP system rollout' });

const enabled = await framework.flags.isEnabled('new-leveling', { guildId });
await framework.flags.enable('new-leveling', { guildId });
```

---

## Systems

### TicketSystem

```js
const { TicketSystem } = require('shiver-framework');
const tickets = new TicketSystem(framework.storage, { supportRoles: ['123456789'] });

const { channel } = await tickets.open(guild, userId, { welcome: 'Support will be with you shortly.' });
const { transcript } = await tickets.close(channel);
```

### GiveawaySystem

```js
const { GiveawaySystem } = require('shiver-framework');
const giveaways = new GiveawaySystem(framework.storage);

const { id } = await giveaways.start(channel, { prize: 'Nitro', winnersCount: 1, durationMs: 3600000 });
await giveaways.enter(id, userId);
const result = await giveaways.draw(id);
```

### TagSystem

```js
const { TagSystem } = require('shiver-framework');
const tags = new TagSystem(framework.storage);

await tags.create(guildId, 'rules', 'Please read <#channelId> before posting.', userId);
const content = await tags.use(guildId, 'rules', { user: 'Username' });
```

---

## Guards

```js
const { OwnerGuard, TimeGuard, RateLimitGuard } = require('shiver-framework');

const ownerGuard = new OwnerGuard(['123456789']);
if (!ownerGuard.check(userId)) return;

const officeHours = new TimeGuard(9, 17, { timezone: 'Europe/Warsaw' });
const rateLimit = new RateLimitGuard(5, 10000);
```

---

## UI Helpers

```js
const { buildProgressBar, TableBuilder, ListBuilder } = require('shiver-framework');

buildProgressBar(750, 1000, { width: 20, showFraction: true });
// ███████████████░░░░░ 75% (750/1000)

const table = new TableBuilder()
    .addColumn('name', 'Name', { width: 16 })
    .addColumn('score', 'Score', { width: 8, align: 'right' })
    .addRow({ name: 'Alice', score: '9800' })
    .addRow({ name: 'Bob', score: '7200' });

await interaction.reply({ content: table.toCodeBlock(), flags: [] });
```

---

## Module Index

| Category | Modules |
|----------|---------|
| Core | `CommandRegistry`, `EventBus`, `Container` |
| AI | `FunctionRegistry`, `AIContext`, `ConversationContext`, `PromptBuilder`, `NaturalCommandRouter`, `StructuredOutput` |
| Interaction | `ComponentRouter`, `WizardSession`, `FormBuilder`, `VoteManager`, `MessageCollector` |
| Sessions | `UserSessionStore` |
| Scheduler | `Scheduler` |
| Infrastructure | `BroadcastManager`, `RequestDeduplicator`, `SafeExecutor` (`safeRun`, `withRetry`, `withTimeout`) |
| DX | `FeatureFlagManager`, `CommandDisabledManager`, `HelpGenerator`, `CommandSuggester`, `DiffTracker`, `LocaleSync`, `AlertManager` |
| UI | `buildProgressBar`, `buildMultiBar`, `TableBuilder`, `ListBuilder` |
| Systems | `TicketSystem`, `GiveawaySystem`, `TagSystem`, `StarboardSystem`, `WelcomeSystem`, `LevelingSystem`, `EconomySystem`, `ReactionRoles`, `AutoMod` |
| Guards | `OwnerGuard`, `GuildGuard`, `ChannelGuard`, `RoleGuard`, `TimeGuard`, `RateLimitGuard` |
| Middleware | `Cooldown`, `Blacklist`, `EnabledPrecondition`, `PreconditionContainer` |
| Storage | `JsonStorageAdapter`, `SupabaseStorageAdapter`, `SQLiteStorageAdapter`, `MongoStorageAdapter` |
| Lifecycle | `HealthManager`, `AntiCrash`, `MultiInstanceDetector` |
| Debug | `LiveDebugPanel`, `Inspector` |
| Sharding | `ShardManager` |

---

**Full documentation:** [shiver.one/framework](https://shiver.one/framework)

Shiver Framework powers **[Shiver](https://shiver.one)** - the same framework the Shiver bot is built on. It was created to make it easy for other developers to build their own Discord bots with the same solid foundation: command loading, slash and prefix, middleware, storage, and production-ready defaults. You get full control over your bot logic while the framework handles infrastructure, safety, and performance.

Shiver Framework gives you the **foundation**-command loading and dispatch, slash and prefix handling, middleware, storage, settings, health endpoints, and safe response handling-without imposing a specific bot design. You keep full control over discord.js types and your app logic; the framework stays a thin, predictable layer optimized for speed and production.

---

## Table of contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Features](#features)
- [Core concepts](#core-concepts)
- [Configuration overview](#configuration-overview)
- [Security](#security)
- [CLI](#cli)
- [Documentation](#documentation)
- [License](#license)

---

## Requirements

| Requirement | Version |
|-------------|---------|
| **Node.js** | ≥ 18 |
| **discord.js** | ^14.25.1 |

**Optional** (only if you use the feature):

| Dependency | Use case |
|------------|----------|
| `redis` | Multi-instance detection, prefix deduplication across processes |
| `canvas` | Image generation (assets or custom commands) |
| `@discordjs/voice` + `prism-media` | Voice channels |
| `@supabase/supabase-js` | Supabase storage backend |
| `better-sqlite3` | SQLite storage backend |
| `mongodb` | MongoDB storage backend |

---

## Installation

From your bot project:

```bash
npm install file:../shiver-framework
```

Or from npm (when published):

```bash
npm install shiver-framework
```

Then in your entry file:

```js
const { ShiverFramework, ShiverClient } = require('shiver-framework');
```

---

## Quick start

```js
const { ShiverFramework, ShiverClient } = require('shiver-framework');
const { GatewayIntentBits } = require('discord.js');

const framework = new ShiverFramework({
    commandsPath: './src/commands',
    prefix: ',',
    ownerIds: ['YOUR_DISCORD_USER_ID']
});

const client = framework.createClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

async function main() {
    await framework.init(client);
    await client.login(process.env.DISCORD_TOKEN);
}

main().catch(console.error);
```

**Example command** - `src/commands/ping.js`:

```js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'ping',
    aliases: ['p'],
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency'),
    async executeSlash(interaction, client) {
        await interaction.editReply({ content: `Pong - ${client.ws.ping}ms` });
    },
    async executePrefix(message, args, client) {
        await message.reply(`Pong - ${client.ws.ping}ms`);
    }
};
```

Slash commands are deferred by default; use `interaction.editReply()` in `executeSlash`.

---

## Features

- **Unified command model** - One file per command. Slash, prefix, context menu, and autocomplete in a single module. No class boilerplate; plain objects with `name`, `data`, `executeSlash`, `executePrefix`.
- **Fast dispatch** - In-memory command lookup, event and prefix deduplication, optional Redis-based cross-process locking so only one instance handles each message.
- **Multi-instance awareness** - Optional Redis heartbeat; when multiple bot processes run, the framework logs a clear warning and a suggested `pkill` so you can stop all and restart once.
- **Production defaults** - REST retries, gateway compression, cache limits and sweepers, optional HTTP health server (`/health`, `/ready`, `/live`, `/metrics`) and custom routes via `health.addRoute()`.
- **Safe responses** - Central `safeRespond`, defer strategies, and safe message edit/delete with benign-error handling and optional debounce to avoid rate limits.
- **Pluggable storage** - JSON by default; swap in Supabase, SQLite, or other backends. Settings and migrations on top.
- **Minimal abstraction** - You work with discord.js types; the framework adds thin wrappers and leaves you in control. No lock-in to a specific UI style (Components v2, embeds, or plain text-your choice).
- **Extensibility** - Plugin system, event bus, DI container, middleware chain. Optional voice, code execution, monetization, moderation API, anti-crash, and sharding support.

---

## Core concepts

After `framework.init(client)`:

| Property | Description |
|----------|-------------|
| `framework.commands` | Command registry: load, get slash/prefix, sync to Discord. |
| `framework.events` | Event bus: `CommandRun`, `CommandError`, `CommandBlocked`, `afterReady`, etc. |
| `framework.storage` | Pluggable key-value storage adapter. |
| `framework.settings` | Guild/user settings backed by storage. |
| `framework.health` | Lifecycle state and optional HTTP health server (with custom routes). |
| `framework.ping` | Gateway and REST latency helper. |
| `framework.httpPush` | Send JSON to external APIs or your website (e.g. stats). |
| `framework.reload` | Reload commands from disk without restart. |
| `framework.modal` | Modal helper; `framework.embedHelper`, `framework.assets`, `framework.debugPanel`, etc. |

Use `framework.createClient(overrides)` to build a `ShiverClient` with sensible cache limits, REST timeouts, and gateway options.

---

## Configuration overview

Options are deep-merged with defaults. Key areas:

- **Core:** `commandsPath`, `prefix`, `getPrefix`, `ownerIds`, `deferStrategy`, `ephemeralByDefault`, `componentCollectorTimeoutMs`, `debug`, `dryRun`.
- **Guards:** `isBlacklisted`, `checkServerBlacklisted`, `checkTOS`, `buildTosReply`, `moderation.checkRoleHierarchy`.
- **Storage:** `storage.backend` (`json`, `memory`, `supabase`, `sqlite`, `mongodb`), `storage.path`, `settings.defaults`, `migrationsPath`.
- **Health:** `health.enabled`, `health.port`, `health.addRoute(method, path, handler)` for custom API routes.
- **Slash sync:** `slashSync.guildIds`, `registration.retryOnRateLimit`, `registration.maxRetries`.
- **Hooks:** `afterReady`, `afterSlashSync`, `onCommandRun`, `onCommandError`, `onCommandBlocked`.
- **Prefix dedup:** `tryAcquirePrefixMessage` - optional async function (e.g. Redis SET NX) so only one process handles each prefix message when multiple instances run.

All options and full reference are on **[shiver.one/framework](https://shiver.one/framework)**.

---

## Security

- **Token:** Load from the environment (e.g. `process.env.DISCORD_TOKEN`). Never commit or log it. The framework uses **log redaction** (`safeError`, `redactSecrets`) so tokens and secrets never appear in console output.
- **User-facing errors:** Use generic messages (e.g. “This command is currently unavailable”); log details server-side only. Helpers like `createGenericErrorPayload` and `createWarningPayload` keep responses consistent and safe.
- **HTTP push:** When sending data to external URLs, use `framework.httpPush()`; its error logging is redaction-safe.

---

## CLI

Run from a project that depends on the framework (or from the framework directory):

| Command | Description |
|---------|-------------|
| `npx shiver-framework validate [commandsDir]` | Validate command files (default: `src/commands`). |
| `npx shiver-framework sync [token] [commandsDir]` | Register slash commands with Discord. Token from args or `DISCORD_TOKEN`. |
| `npx shiver-framework generate <type> <name> [dir]` | Scaffold a command, listener, precondition, or system file. |

---

## Documentation

All documentation is on **[shiver.one/framework](https://shiver.one/framework)**. There you will find the full option reference, configuration, command system (registry, slash, prefix, context menu, autocomplete, component handlers), middleware and preconditions, handlers and response safety (safeRespond, safeEdit, safeDelete, MessageEditDeleteHelper), storage and settings (including `migrationsPath` and migrations), assets, Components v2, modals, pagination, confirmation, reload, debug, stats, health and custom API routes, lifecycle and multi-instance detection, shutdown, voice, code execution, monetization, moderation, anti-crash, sharding, events and container, CLI, testing, security, AI-friendly guidelines, and examples. Run tests with `npm test`.

---

## License

MIT. See the [LICENSE](LICENSE) file in this repository.
