# Shiver Framework — Documentation

**A high-performance, infrastructure-first Discord bot framework built on discord.js.**

This document is the authoritative reference for Shiver Framework. It describes every major system, configuration option, and API surface so you can build production-ready bots without guessing.

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Why Shiver Framework](#2-why-shiver-framework)
3. [Requirements and installation](#3-requirements-and-installation)
4. [Quick start](#4-quick-start)
5. [Core concepts](#5-core-concepts)
6. [Configuration reference](#6-configuration-reference)
7. [Command system](#7-command-system)
8. [Middleware and preconditions](#8-middleware-and-preconditions)
9. [Handlers and response safety](#9-handlers-and-response-safety)
10. [Storage and settings](#10-storage-and-settings)
11. [Assets](#11-assets)
12. [Components v2, modals, pagination](#12-components-v2-modals-pagination)
13. [Reload and debug](#13-reload-and-debug)
14. [Stats and health](#14-stats-and-health)
15. [Lifecycle and multi-instance detection](#15-lifecycle-and-multi-instance-detection)
16. [Voice, code execution, monetization](#16-voice-code-execution-monetization)
17. [Moderation, anti-crash, sharding](#17-moderation-anti-crash-sharding)
18. [Plugins](#18-plugins)
19. [Events and container](#19-events-and-container)
20. [CLI](#20-cli)
21. [Testing](#21-testing)
22. [Custom IDs and validation](#22-custom-ids-and-validation)
23. [Security](#23-security)
24. [AI rules and development guidelines](#24-ai-rules-and-development-guidelines)
25. [Examples](#25-examples)
26. [Vibe code and AI-friendly design](#26-vibe-code-and-ai-friendly-design)
27. [Module index](#27-module-index-main-sources)

---

## 1. Introduction

Shiver Framework provides the **infrastructure** for Discord bots: command loading and dispatch, slash and prefix handling, middleware pipelines, storage, settings, assets, and optional systems (voice, code execution, monetization). It does **not** ship business logic or ready-made commands; you implement those on top of the framework.

Design principles:

- **Minimal abstraction** — You work with discord.js types and the framework’s thin wrappers. No heavy OOP hierarchies or “magic” that hides the platform.
- **Explicit over implicit** — Commands are plain modules with a well-defined shape. Options are passed in; behavior is predictable.
- **Performance-first** — Event deduplication, optional Redis-based cross-process coordination, and efficient caching so the bot stays responsive under load.
- **Framework-agnostic storage** — Pluggable backends (JSON, Supabase, etc.) so you can switch or scale without rewriting your bot.

Supported runtimes: **Node.js 18+**. Primary dependency: **discord.js ^14**.

---

## 2. Why Shiver Framework

### Advantages over other Discord frameworks

| Aspect | Shiver Framework | Typical alternatives |
|--------|------------------|----------------------|
| **Abstraction level** | Thin layer over discord.js; you keep full control of interactions and messages. | Some frameworks wrap everything in custom types and lifecycle hooks. |
| **Command format** | Single file per command; `name`, `data`, `executeSlash`, `executePrefix`. No class boilerplate unless you want it. | Class-based or decorator-based command definitions. |
| **Slash and prefix** | First-class support for both in one command module; same middleware and preconditions for both. | Often slash-only or prefix as an afterthought. |
| **Deduplication** | Built-in event and prefix execution deduplication; optional Redis lock so only one process handles each message when multiple instances run. | Duplicate responses common when multiple processes or listeners exist. |
| **Multi-instance awareness** | Optional Redis heartbeat; detects multiple bot instances and logs a clear “stop all, then restart” message with a generated `pkill` command. | No built-in detection; duplicate instances cause confusion. |
| **Response safety** | Central `safeRespond` and deferred-reply handling so you avoid “interaction already replied” and timeout errors. | Left to the developer. |
| **Storage** | Pluggable adapter (JSON, Supabase, etc.); settings and migrations on top. | Often tied to one DB or none. |
| **Extensibility** | Plugin system, event bus, container for DI; middleware chain for commands. | Varies; some are closed. |

### What makes it stand out

- **Lightning-fast command dispatch** — Commands are looked up by name from in-memory maps; middleware runs in a single async chain with no unnecessary awaits.
- **Production-oriented defaults** — REST retries, gateway compression, cache limits and sweepers, and optional health endpoints.
- **One codebase for framework and bot** — You can develop the framework and your bot in tandem (e.g. via `file:../shiver-framework`); no need to publish to npm to iterate.
- **Open design** — No lock-in to a specific UI or command style; you can adopt Discord’s Components v2, embeds, or plain text as you prefer.

---

## 3. Requirements and installation

### Requirements

- **Node.js** ≥ 18
- **discord.js** ^14.25.1

Optional (only if you use the corresponding features):

- **redis** — Multi-instance detection, prefix deduplication across processes, caching
- **canvas** — Image generation in assets or custom code
- **@discordjs/voice**, **prism-media** — Voice
- **@supabase/supabase-js** — Supabase storage backend
- **better-sqlite3** — SQLite storage backend
- **mongodb** — MongoDB storage backend (if you implement an adapter)

### Installation

From a project that will use the framework (e.g. your bot):

```bash
npm install file:../shiver-framework
```

Or, when published:

```bash
npm install shiver-framework
```

Then in your entry file:

```js
const { ShiverFramework, ShiverClient } = require('shiver-framework');
```

---

## 4. Quick start

Minimal example: create a client, configure the framework, init, and login.

```js
const { ShiverFramework, ShiverClient } = require('shiver-framework');
const { GatewayIntentBits } = require('discord.js');

const framework = new ShiverFramework({
    commandsPath: './src/commands',
    prefix: ',',
    ownerIds: ['YOUR_DISCORD_USER_ID']
});

const client = framework.createClient({
    rest: { timeout: 30000 },
    cacheOptions: { messageCacheSize: 200 }
});

async function main() {
    await framework.init(client);
    await client.login(process.env.DISCORD_TOKEN);
}

main().catch(console.error);
```

After `init`, the framework:

- Attaches to the client and loads commands from `commandsPath`
- Registers Discord event listeners for interactions and messages
- Sets up storage, settings, and optional systems (stats, health, reload, etc.)

Example command file `src/commands/ping.js`:

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

Slash commands are deferred by default when `deferStrategy` is `'always'`, so use `editReply` in `executeSlash`.

---

## 5. Core concepts

### 5.1 Framework instance

`ShiverFramework` is the root object. You pass options at construction; they are merged with defaults. After `init(client)` you use:

| Property | Description |
|----------|-------------|
| `framework.commands` | Command registry: load, get slash/prefix, sync to Discord. |
| `framework.container` | Dependency-injection container (e.g. `container.set('logger', logger)`). |
| `framework.events` | Event bus: `CommandRun`, `CommandError`, `CommandBlocked`, `afterReady`, etc. |
| `framework.stats` | Counters and metrics (e.g. commands run, errors). |
| `framework.health` | Lifecycle state and optional HTTP health endpoint. |
| `framework.reload` | Reload commands from disk without restart. |
| `framework.modal` | Helper to show modals and parse submissions. |
| `framework.assets` | Load fonts and images from the bot’s base dir. |
| `framework.debugPanel` | Optional live debug overlay. |
| `framework.antiCrash` | Optional uncaught-exception and rejection handling. |
| `framework.settings` | Guild/user settings backed by storage. |
| `framework.storage` | Pluggable key-value storage adapter. |
| `framework.migrations` | Run migrations on storage. |
| `framework.ping` | PingHelper instance: gateway/REST latency (see [Examples](#25-examples)). |
| `framework.httpPush` | `pushJson(url, payload, opts)` for sending JSON to external APIs or your website. |

You can also use `framework.createClient(overrides)` to build a `ShiverClient` with framework defaults applied.

### 5.2 ShiverClient

`ShiverClient` extends `discord.js`’s `Client` and applies sensible defaults:

- Cache limits (messages, members, users) and sweepers so memory stays bounded
- REST timeouts and retry options
- Gateway compression and large_threshold

You can override via `framework.getClientOptions(overrides)` or `framework.createClient(overrides)`.

### 5.3 Init flow

1. `framework.init(client)` binds the client, loads commands from `commandsPath`, and calls `registerListeners(client)`.
2. Listeners for `interactionCreate` and `messageCreate` are registered once; internal deduplication prevents double-handling of the same event.
3. Optional multi-instance detector starts (if `multiInstance` is enabled and Redis is available).
4. On Discord `clientReady`, slash sync (if configured), `afterReady`, and `health.markReady()` run.

---

## 6. Configuration reference

All options are merged with `DEFAULT_OPTIONS`. Deep merge is applied so you can override nested keys without replacing entire objects.

### 6.1 Core options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `client` | `object` | `{}` | Passed to `buildShiverClientOptions` when creating the client. |
| `commandsPath` | `string` | `'./commands'` | Directory from which to load command files (recursive; `.js` only; files starting with `_` are ignored). |
| `prefix` | `string` | `','` | Fallback prefix when `getPrefix` is not set or returns invalid/empty. Cannot be `'/'`. |
| `getPrefix` | `function \| null` | `null` | `async (message, framework) => string`. Resolve prefix per message (e.g. from guild settings). |
| `ownerIds` | `string[]` | `[]` | Discord user IDs treated as bot owners (for permissions or admin commands). |
| `deferStrategy` | `'always' \| 'whenSlow' \| 'never'` | `'whenSlow'` | Slash defer: `always` = defer immediately; `whenSlow` = defer after threshold if no reply yet; `never` = no auto-defer. |
| `deferWhenSlowThresholdMs` | `number` | `1500` | Milliseconds after which to defer when strategy is `whenSlow`. |
| `componentDeferWhenSlowThresholdMs` | `number` | `1000` | Same for component interactions. |
| `ephemeralByDefault` | `boolean` | `false` | If true, deferred slash replies use `ephemeral: true` unless overridden per command. |
| `componentCollectorTimeoutMs` | `number` | `300000` | Default timeout for button/select collectors (e.g. pagination, confirm). |
| `commandResponseTimeoutMs` | `number` | `30000` | General command response timeout hint. |
| `autocompleteCacheMs` | `number` | `5000` | How long to cache autocomplete results. |
| `autocompleteDebounceMs` | `number` | `0` | Debounce delay for autocomplete. |
| `maxOptionStringLength` | `number` | `6000` | Max length for string options (normalization). |
| `normalizeOptionStrings` | `boolean` | `false` | Whether to trim and normalize option strings. |
| `strictComponentHandling` | `boolean` | `false` | If true, require explicit component handler match. |
| `componentHandlerNames` | `string[]` | `['handleButton', 'handleSelect', …]` | Method names on commands used for component handling. |
| `debug` | `boolean` | `false` | Enable the live debug panel. |
| `dryRun` | `boolean` | `false` | If true, `safeRespond` only logs; no reply/edit/followUp. |
| `errorHandling.level` | `string` | `'friendly'` | Error presentation level (e.g. hide stack from users). |
| `suppressSlashHandlerConsoleErrors` | `boolean` | — | If set, slash/prefix handler does not log errors to console. |

### 6.2 Moderation and guards

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `moderation.checkRoleHierarchy` | `boolean` | `true` | Whether to enforce role hierarchy in moderation API. |
| `checkTOS` | `function \| null` | `null` | `async (userId) => boolean`. Whether user accepted ToS. |
| `buildTosReply` | `function \| null` | `null` | `async () => payload`. Reply shown when ToS not accepted. |
| `isBlacklisted` | `function \| null` | `null` | `async (userId) => boolean`. User blacklist. |
| `checkServerBlacklisted` | `function \| null` | `null` | `async (guildId) => boolean`. Guild blacklist. |
| `isUserAllowed` | `function \| null` | `null` | `async (userId) => boolean`. Extra allow check. |
| `checkServerCommand` | `function \| null` | `null` | Optional server-specific command gate. |

### 6.3 REST and cache

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rest.retryOn5xx` | `boolean` | `true` | Retry REST on 5xx. |
| `rest.retryOn429` | `boolean` | `true` | Retry on rate limit. |
| `rest.maxRetries` | `number` | `3` | Max retry count. |
| `rest.maxRetryDelayMs` | `number` | `30000` | Max delay between retries. |
| `cache.messageCacheSize` | `number` | `200` | Discord.js message cache size (0 = disable). |
| `cache.memberCacheSize` | `number` | `500` | Member cache size. |
| `cache.userCacheSize` | `number` | `1000` | User cache size. |
| `cache.sweepIntervalMs` | `number` | `3600000` | Sweeper interval. |
| `cache.sweepMessageLifetimeMs` | `number` | `3600000` | Message cache TTL for sweep. |
| `cache.sweepMemberLifetimeMs` | `number` | `3600000` | Member cache TTL. |
| `cache.settingsTTLMs` | `number` | `60000` | In-memory settings cache TTL. |
| `cache.settingsMaxSize` | `number` | `1000` | Max cached settings entries. |
| `gateway.compress` | `boolean` | `true` | Gateway compression. |
| `gateway.large_threshold` | `number` | `50` | Large guild threshold. |

### 6.4 Storage and settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage.backend` | `string` | `'json'` | One of: `json`, `memory`, `mongo`, `supabase`, `sqlite`. |
| `storage.path` | `string` | `'./data'` | For JSON: directory or file path. For others: connection/config. |
| `storage.filePath` | `string` | - | JSON adapter: explicit file path (overrides `path` when set). |
| `migrationsPath` | `string \| null` | `null` | Directory containing migration files (e.g. `001_add_users.js`). If `null` or path missing, no migrations run. Used by `framework.migrations.run()` to evolve storage schema or data safely. |
| `settings.defaults.guild` | `object` | `{}` | Default guild settings. |
| `settings.defaults.user` | `object` | `{}` | Default user settings. |

### 6.5 Health and lifecycle

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `health.enabled` | `boolean` | `false` | Start HTTP health server. |
| `health.host` | `string` | `'0.0.0.0'` | Bind address. |
| `health.port` | `number` | `8080` | Port. |
| `health.shutdownTimeout` | `number` | `10000` | Grace period before force exit. |
| `multiInstance` | `boolean \| object` | `false` | Enable multi-instance detector. If object: `{ groupId?, processMatchPattern? }`. |

### 6.6 Slash sync and registration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `slashSync.guildIds` | `string[] \| null` | `null` | Guild IDs for guild-specific slash sync; `null` = global. |
| `registration.retryOnRateLimit` | `boolean` | `true` | Retry sync on 429. |
| `registration.maxRetries` | `number` | `3` | Max sync retries. |
| `registration.onRateLimit` | `function \| null` | `null` | Callback when rate limited during sync. |

### 6.7 Callbacks (hooks)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `afterReady` | `function \| null` | `null` | `async (client) => void`. Called after client ready and optional slash sync. |
| `afterSlashSync` | `function \| null` | `null` | `async (applicationCommands) => void`. After slash sync. |
| `afterPrefixMessage` | `function \| null` | `null` | `(message) => void`. Called for every message after prefix handling (whether command or not). |
| `onCommandRun` | `function \| null` | `null` | `(interaction \| message, commandName) => void \| Promise`. After successful command run. |
| `onCommandBlocked` | `function \| null` | `null` | `(interaction \| message, commandName) => void`. When middleware/preconditions block. |
| `onCommandError` | `function \| null` | `null` | `(interaction \| message, commandName, error) => void`. When command throws. |
| `tryAcquirePrefixMessage` | `function \| null` | `null` | `async (messageId) => boolean`. Called before running a prefix command; return `true` to allow execution, `false` to skip. Use e.g. Redis SET NX so only one process handles each message when multiple bot instances run. |

### 6.8 Assets, voice, execute, monetization, i18n

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `assets.baseDir` | `string` | `process.cwd()` | Base directory for assets (fonts, images). |
| `voice.maxBitrateKbps` | `number` | `128` | Max voice bitrate. |
| `voice.maxDurationSeconds` | `number` | `600` | Max track duration. |
| `voice.transcode` | `boolean` | `false` | Whether to transcode. |
| `voice.nodeSelection` | `string` | `'auto'` | Node selection for voice. |
| `execute.backend` | `string` | `'piston'` | Code execution backend. |
| `execute.pistonUrl` | `string` | Piston API URL | Piston server URL. |
| `execute.timeoutMs` | `number` | `10000` | Execution timeout. |
| `execute.maxCodeLength` | `number` | `10000` | Max code length. |
| `monetization.enabled` | `boolean` | `false` | Enable monetization. |
| `monetization.webhookPath` | `string` | `'/webhook/monetization'` | Webhook path for payment events. |
| `monetization.premium.backend` | `string` | `'discord'` | Premium backend. |
| `monetization.premium.requiredSkuIds` | `string[]` | `[]` | SKU IDs for premium. |
| `monetization.premium.cacheTTLMs` | `number` | `300000` | Entitlement cache TTL. |
| `i18n.defaultLocale` | `string` | `'en'` | Default locale. |
| `i18n.messages` | `object` | `{}` | Locale key → message map. |
| `messageTestingPhase` | `string` | (testing message) | Message shown when bot is in testing phase (if `hasAccess` uses it). |

---

## 7. Command system

### 7.1 Command registry API

`framework.commands` is a `CommandRegistry` instance.

**Loading**

- `loadFromDirectory(dirPath)` — Scans `dirPath` recursively for `.js` files (skips names starting with `_`), clears `require.cache` for each, requires the file, and registers the exported object. Returns `{ loaded, errors }` where `loaded` is the number of slash commands registered and `errors` is an array of `{ file, error }`.
- `registerPath(dirPath)` — Alias for `loadFromDirectory(dirPath)`.
- `loadPiece({ name, piece })` — Register a single command object; `piece.__sourcePath` can be set to `name` for reload tracking.
- `registerCommand(piece)` — Internal; called for each valid piece. Registers by `data.name` (slash) and `name` + `aliases` (prefix). If `piece.__sourcePath` is set, removes any previous command from the same path first.

**Lookup**

- `getSlash(name)` — Returns the command registered for slash name `name`, or `undefined`.
- `getPrefix(name)` — Returns the command registered for prefix/alias `name`, or `undefined`.
- `getAllSlash()` — Returns an array of unique slash commands (by primary name).
- `getAllPrefix()` — Returns an array of unique prefix commands (by primary name).

**Source paths**

- `getSourcePath(name)` — Returns the file path from which the command was loaded, or `null`.
- `getSourcePathsMap()` — Returns a `Map` of command name → source path.
- `removeBySourcePath(sourcePath)` — Unregisters all commands that were loaded from `sourcePath`.

**Slash sync**

- `syncToDiscord(client, options)` — Builds JSON payloads from all slash commands, validates name/description length, and calls Discord API to set application commands. `options.guildIds` can be `null` (global) or an array of guild IDs for guild-specific sync. Uses `options.registration?.maxRetries` and `retryOnRateLimit`. Returns `{ synced, applicationCommands }` or similar. Rate limit and validation errors are logged when `options.debug` is set.

**Validation (when `options.debug` is true)**

- Warns if `name` or `data` is missing, if no execute handler exists, or if description/name length exceeds Discord limits.

### 7.2 Command file shape (full reference)

Each command file must export a single object. The following fields are supported:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes for prefix | Primary name. Used for prefix dispatch and as identifier. |
| `aliases` | `string[]` | No | Additional prefix aliases (e.g. `['p', 'ping']`). |
| `data` | `SlashCommandBuilder \| ContextMenuCommandBuilder` | Yes for slash | Discord.js builder. Must have `name` (and for slash, `description`). |
| `executeSlash` | `(interaction, client) => Promise<void>` | No | Invoked for chat input commands after middleware and preconditions. Use `interaction.editReply` if deferred. |
| `executePrefix` | `(message, args, client, commandName) => Promise<void>` | No | Invoked for prefix commands. `args` is the array of arguments after the command name; `commandName` is the alias used. |
| `executeContextMenu` | `(interaction, client) => Promise<void>` | No | Invoked for user/message context menu commands. |
| `handleAutocomplete` | `(interaction, client) => Promise<void>` | No | Invoked for autocomplete; call `interaction.respond(choices)`. |
| `handleButton` | `(interaction, client) => Promise<void>` | No | Called when a button with matching `customId` prefix is used. |
| `handleSelect`, `handleSelectMenu`, `handleModalSubmit`, `handleModal`, `handleMusicSelect` | `function` | No | Same pattern for other component types. Names come from `options.componentHandlerNames`. |
| `preconditions` | `(string \| object)[]` | No | Run after middleware; if any fail, command is not executed. |
| `cooldown` | `number \| object` | No | Cooldown configuration for the cooldown middleware. |
| `adminOnly` | `boolean` | No | If `true`, the command is not registered for prefix (slash still is). |
| `deferStrategy` | `'always' \| 'whenSlow' \| 'never'` | No | Override framework default for this command. |
| `ephemeral` | `boolean` | No | Override ephemeral default for slash. |
| `getDisabledPath` | `(args, commandName) => string \| null` | No | For prefix subcommands: return the path used by the disabled middleware (e.g. `profile view`). |
| `customIdPrefixes` | `string[]` | No | For InteractionHandler: customId must start with one of these to match this command. |

**Subcommands (slash)**  
Use `data.addSubcommand(sub => sub.setName('view').setDescription('…'))` and optionally `addSubcommandGroup`. In `executeSlash`, use `interaction.options.getSubcommand()` and `getSubcommandGroup(false)` to branch.

**Subcommand groups**  
Use `data.addSubcommandGroup(group => group.setName('…').addSubcommand(…))`. Read with `getSubcommandGroup()` and `getSubcommand()`.

### 7.3 Slash handler

Slash commands go through `SlashHandler`:

1. Normalize options (optional trimming and length limits)
2. Build context and run middleware chain: defer, lockdown, server blacklist, blacklist, TOS, premium, rate limit, cooldown, disabled, permissions, preconditions
3. Call `command.executeSlash(interaction, client)`
4. Emit `CommandRun`; on error emit `CommandError` and send a safe error reply

If the command or middleware blocks, `CommandBlocked` is emitted and no reply is sent unless the middleware sends one.

### 7.4 Prefix handler

Prefix commands go through `PrefixHandler`:

1. Skip bot messages, slash/context menu message types, and messages that already have an interaction
2. Deduplicate by `message.id` (in-process and optional Redis `tryAcquirePrefixMessage`)
3. Resolve prefix via `getPrefix(message, framework)` (async supported)
4. Parse content after prefix into args (quoted strings supported)
5. Look up command by first token; run same middleware chain (lockdown, blacklist, TOS, etc.) then `command.executePrefix(message, args, client, commandName)`

Prefix deduplication: the framework can call `tryAcquirePrefixMessage(messageId)` before running the command; if the bot supplies a Redis SET NX implementation, only one process will run the command when multiple instances are up.

### 7.5 Context menu and autocomplete

- **Context menu**: register with `ContextMenuCommandBuilder` and `executeContextMenu`. Handled by `ContextMenuHandler`.
- **Autocomplete**: options with `setAutocomplete(true)` and `handleAutocomplete` in the command. Handled by `AutocompleteHandler`.

### 7.6 Interaction handler (buttons, selects, modals)

Commands can expose `handleButton`, `handleSelect`, `handleSelectMenu`, `handleModalSubmit`, etc. The framework’s `InteractionHandler` matches `customId` prefixes to commands and invokes the appropriate handler. Use `framework.buildCustomId(prefix, command, action, userId)` for consistent IDs.

---

## 8. Middleware and preconditions

### 8.1 Middleware chain

Both slash and prefix flows use a `MiddlewareChain`: an ordered array of async functions `(context, next) => Promise`. Each middleware may:

- Call `await next()` to continue to the next middleware or the command.
- Omit calling `next()` to stop the chain (and optionally send a reply).
- Set `context.blocked = true` before calling `next()` so the command body is skipped but the chain continues (e.g. for logging).

The `context` object contains at least: `interaction` (slash) or `message` (prefix), `command`, `container`, `options`, `client`, `traceId`, `commandKey`, and for prefix `args`, `commandName`, `prefixPath`. Slash context also has `deferred` (set by Defer middleware).

### 8.2 Built-in middleware (order)

**Slash:** Defer → Lockdown → ServerBlacklist → Blacklist → TOS → Premium → RateLimit → Cooldown → Disabled → Permissions → (preconditions) → command execution.

**Prefix:** Lockdown → ServerBlacklist → Blacklist → TOS → Premium → RateLimit → Cooldown → Disabled → Permissions → (preconditions) → command execution.

| Middleware | Purpose | Options / container |
|------------|---------|---------------------|
| **Defer** | Defers slash interaction when strategy is `always` or after `deferWhenSlowThresholdMs` when `whenSlow`. Sets `context.deferred`. | `deferStrategy`, `deferWhenSlowThresholdMs`, `ephemeralByDefault`; per-command `deferStrategy`, `ephemeral`. |
| **Lockdown** | Blocks commands when the framework or guild is in lockdown. | Container/storage or options for lockdown state. |
| **ServerBlacklist** | Blocks if the guild is blacklisted. | `options.checkServerBlacklisted(message \| interaction)`. |
| **Blacklist** | Blocks if the user is blacklisted. | `options.isBlacklisted(userId)`. |
| **TOS** | Blocks if user has not accepted ToS. Can send a reply from `buildTosReply`. | `options.checkTOS(userId)`, `options.buildTosReply()`. |
| **Premium** | Can block or restrict by premium status. | Container `premium` or options; premium middleware config. |
| **RateLimit** | Per-user or per-guild rate limiting. | Rate limit backend from container or options. |
| **Cooldown** | Per-command cooldown from `command.cooldown`. | `command.cooldown` (number or object). |
| **Disabled** | Blocks if the command (or subcommand path) is disabled. | Container `disabledCommands` with `isDisabled(path)`. |
| **Permissions** | Checks Discord permissions and/or custom levels. | Permission manager from container; command requirements. |

### 8.3 Preconditions

Preconditions run after the above middleware, inside the handler. They are listed in `command.preconditions` (array of precondition names or config objects). The precondition system receives the same `context`; if any precondition fails, it can set `context.blocked = true` and optionally send a message (e.g. “This command cannot be used in DMs”). The command’s `executeSlash` / `executePrefix` is not called when blocked.

### 8.4 Custom middleware

Add framework-level middleware so it runs for every slash and prefix command:

```js
framework.use(async (context, next) => {
    const { interaction, message, command, container, options, client } = context;
    await next();
});
```

You can read or mutate `context` and decide whether to call `next()` or send a reply and stop.

---

## 9. Handlers and response safety

### 9.1 safeRespond

`safeRespond(interaction, payload, options)` is the central helper for replying to interactions. It is used internally by the framework and can be used in commands or middleware.

**Behavior**

1. If `options.dryRun === true`, logs a short representation of `payload` and returns without sending.
2. If `payload._preferUpdate === true`, it is removed from the payload and, for component interactions (button, select, modal submit) that have not yet replied or deferred, `interaction.update(payload)` is used and the function returns.
3. Otherwise:
   - If `interaction.replied` is true → `interaction.followUp(payload)`.
   - Else if `interaction.deferred` is true → `interaction.editReply(payload)`.
   - Else → `interaction.reply(payload)`.
4. On error, if the interaction was never replied nor deferred, it attempts `interaction.reply({ content: 'An error occurred.', ephemeral: true })` to avoid “unacknowledged” errors.

**Payload** can be any valid reply/edit/followUp payload: `content`, `embeds`, `components`, `files`, `flags` (e.g. `MessageFlags.Ephemeral`), etc.

### 9.2 Defer strategies

- **`always`** — The Defer middleware calls `interaction.deferReply({ ephemeral })` immediately. Your handler must use `interaction.editReply(...)` and has up to 15 minutes.
- **`whenSlow`** — A timer is started. If the handler calls `reply` or `editReply` before the threshold, no defer happens. If the threshold passes without a response, the middleware defers so the handler can still use `editReply`. Threshold: `deferWhenSlowThresholdMs` (default 1500).
- **`never`** — No automatic defer; you must reply within ~3 seconds or defer yourself.

### 9.3 Event deduplication

- A single `client.on('interactionCreate')` and a single `client.on('messageCreate')` are registered. Each event is keyed by `interaction.id` or `message.id`.
- Before handling, the framework checks a set of processed IDs; if the id is already present, the event is ignored (and a warning may be logged). The id is added at the start and removed after a TTL (e.g. 60 seconds).
- An “executing now” set ensures the same id is not handled concurrently. For prefix, optional `tryAcquirePrefixMessage(messageId)` (e.g. Redis SET NX) ensures only one process handles the message when multiple instances run.

### 9.4 Message edit and delete

**safeEdit(message, payload, opts?)** — Edits a message. Returns the edited message or `null` on failure. Early-exits if `message` or `payload` is missing. Known benign Discord errors (Unknown Message, Cannot edit, Missing Access) are not logged; only unexpected errors are logged via `safeError`. Optional `opts.retryOnce: true` retries once on 5xx or 429. Use for single edits.

**safeDelete(message, opts?)** — Deletes a message if `message.deletable` is true. Returns `true` if deleted, `false` otherwise. Optional `opts.reason` for audit log. Benign errors (e.g. message already deleted) are not logged.

**MessageEditDeleteHelper** — For high-frequency updates (e.g. components on the same message), create a helper with `createMessageEditDeleteHelper({ debounceMs: 120 })`. Call `helper.edit(message, payload)` with default debounce: multiple edits within the window are coalesced into one API call (last payload wins). Call `helper.delete(message)` to delete and cancel any pending edit. Use `helper.flush(keyOrMessage)` to send a pending edit immediately, or `helper.flushAll()` before shutdown. This reduces API calls and avoids rate limits when many rapid edits would otherwise be sent.

---

## 10. Storage and settings

### 10.1 Storage adapter

`framework.storage` is created lazily via `initStorage()` from `options.storage.backend` and `options.storage`. The factory is `createStorageAdapter(type, opts)`.

**Supported backends:** `json` (default), `memory`, `mongo`, `supabase`, `sqlite`. Each has backend-specific options (e.g. JSON: `path` or `filePath`, `saveDelay`; Mongo: connection URL; Supabase: client and table).

**Base adapter API:** `get(namespace, key)`, `set(namespace, key, value, ttl?)`, `delete(namespace, key)`, `has(namespace, key)`, `keys(namespace)`, `values(namespace)`, `entries(namespace)`, `clear(namespace?)`, `getMany`, `setMany`, `deleteMany`, `increment`, `decrement`, `push`, `pull`, `update`, `getOrSet`, `size`, `toObject`, `fromObject`. All return Promises.

### 10.2 Settings manager API

`framework.settings` uses namespaces `guild` and `user` and caches with TTL/max size from `options.cache`.

**Methods:** `getGuild(guildId)`, `setGuild(guildId, data)`, `patchGuild(guildId, patch)` — patch can be object or `(current) => newValue`; `getUser(userId)`, `setUser(userId, data)`, `patchUser(userId, patch)`; `getGuildPrefix(guildId, fallback?)`, `setGuildPrefix(guildId, prefix)`, `resetGuildPrefix(guildId)`; `invalidate(namespace, id)`, `clearCache()`.

Defaults come from `options.settings.defaults.guild` and `options.settings.defaults.user`.

### 10.3 Migrations

`framework.migrations` is a `MigrationRunner` that runs migration scripts from `options.migrationsPath` against the storage backend and tracks which have run so you can evolve schema or data safely.

---

## 11. Assets

`framework.assets` is an `AssetLoader` with `options.assets.baseDir` (default `process.cwd()`). It loads static files (fonts, images) for use in commands or image generation.

**Typical usage:** Call `framework.assets.setBaseDir(path)` if needed; then `preload(directory, opts)` to scan and cache paths (e.g. `preload('static/font', { eager: false })`), and `registerAllFonts()` to register fonts (e.g. for canvas). Use `getPath(name)` or similar to resolve asset paths for reading or passing to image libraries. Useful for consistent branding and avoiding hardcoded paths.

---

## 12. Components v2, modals, pagination

### 12.1 Components v2 builders

The framework exposes builders (from `components/v2/builders.js`) for Discord Components v2. Send with `flags: MessageFlags.IsComponentsV2`.

**Primitives:** `textDisplay(content)`, `separator(opts)`, `mediaGallery(items)`, `thumbnail(url, opts)`, `fileComponent(url, opts)`, `actionRow(components)`, `button(opts)`, `selectMenu(opts)`, `container(accentColor, components, opts)`, `section(components, accessory)`.

**High-level:** `buildMessageContainerV2(accentColor, content, opts)` — content string or array of components; returns `{ components, flags }`. `buildEmbedLikeV2(opts)` — opts: `title`, `description`, `fields`, `image`, `footer`, `color`. `buildChartComponentsV2(opts)` — for chart-style layout. `buildConfirmContainerV2(opts)` — yes/no buttons; opts: `title`, `description`, `confirmLabel`, `cancelLabel`, `customIdPrefix`, `userId`. `buildPaginatedContainerV2(opts)` — opts: `title`, `content`, `currentPage`, `totalPages`, `customIdPrefix`, `userId`, `color`. A `ContainerBuilder` class allows chaining `setAccentColor`, `addTextDisplayComponents`, etc.

### 12.2 Modals

`framework.modal` (ModalHelper) helps build and show modals and parse submissions. Use it to collect multi-field input with custom IDs that you can map back to actions in `handleModalSubmit`.

### 12.3 Pagination and confirmation

- **`framework.paginate(interaction, pages, opts)`** — Sends the first page as a Components v2 message with prev/next buttons, then handles component collection. `pages` is an array of objects with `title`, `content`, `color`, etc. `opts` can include `title`, `color`. Uses `componentCollectorTimeoutMs` for the collector.
- **`framework.confirm(interaction, question, opts)`** — Sends a yes/no UI and returns a Promise resolving to `true`, `false`, or `null` (timeout/no answer). `opts`: `title`, `yesLabel`, `noLabel`, `color`.

Both use `framework.buildCustomId` for consistent and safe customIds.

---

## 13. Reload and debug

### 13.1 Reload manager

`framework.reload` (ReloadManager) reloads commands from `commandsPath` without restarting the process. It clears `require.cache` for each known command file and calls `framework.commands.loadFromDirectory(commandsPath)`. After reload, the framework can emit events (e.g. `commandReloaded`, `commandsReloaded`) so the bot can re-sync slash commands or refresh caches. If slash command definitions changed, you must call `framework.commands.syncToDiscord(client, options)` again to update Discord.

### 13.2 Debug panel

When `options.debug === true`, `framework.debugPanel` (LiveDebugPanel) is enabled. You can call `debugPanel.enable()` and `debugPanel.attach(client)` so it subscribes to client events. It logs or displays command runs, errors, and event metadata (sanitized; no sensitive data). Useful for development and tracing. See `debug/LiveDebugPanel.js` for event names and output format.

### 13.3 Inspector

The framework includes an `Inspector` utility for introspecting registered commands, options, and structure. Use it in tooling or debug scripts to list commands, check options, or validate state.

---

## 14. Stats and health

### 14.1 Stats manager

`framework.stats` (StatsManager) records metrics: commands run (slash and prefix counters), command errors, messages and interactions received. It can also track histograms, gauges, and rate trackers. Use the public API to increment counters (e.g. `stats.recordCommandRun(opts)`, `stats.recordCommandError(...)`, `stats.recordMessage()`, `stats.recordInteraction()`) and to read snapshots or aggregate values for logging or an HTTP stats endpoint.

### 14.2 Health manager

`framework.health` (HealthManager) tracks lifecycle: `markStarting()`, `markReady()`, `markShuttingDown()`. It can run an HTTP server when `options.health.enabled` is true (bind `host`/`port`) for readiness/liveness probes. It may integrate a circuit breaker for external dependencies. On SIGINT/SIGTERM the framework calls shutdown handlers and then marks health as shutting down so probes can return unhealthy.

**Custom API routes:** You can expose your own HTTP endpoints on the same server:

- `health.addRoute(method, path, handler)` — Register a custom route. `method` is e.g. `'GET'` or `'POST'` (defaults to `'GET'`). `path` is the pathname (e.g. `'/api/bot'`). `handler` is `async (req, res, url) => body`: if you return a value, it is JSON-stringified and sent with status 200 (or the status you set on `res`). If the handler throws, a 500 with `{ error: 'Internal error' }` is sent. Call `addRoute` before `framework.init()` or before the health HTTP server is started. Built-in routes (`/health`, `/ready`, `/live`, `/metrics`, `/status`) are checked first; custom routes are matched by `METHOD:pathname`.

---

## 15. Lifecycle and multi-instance detection

### 15.1 Shutdown

Register cleanup with `framework.onShutdown(fn)`. Each `fn` can be async. On `SIGINT` or `SIGTERM`, the framework marks health as shutting down, stops the multi-instance detector (if any), then runs all shutdown handlers in order. You can use them to close DB connections, stop HTTP servers, or disconnect the Discord client.

### 15.2 Multi-instance detection (full)

When `options.multiInstance` is truthy, the framework creates a `MultiInstanceDetector` and starts it after `registerListeners`.

**Redis:** Connects using `process.env.REDIS_URL` or `REDIS_URI`. If Redis is unavailable, detection is skipped (no warning).

**Group ID:** `options.multiInstance.groupId` or a hash of `process.env.DISCORD_TOKEN` or `BOT_TOKEN` (or `'default'`). Used to namespace keys so different bots do not collide.

**Heartbeat:** Every 10 seconds each process sets Redis key `fw:inst:<groupId>:<pid>` with TTL 30 seconds. So any process that exits stops updating and its key expires.

**Check:** Every 15 seconds each process runs `KEYS fw:inst:<groupId>:*`. If the count is greater than 1, it sets an internal “multiple instances” flag.

**Warning:** On every `CommandRun` event (slash or prefix, any user), if the flag is set, the detector logs once to console (English): *“Multiple bot instances detected. Only one instance should run. To stop all instances run: pkill -f \"node.*<pattern>\" then start the bot again.”*

**Pattern:** `options.multiInstance.processMatchPattern` or, by default, `path.basename(process.cwd())` (e.g. `shiver2`), so the suggested command is generic. No bot-specific name is required.

**Cleanup:** On framework shutdown, the detector stops timers and deletes its heartbeat key, then disconnects Redis.

---

## 16. Voice, code execution, monetization

### 16.1 Voice manager

`framework.voice` (VoiceManager) handles joining voice channels and playing audio. Configure via `options.voice`: `maxBitrateKbps`, `maxDurationSeconds`, `transcode`, `nodeSelection`. Requires `@discordjs/voice`; optional `prism-media` for transcoding. The manager exposes methods to join, leave, and play streams; it respects max duration and bitrate limits.

### 16.2 Execute runner (code execution)

The framework’s ExecuteRunner runs user-provided code in a sandbox. Config: `options.execute.backend` (`'piston'` or `'local'`), `pistonUrl`, `timeoutMs`, `maxCodeLength`, and for local: `pythonExecutable`, `luaExecutable`, etc. The runner exposes a `run(language, code, stdin?)`-style API and returns stdout, stderr, and exit code. Supported languages depend on the backend (e.g. Piston: many; local: Python, Lua, etc.). See `execute/ExecuteRunner.js` and `SUPPORTED_LANGUAGES`.

### 16.3 Monetization manager

`framework.monetization` (MonetizationManager) handles entitlements and SKUs. When `options.monetization.enabled` is true, you can check premium status and gate features. The premium middleware uses this (or a container-provided `premium` service) to block or allow commands. Webhook path and premium backend (e.g. Discord SKUs) are configured in `options.monetization`.

---

## 17. Moderation, anti-crash, sharding

### 17.1 Moderation API

`framework.moderation` (ModerationAPI) provides role hierarchy checks (`checkRoleHierarchy` from `options.moderation.checkRoleHierarchy`) and helpers for common moderation actions (e.g. kick, ban, timeout). Used by the permissions middleware and by your commands when you need safe, hierarchy-aware moderation.

### 17.2 Anti-crash

`framework.antiCrash` (AntiCrash) attaches to the process to listen for `uncaughtException` and `unhandledRejection`. It logs errors and can optionally prevent process exit so you can log and then exit gracefully. Configure behavior via `options.antiCrash` (e.g. exitOnError, maxRestarts).

### 17.3 Sharding

When `options.sharding.scriptPath` is set, `framework.sharding` (ShardManager) can spawn a child process that runs the Discord sharding launcher script. Use this to run the bot in sharded mode without manually spawning processes. See `sharding/ShardManager.js` and `sharding/launcher.js` for the expected script interface.

---

## 18. Plugins

`framework.plugins` is a `PluginManager`. You can register a plugin with `plugins.register(name, plugin)` and load it with `plugins.load(nameOrPlugin, options)` or `plugins.loadAll(plugins)`. A plugin is an object with an `init(framework, options)` method (or a function `(framework, options) => Promise`). `load(name)` resolves built-in plugins from `plugins/built-in/<name>.js` when given a string. After load, `plugins.isLoaded(name)` and `plugins.getLoaded()` tell you what is active.

**Built-in plugins** (in `plugins/built-in/`): `slash-sync` (sync slash commands), `backup-restore`, `feature-flags`, `error-reporter`, `stats-server`, `scheduled-tasks`, `i18n`, `webhook-logger`, `logger`. Each has its own options when loaded; see the plugin file for details.

---

## 19. Events and container

### 19.1 Event bus

`framework.events` is an EventEmitter-style bus. Main events:

| Event | Payload | When |
|-------|---------|------|
| `CommandRun` | `{ interaction?, message?, commandName, traceId }` | After a command’s execute handler runs successfully. |
| `CommandError` | `{ interaction?, message?, commandName, error, traceId }` | When the command’s execute throws. |
| `CommandBlocked` | `{ interaction?, message?, commandName, traceId, reason? }` | When middleware or preconditions block execution. |
| `afterReady` | `(client)` | After client fires ready and optional slash sync and `afterReady` callback. |
| `afterSlashSync` | `(applicationCommands)` | After slash commands are synced to Discord. |
| `afterPrefixMessage` | `(message)` | After each message is processed by the prefix handler (whether or not it was a command). |
| `commandReloaded` | — | When a single command is reloaded. |
| `commandsReloaded` | — | When all commands are reloaded. |

Subscribe with `framework.events.on('CommandRun', payload => { ... })`.

### 19.2 Container

`framework.container` is a simple key-value container for dependency injection. The framework sets `client`, `assets`, `debugPanel`, `antiCrash`, and (if sharding) `sharding`. Your bot can call `container.set('logger', logger)`, `container.set('helpers', helpers)`, `container.set('premium', premiumService)`, etc. Commands and middleware resolve with `container.get('logger')`. Used by middleware to access blacklist, disabled commands, premium, helpers, and other shared services.

---

## 20. CLI

The framework exposes a CLI via the `shiver-framework` bin (e.g. `npx shiver-framework` from the project that depends on the framework).

**Commands:**

- **`validate [commandsDir]`** — Default `commandsDir` is `src/commands`. Recursively loads all `.js` command files and validates structure (name, data, execute handlers, description length). Exits with non-zero on validation errors.
- **`sync [token] [commandsDir]`** — Registers slash commands with Discord. Token can be provided as the first argument or via `DISCORD_TOKEN`. Optional `commandsDir` is the same as validate. Uses `package.json` `shiver.clientId` if needed for OAuth. Rate limits are respected with retries.
- **`generate <type> <name> [dir]`** — Scaffolds a new file. `type` can be `command`, `listener`, `precondition`, or `system`. `name` is the entity name; `dir` is the target directory (default depends on type, e.g. `src/commands` for command). Generates a template with exports and placeholder logic.

---

## 21. Testing

The framework provides testing utilities so you can run commands in isolation.

**CommandTester** (`testing/CommandTester.js`): Construct a tester with a framework instance and optional client/storage mocks. Use `tester.runSlash(commandName, interactionOverrides)` or `tester.runPrefix(commandName, messageOverrides, args)` to execute the command and get a result object. Assert on reply content, embeds, or components via the returned assertions (e.g. `ReplyAssertion`, `EmbedAssertion`). Supports tracing and error capture.

**Mocks** (`testing/mocks.js`): `createMockInteraction(overrides)`, `createMockMessage(overrides)`, `createMockClient(overrides)`, `createMockGuild`, `createMockChannel`, `createMockMember`, `createMockRole`, etc., so you can build minimal Discord.js-like objects for tests. `MockStorage` and `MockEventBus` simulate storage and events. `TestFramework` is a minimal framework instance for testing without full init.

---

## 22. Custom IDs and validation

### 22.1 Custom IDs

Use `framework.buildCustomId(prefix, command, action, userId)` to build consistent component customIds (e.g. for buttons and selects). Use `framework.parseCustomId(customId)` to parse them back. The separator is configurable via options. This avoids collisions and makes it easy to route component interactions to the right command and handler.

### 22.2 Validation

The framework includes validation helpers: `validateFrameworkConfig(config)` for top-level config; `validateCommandDefinition(piece)` for command shape; `validateCustomId(customId)` for length and format; `validatePayload(payload)` for reply payloads. Use them in tests or before syncing slash commands. See `validation/validate.js`.

### 22.3 Errors and helpers

Error types (in `errors/Errors.js`) include `ShiverError`, `CommandError`, `PreconditionError`, `RateLimitError`, `StorageError`, `ValidationError`, etc. Helpers (e.g. in `utils/Helpers.js`) provide `createGenericErrorPayload(userId, opts)`, `createWarningPayload(message, opts)`, `createSuccessPayload`, `createLoadingPayload`, `createNotFoundPayload`, `createNoPermissionPayload`, `createCooldownPayload`, `createPremiumRequiredPayload` for consistent user-facing messages. Use them in commands and middleware instead of ad-hoc strings.

---

## 23. Security

### 23.1 Token and secrets

- **Never commit or log the Discord token.** Load it from the environment (e.g. `process.env.DISCORD_TOKEN`). Use a `.env` file or your deployment’s secret store; keep `.env` in `.gitignore`.
- **Validate token format** before login if you want early feedback: the framework exports `validateTokenFormat(token)` and `TokenValidator` for optional checks. Invalid or placeholder tokens can be rejected before any network call.
- **Do not send secrets to Discord.** User-facing messages, embeds, and component payloads must never contain API keys, tokens, or passwords. Use generic error messages (e.g. “This command is currently unavailable”) and log details server-side only.

### 23.2 Log redaction

The framework uses **safe error logging** so that tokens and other secrets never appear in console output. All internal `console.error`/`console.warn` paths that log errors use `safeError(tag, err)` from `security/redact.js`, which redacts known secret patterns (Discord tokens, Bearer tokens, `token=`, `password=`, `api_key=`, etc.) from messages and stack traces.

You can use the same utilities in your bot:

- `redactSecrets(str)` — Returns a string with secret-like substrings replaced by `[REDACTED]`.
- `safeError(tag, err)` — Logs a redacted error message (and optionally stack in non-production). Use for any logging of caught errors so that accidental inclusion of tokens or API keys never leaks.

Export: `const { redactSecrets, safeError } = require('shiver-framework');`

### 23.3 HTTP push and external calls

When sending data to external URLs (e.g. your website or a stats API), use `framework.httpPush(url, payload, opts)` or the exported `pushJson`. It uses the same redaction in its error logging so that URLs or response bodies that might contain secrets are never printed in full. Prefer passing auth via `opts.authHeader` rather than embedding secrets in the URL.

---

## 24. AI rules and development guidelines

These guidelines are framework-agnostic best practices for bots built on Shiver Framework. They keep code maintainable, safe, and consistent—especially when working with AI-assisted development.

**Async and flow**

- Use `async/await` everywhere. Avoid `.then()` or raw callbacks so stack traces and control flow stay clear.
- For slash commands that do I/O or heavy work (API calls, database, etc.), **defer early**: call `deferReply` (or rely on the framework’s Defer middleware with `deferStrategy: 'always'` or `'whenSlow'`) so Discord gets a response within 3 seconds. Use `editReply` for the final answer.

**Code quality**

- Prefer **self-explanatory code** over comments. Name functions and variables so that intent is obvious; remove redundant comments.
- Write the **minimum code** needed. No extra features, no premature optimization, no unused variables or functions.
- Prefer a **single response path** per flow (e.g. one helper for reply/edit) to avoid duplicated logic and conditionals.

**Errors and user messages**

- **Generic errors only:** Never show raw error messages, stack traces, or API/technical details to users. Use a single generic message (e.g. “This command is currently unavailable. Please try again later.”) and log the real error server-side with a redaction-safe logger (e.g. `safeError`).
- Handle predictable cases (user not found, missing permissions, invalid input) with clear, user-facing messages (e.g. warning payloads), not exceptions.
- Use framework or bot helpers (e.g. `createGenericErrorPayload`, `createWarningPayload`) for errors and warnings so wording and behavior stay consistent.

**Discord and safety**

- **Ephemeral for sensitive content:** Replies that contain user-specific data, warnings, or moderation info should be sent with `MessageFlags.Ephemeral` so only the invoker sees them.
- **Consistent customIds:** Use a fixed scheme for component IDs (e.g. `prefix:type:userId` or `command:action:userId`) so handlers are predictable and collisions are avoided. Use `framework.buildCustomId` when possible.
- **Collectors:** Set sensible timeouts; in the “end” handler remove listeners and clean up so no listeners are left hanging.

**Process and delivery**

- **Finish work:** Complete the requested task fully; do not leave partial work or ask “should I continue?” for the same task.
- **Verify before finishing:** Run the bot (e.g. `npm run dev`) and fix any startup or runtime errors before considering the task done.
- **Respect Discord limits:** 25 MB per file, 10 files per message; for larger or many files, split or show a clear user message instead of failing with a raw error.

These rules align with vibe coding and AI-assisted workflows: clear structure, minimal surprises, and safe defaults.

---

## 25. Examples

### 25.1 Registering a command (slash + prefix)

Command file `src/commands/ping.js`:

```js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'ping',
    aliases: ['p'],
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency'),
    async executeSlash(interaction, client) {
        const framework = client.framework;
        const ms = framework.ping ? framework.ping.getFullPing() : { gateway: client.ws.ping, rest: null };
        const text = ms?.gateway != null ? `Gateway: ${ms.gateway}ms` : 'Pong';
        await interaction.editReply({ content: text });
    },
    async executePrefix(message, args, client) {
        const framework = client.framework;
        const ms = framework.ping ? framework.ping.getFullPing() : { gateway: client.ws.ping, rest: null };
        const text = ms?.gateway != null ? `Gateway: ${ms.gateway}ms` : 'Pong';
        await message.reply(text);
    }
};
```

### 25.2 Storage and settings

```js
await framework.init(client);

const storage = framework.storage;
await storage.set('bot', 'counter', 42);
const n = await storage.get('bot', 'counter');

const prefix = await framework.settings.getGuildPrefix(guildId, ',');
await framework.settings.setGuildPrefix(guildId, '!');
```

### 25.3 Dynamic prefix (getPrefix)

```js
const framework = new ShiverFramework({
    commandsPath: './src/commands',
    prefix: ',',
    async getPrefix(message, fw) {
        if (!message.guildId) return ',';
        const p = await fw.settings.getGuildPrefix(message.guildId, null);
        return p ?? ',';
    }
});
```

### 25.4 Custom middleware

```js
framework.use(async (context, next) => {
    const { interaction, message, command } = context;
    await next();
});
```

### 25.5 Safe response (followUp)

```js
const payload = { content: 'Done.', ephemeral: true };
await framework.followUp(interaction, payload);
```

### 25.6 Ping (gateway and REST)

```js
await framework.init(client);

const gatewayMs = framework.ping.getGatewayMs();
const restMs = await framework.ping.getRestMs();
const full = await framework.ping.getFullPing();
```

`framework.ping` is a `PingHelper` instance (see `utils/PingHelper.js`). It exposes `getGatewayMs()`, `getGatewayMsStaleAware()`, `getRestMs(useCache)`, `getFullPing()`, and `setRestCacheMs(ms)`.

### 25.7 HTTP push (send JSON to your website or API)

```js
const result = await framework.httpPush('https://your-site.com/api/stats', {
    guilds: client.guilds.cache.size,
    commands: framework.commands.getAllSlash().length
}, { method: 'POST', timeoutMs: 5000 });
if (result.ok) {
    console.log('Pushed:', result.status);
}
```

### 25.8 Custom health API route

```js
framework.health.addRoute('GET', '/api/bot', async (req, res, url) => {
    return {
        name: 'MyBot',
        version: '1.0.0',
        commands: framework.commands.getAllSlash().length
    };
});

await framework.init(client);
await client.login(process.env.DISCORD_TOKEN);
```

Enable the health server with `health: { enabled: true, port: 8080 }` in options. Then `GET /api/bot` returns the JSON object. Custom routes run before the built-in `/health`, `/ready`, `/live`, `/metrics`, `/status` routes.

---

## 26. Vibe code and AI-friendly design

Shiver Framework is designed to be **vibe code friendly** and **AI-friendly**: clear structure, predictable APIs, and documentation that supports both human and AI-assisted development.

- **Explicit over implicit** — Commands are plain objects with a well-defined shape (`name`, `data`, `executeSlash`, `executePrefix`, etc.). No magic or hidden lifecycle; you see exactly what runs and when.
- **Single source of truth** — This document is the authoritative reference. Every major system, option, and helper is described here with examples where it helps.
- **Consistent patterns** — Same middleware and preconditions for slash and prefix; same safe-response and customId utilities; same storage and settings API. Once you learn one path, the rest follows.
- **Safe defaults** — Logs are redacted so tokens and secrets never leak; errors in handlers are caught and turned into generic user messages; defer and deduplication reduce “interaction failed” and duplicate replies.
- **Examples and AI rules** — The [Examples](#25-examples) section shows concrete code for commands, storage, prefix, middleware, ping, HTTP push, and custom health routes. The [AI rules and development guidelines](#24-ai-rules-and-development-guidelines) give universal rules (async/await, no comments, minimal code, generic errors, defer, ephemeral, customIds, etc.) so that AI assistants and humans can produce consistent, maintainable bot code.

Using the framework with an AI assistant: point it to this doc and the examples; the structure and naming make it easy to generate or refactor commands and integrations that fit the rest of the codebase.

---

## 27. Module index (main sources)

| Area | Path |
|------|------|
| Entry, init, options | `src/index.js` |
| Default options | `src/config/defaultOptions.js` |
| Command registry | `src/core/CommandRegistry.js` |
| Shiver client | `src/core/ShiverClient.js` |
| Container, EventBus | `src/core/Container.js`, `src/core/EventBus.js` |
| Slash / prefix / interaction / autocomplete / context menu handlers | `src/handlers/SlashHandler.js`, `PrefixHandler.js`, `InteractionHandler.js`, `AutocompleteHandler.js`, `ContextMenuHandler.js` |
| safeRespond | `src/handlers/safeRespond.js` |
| safeEdit, safeDelete, MessageEditDeleteHelper | `src/utils/Helpers.js`, `src/utils/MessageEditDeleteHelper.js` |
| Middleware | `src/middleware/*.js` (Defer, Lockdown, Blacklist, TOS, Premium, RateLimit, Cooldown, Disabled, Permissions, etc.) |
| Storage adapters | `src/storage/StorageAdapter.js` |
| Settings | `src/settings/SettingsManager.js` |
| Stats, health | `src/stats/StatsManager.js`, `src/lifecycle/Health.js` (includes `addRoute` for custom API routes) |
| Ping, HTTP push | `src/utils/PingHelper.js`, `src/utils/httpPush.js` |
| Security, redaction | `src/security/redact.js` (`redactSecrets`, `safeError`) |
| Multi-instance | `src/lifecycle/MultiInstanceDetector.js` |
| Reload, debug, inspector | `src/reload/ReloadManager.js`, `src/debug/LiveDebugPanel.js`, `src/debug/Inspector.js` |
| Components v2 | `src/components/v2/builders.js` |
| Pagination, confirmation | `src/pagination/index.js`, `src/confirmation/index.js` |
| Assets | `src/assets/AssetLoader.js` |
| Voice, execute, monetization | `src/voice/VoiceManager.js`, `src/execute/ExecuteRunner.js`, `src/monetization/MonetizationManager.js` |
| Moderation, anti-crash, sharding | `src/moderation/ModerationAPI.js`, `src/core/AntiCrash.js`, `src/sharding/ShardManager.js` |
| Plugins | `src/plugins/PluginManager.js`, `src/plugins/built-in/*.js` |
| CLI | `src/cli/index.js` |
| Testing | `src/testing/CommandTester.js`, `src/testing/mocks.js` |
| Validation, errors, helpers | `src/validation/validate.js`, `src/errors/Errors.js`, `src/utils/Helpers.js` |

---

## Summary

Shiver Framework provides a complete, production-oriented foundation for Discord bots: command loading and dispatch (slash, prefix, context menu, autocomplete), middleware and preconditions, safe response handling (safeRespond, defer, deduplication), storage and settings with pluggable backends, assets, Components v2 builders, pagination and confirmation, reload and debug, stats and health (including custom API routes via `health.addRoute`), ping and HTTP push utilities, log redaction so tokens and secrets never leak, multi-instance detection with Redis, optional voice/execute/monetization, moderation API, anti-crash, sharding, plugins, events, and a DI container. Documentation includes [Security](#23-security) (token handling, redaction, safe HTTP push), [AI rules and development guidelines](#24-ai-rules-and-development-guidelines), [concrete Examples](#25-examples) (commands, storage, prefix, ping, httpPush, custom health routes), and [Vibe code / AI-friendly design](#26-vibe-code-and-ai-friendly-design). Configuration is documented in full; every major system has a clear API and extension point. You keep full control over UX and business logic while relying on the framework for infrastructure, performance, and safety.
