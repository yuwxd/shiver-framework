## AI Operational Rules

### Language & Communication
- Respond to the user in the same language they write in. For this workspace: **Polish**.
- Use **English** for all code: variable names, function names, file names, module names.
- Never add code comments. Write self-explanatory code through naming and structure.
- Never start a response with acknowledgment phrases: "Great!", "Sure!", "Understood!", "Of course!" - go directly to work.
- Always finish the assigned task completely without stopping to ask "should I continue?".
- No em dashes (—) anywhere. Use a hyphen (-) instead.
- No changelog files; never create or update changelogs unless explicitly requested.
- No template files; never add boilerplate template files.

### Code Quality
- All functions must use async/await. Never use .then() or callbacks.
- Write the absolute minimum code needed. No extra features or unused variables.
- Always finish work fully. Do not stop midway or leave stubs.
- Before marking a task done, verify the project loads cleanly with no errors.
- When editing existing files, match the surrounding code style exactly.

### Discord Bot Standards
- All new command output must use Components v2 (raw API objects with ComponentType or discord.js builders).
  Never use EmbedBuilder for primary command output in new code.
- Use `buildMessageContainerV2(accentColor, content)` from `containerStyle` for consistent output.
- Colors must come from `/settings` via `embedHelper.getCommandEmbedColor(userId)`. Never hardcode colors.
- Errors must always use `Helpers.createGenericErrorPayload` or `Helpers.createWarningPayload`.
  Never show raw errors, stack traces, or technical details to Discord users.
- All sensitive or private replies must be ephemeral (`MessageFlags.Ephemeral`).
- Defer slow slash commands (`deferReply`) at the very start before any `await` that might take time.
- Use a consistent `customId` scheme: `command:action:userId` (e.g. `ticket:close:123456789`).
- Collectors must have sensible timeout and idle durations. Always clean up in the `end` handler.
- Respect Discord limits: 25MB per file, 10 files per message, 5 buttons per ActionRow.
- All attachment filenames must use the format `shiver.(ext)` (e.g. `shiver.png`, `shiver.mp3`).
  For multiple files use `shiver_1.png`, `shiver_2.png`.
- Every new command entry in `commands-list.json` must have a corresponding entry in `helpDescriptions.js`.
- Each subcommand must appear as a separate entry in the commands list (e.g. `/report bug`, `/report user`).
- Let errors bubble to the central handler so API key issues are reported to `API_KEY_ERROR_WEBHOOK_URL`.

### Components v2 Rules
- Always set `MessageFlags.IsComponentsV2` on both `deferReply({ flags })` AND `editReply`.
- Never mix components messages with `embeds`, `content`, `stickers`, or `poll` in the same reply.
- The filename in `AttachmentBuilder` must exactly match the `attachment://` reference.
- `accentColor` accepts a decimal integer (e.g. `0x5865f2`), not a hex string.
- Use `Separator` with `divider: true` for visual lines, `divider: false` for spacing only.
- `spacing: 1` = Small, `spacing: 2` = Large on Separator.
- Use `"> **▸ Title**"` and `"> From **X** to **Y**"` style text in container TextDisplay content.
- Never use arrow characters (`→`) in user-facing text.
- Block order inside a Container: TextDisplay first, then Separator, then more TextDisplay, then ActionRow last.

### Security
- Never expose API keys, tokens, secrets, or stack traces in user-facing messages.
- Log errors server-side (`console.error`) only. Redact sensitive data in all logs.
- Use `src/security/redact.js` for log redaction.

### Framework First
- When `shiver-framework` is missing a generic capability, improve the framework first
  instead of adding a bot-specific workaround.
- Do not duplicate infrastructure in the bot if the concern belongs in the framework.
- Framework changes must remain broadly useful and reusable. No bot-specific hacks in framework code.
- The framework is a fully separate project linked locally via `file:` path in `package.json`.
- Framework must stay compatible 1:1 with existing bot command files (same export format:
  `data`, `name`, `aliases`, `executeSlash`, `executePrefix`, `handleButton`, etc.).

### Website / Docs
- When modifying the `website/` or `deploy-shiver-one/` folder, always push changes to the
  `shiver.one` GitHub repo (`https://github.com/yuwxd/shiver.one`) at the end of the task.
- When modifying `shiver-framework/`, push changes to `https://github.com/yuwxd/shiver-framework`.
- Keep `README.md` and `shiver.one/framework/index.html` in sync with each other.

### New Modules (v2 expansion)
Available on `framework.*` after `new ShiverFramework(...)`:
- `framework.router` - ComponentRouter (wildcard button/select/modal routing)
- `framework.sessions` - UserSessionStore (per-user TTL key-value)
- `framework.scheduler` - Scheduler (named interval/cron/once tasks)
- `framework.broadcast` - BroadcastManager (mass channel/guild/DM sends)
- `framework.flags` - FeatureFlagManager (per-guild/user/global feature flags)
- `framework.conversation` - ConversationContext (per-channel AI message history)
- `framework.naturalRouter` - NaturalCommandRouter (fuzzy NLP command matching)
- `framework.alerts` - AlertManager (metric-based alerting with polling)

