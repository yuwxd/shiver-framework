# Shiver Framework

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![discord.js](https://img.shields.io/badge/discord.js-14-blue.svg)](https://discord.js.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**A high-performance, infrastructure-first Discord bot framework built on [discord.js](https://discord.js.org/) v14.**

**Full documentation (web):** [shiver.one/framework](https://shiver.one/framework)

Shiver Framework powers **[Shiver](https://shiver.one)** — the same framework the Shiver bot is built on. It was created to make it easy for other developers to build their own Discord bots with the same solid foundation: command loading, slash and prefix, middleware, storage, and production-ready defaults. You get full control over your bot logic while the framework handles infrastructure, safety, and performance.

Shiver Framework gives you the **foundation**—command loading and dispatch, slash and prefix handling, middleware, storage, settings, health endpoints, and safe response handling—without imposing a specific bot design. You keep full control over discord.js types and your app logic; the framework stays a thin, predictable layer optimized for speed and production.

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

**Example command** — `src/commands/ping.js`:

```js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'ping',
    aliases: ['p'],
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency'),
    async executeSlash(interaction, client) {
        await interaction.editReply({ content: `Pong — ${client.ws.ping}ms` });
    },
    async executePrefix(message, args, client) {
        await message.reply(`Pong — ${client.ws.ping}ms`);
    }
};
```

Slash commands are deferred by default; use `interaction.editReply()` in `executeSlash`.

---

## Features

- **Unified command model** — One file per command. Slash, prefix, context menu, and autocomplete in a single module. No class boilerplate; plain objects with `name`, `data`, `executeSlash`, `executePrefix`.
- **Fast dispatch** — In-memory command lookup, event and prefix deduplication, optional Redis-based cross-process locking so only one instance handles each message.
- **Multi-instance awareness** — Optional Redis heartbeat; when multiple bot processes run, the framework logs a clear warning and a suggested `pkill` so you can stop all and restart once.
- **Production defaults** — REST retries, gateway compression, cache limits and sweepers, optional HTTP health server (`/health`, `/ready`, `/live`, `/metrics`) and custom routes via `health.addRoute()`.
- **Safe responses** — Central `safeRespond`, defer strategies, and safe message edit/delete with benign-error handling and optional debounce to avoid rate limits.
- **Pluggable storage** — JSON by default; swap in Supabase, SQLite, or other backends. Settings and migrations on top.
- **Minimal abstraction** — You work with discord.js types; the framework adds thin wrappers and leaves you in control. No lock-in to a specific UI style (Components v2, embeds, or plain text—your choice).
- **Extensibility** — Plugin system, event bus, DI container, middleware chain. Optional voice, code execution, monetization, moderation API, anti-crash, and sharding support.

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
- **Storage:** `storage.backend` (`json`, `memory`, `supabase`, `sqlite`, …), `storage.path`, `settings.defaults`.
- **Health:** `health.enabled`, `health.port`, `health.addRoute(method, path, handler)` for custom API routes.
- **Slash sync:** `slashSync.guildIds`, `registration.retryOnRateLimit`, `registration.maxRetries`.
- **Hooks:** `afterReady`, `afterSlashSync`, `onCommandRun`, `onCommandError`, `onCommandBlocked`.

The full option reference is in **[docs/DOCS.md](docs/DOCS.md)**.

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

- **Full documentation (web):** [**shiver.one/framework**](https://shiver.one/framework) — readable in the browser, same content as this README and the in-repo reference. Use the web docs or the repo; both are kept in sync.
- **In-repo reference:** [docs/DOCS.md](docs/DOCS.md) — full option reference and detailed guides.

Both cover:

- Configuration and all options  
- Command system (registry, slash, prefix, context menu, autocomplete, component handlers)  
- Middleware and preconditions  
- Handlers and response safety (safeRespond, safeEdit, safeDelete, MessageEditDeleteHelper)  
- Storage, settings, assets, migrations  
- Components v2, modals, pagination, confirmation  
- Reload, debug, stats, health, custom API routes  
- Lifecycle, multi-instance detection, shutdown  
- Voice, code execution, monetization  
- Moderation, anti-crash, sharding  
- Plugins, events, container  
- CLI and testing  
- Security, AI-friendly guidelines, examples  

---

## License

MIT. See the [LICENSE](LICENSE) file in this repository.