Available as standalone imports:
- `FunctionRegistry` - export commands as OpenAI/Anthropic tool schemas
- `AIContext` - snapshot Discord context from interactions for AI prompts
- `PromptBuilder` - fluent OpenAI/Anthropic message array builder
- `StructuredOutput` - typed AI-readable output events
- `WizardSession` - multi-step interaction wizard
- `FormBuilder` - fluent Discord modal builder with validation
- `VoteManager` - in-memory poll/voting system
- `MessageCollector` - prompt + collect user input with validation
- `HelpGenerator` - auto-generate help text from slash command definitions
- `CommandSuggester` - fuzzy typo suggestions (Levenshtein)
- `DiffTracker` / `diff` / `formatDiff` - object diff as Discord-friendly text
- `LocaleSync` / `localizeCommand` / `localizeAll` - apply i18n to command definitions
- `RequestDeduplicator` - deduplicate parallel identical async calls
- `safeRun` / `withRetry` / `withTimeout` - safe async execution wrappers
- `CommandDisabledManager` - runtime per-guild command disable/enable
- `buildProgressBar` / `buildMultiBar` - text progress bars
- `TableBuilder` - ASCII tables as Discord code blocks
- `ListBuilder` - formatted Discord-markdown lists
- `TicketSystem` - full ticket channel system
- `GiveawaySystem` - persistent giveaway system
- `TagSystem` - per-guild custom text tags with variable interpolation
- `StarboardSystem` - automatic starboard posting on reaction threshold
- `OwnerGuard`, `GuildGuard`, `ChannelGuard`, `RoleGuard`, `TimeGuard`, `RateLimitGuard`

## Learned Workspace Facts

- Project is a Discord bot called "shiver" (shiverxdd) built with Node.js, discord.js, and the Sapphire framework.
- Bot uses legacy slash commands and prefix commands loaded from src/commands/.
- Command format: module.exports = { data: SlashCommandBuilder, name, aliases, executeSlash(interaction, client), executePrefix(message, args, client, commandName), optionally handleButton/handleSelect/etc. }.
- Bot uses @sapphire/pieces container for dependency injection: container.set('logger', ...), container.get('premium'), etc.
- Bot has systems: BlacklistSystem, PremiumSystem, LockdownSystem, ServerListSystem, DisabledCommandsSystem, RateLimitSystem, EcoSystem, BottingSystem, RefcodeSystem, CryptoPaymentSystem, MusicManager (Shoukaku/Lavalink).
- Bot uses Supabase and/or MongoDB for storage (mongo.js with Supabase fallback).
- Bot prefix is comma (,); slash commands registered globally.
- Bot uses Components v2 (ContainerBuilder, SectionBuilder, SeparatorBuilder, TextDisplayBuilder) from discord.js.
- containerStyle module provides buildMessageContainerV2(accentColor, content) for consistent output.
- Helpers module provides createWarningPayload and createGenericErrorPayload for user-facing errors.
- embedHelper provides getCommandEmbedColor(userId) for per-user color settings.
- Bot has a stats server (statsServer.js) and ping manager (pingManager.js).
- Bot has webhook logging for commands, errors, and blocked commands (webhookConfig).
- Bot has API key error webhook reporting (apiKeyErrorWebhook.js).
- The Shiver Framework plan is at /home/yuw/.cursor/plans/shiver_framework_full_ca3f6946.plan.md (2114 lines, phases 1–39, parts A–AJ, DOCS sections 1–63).
- Framework should be created in /home/yuw/Downloads/shiver-framework/ (separate from shiverxdd bot).
- Framework must support: Container (set/get/has/clear), EventBus, ShiverClient (extends discord.js Client), CommandRegistry (loadFromDirectory, syncToDiscord diff-based), handlers (Slash, Prefix, Interaction, Autocomplete, ContextMenu), middleware chain (Defer, Lockdown, Blacklist, TOS, Premium, RateLimit, Disabled, Permissions), Components v2 builders, safe* helpers, storage adapters, settings, migrations, moderation API, plugins, optimizations, lifecycle, stats, error handling with traceId, message events, resolvers, args, listeners, customizability, monetization, execute sandbox, and full AJ compatibility hooks (afterPrefixMessage, afterSlashSync, afterReady, CommandRun/Blocked/Error events, getDisabledPath, buildPath/isDisabled).
- Discord.js version used in shiverxdd: check package.json for exact version.
- Bot Node.js requirement: >=18.
- Shiver Framework implementation status: COMPLETE (all phases 1-39 implemented).
- Framework files: src/index.js (main), src/core/, src/handlers/, src/middleware/, src/components/, src/cache/, src/storage/, src/settings/, src/migrations/, src/voice/, src/moderation/, src/validation/, src/errors/, src/security/, src/plugins/ (11 built-in), src/optimizations/, src/lifecycle/, src/stats/, src/events/, src/resolvers/, src/args/, src/listeners/, src/presence/, src/reload/, src/execute/, src/monetization/, src/testing/, src/sharding/, src/utils/, docs/DOCS.md (63 sections).
- Framework loads cleanly: node -e "require('./src/index.js')" returns no errors.
- All middleware implemented: Defer, Lockdown, ServerBlacklist, Blacklist, TOS, Premium, RateLimit, Cooldown, Disabled, Permissions.
- AJ compatibility: getDisabledPath, buildPath/isDisabled, afterPrefixMessage, afterSlashSync, afterReady, CommandRun/Blocked/Error events all implemented.
