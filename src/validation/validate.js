const { LIMITS } = require('../config/LIMITS');

const SNOWFLAKE_REGEX = /^\d{17,20}$/;
const URL_REGEX = /^https?:\/\/.+/i;
const CUSTOM_ID_MAX = LIMITS.customId;

function validateAndSanitizeOption(value, rules = {}) {
    const { type, maxLength, minLength, regex, allowedHosts } = rules;

    if (value === null || value === undefined) {
        return { ok: false, error: 'missing', value: null };
    }

    const str = String(value);

    if (maxLength && str.length > maxLength) {
        return { ok: false, error: 'too_long', max: maxLength, value: str.slice(0, maxLength) };
    }

    if (minLength && str.length < minLength) {
        return { ok: false, error: 'too_short', min: minLength, value: null };
    }

    if (type === 'snowflake') {
        if (!SNOWFLAKE_REGEX.test(str)) {
            return { ok: false, error: 'invalid_snowflake', value: null };
        }
        return { ok: true, value: str };
    }

    if (type === 'url') {
        if (!URL_REGEX.test(str)) {
            return { ok: false, error: 'invalid_url', value: null };
        }
        const hosts = allowedHosts ?? null;
        if (hosts) {
            try {
                const url = new URL(str);
                if (!hosts.includes(url.hostname)) {
                    return { ok: false, error: 'disallowed_host', value: null };
                }
            } catch (_) {
                return { ok: false, error: 'invalid_url', value: null };
            }
        }
        return { ok: true, value: str };
    }

    if (type === 'string') {
        if (regex && !regex.test(str)) {
            return { ok: false, error: 'invalid_format', value: null };
        }
        return { ok: true, value: str };
    }

    if (regex && !regex.test(str)) {
        return { ok: false, error: 'invalid_format', value: null };
    }

    return { ok: true, value: str };
}

function validateCustomId(customId) {
    if (typeof customId !== 'string') return { ok: false, error: 'not_string' };
    if (customId.length === 0) return { ok: false, error: 'empty' };
    if (customId.length > CUSTOM_ID_MAX) return { ok: false, error: 'too_long', max: CUSTOM_ID_MAX };
    return { ok: true, value: customId };
}

function validatePayload(payload) {
    const errors = [];

    if (payload.content !== undefined && payload.content !== null) {
        if (typeof payload.content !== 'string') {
            errors.push({ field: 'content', error: 'must_be_string' });
        } else if (payload.content.length > LIMITS.message.content) {
            errors.push({ field: 'content', error: 'too_long', max: LIMITS.message.content, actual: payload.content.length });
        }
    }

    if (payload.embeds) {
        if (!Array.isArray(payload.embeds)) {
            errors.push({ field: 'embeds', error: 'must_be_array' });
        } else {
            for (let i = 0; i < payload.embeds.length; i++) {
                const embed = payload.embeds[i];
                if (embed.title && embed.title.length > LIMITS.embed.title) {
                    errors.push({ field: `embeds[${i}].title`, error: 'too_long', max: LIMITS.embed.title });
                }
                if (embed.description && embed.description.length > LIMITS.embed.description) {
                    errors.push({ field: `embeds[${i}].description`, error: 'too_long', max: LIMITS.embed.description });
                }
                if (embed.footer?.text && embed.footer.text.length > LIMITS.embed.footer) {
                    errors.push({ field: `embeds[${i}].footer.text`, error: 'too_long', max: LIMITS.embed.footer });
                }
                if (embed.author?.name && embed.author.name.length > LIMITS.embed.authorName) {
                    errors.push({ field: `embeds[${i}].author.name`, error: 'too_long', max: LIMITS.embed.authorName });
                }
                if (embed.fields) {
                    if (embed.fields.length > LIMITS.embed.fields) {
                        errors.push({ field: `embeds[${i}].fields`, error: 'too_many', max: LIMITS.embed.fields });
                    }
                    for (let j = 0; j < embed.fields.length; j++) {
                        const field = embed.fields[j];
                        if (field.name && field.name.length > LIMITS.embed.fieldName) {
                            errors.push({ field: `embeds[${i}].fields[${j}].name`, error: 'too_long', max: LIMITS.embed.fieldName });
                        }
                        if (field.value && field.value.length > LIMITS.embed.fieldValue) {
                            errors.push({ field: `embeds[${i}].fields[${j}].value`, error: 'too_long', max: LIMITS.embed.fieldValue });
                        }
                    }
                }
            }
        }
    }

    if (payload.components) {
        if (!Array.isArray(payload.components)) {
            errors.push({ field: 'components', error: 'must_be_array' });
        } else if (payload.components.length > LIMITS.components.actionRows) {
            errors.push({ field: 'components', error: 'too_many_rows', max: LIMITS.components.actionRows });
        }
    }

    if (payload.files) {
        if (!Array.isArray(payload.files)) {
            errors.push({ field: 'files', error: 'must_be_array' });
        } else if (payload.files.length > LIMITS.files.maxFiles) {
            errors.push({ field: 'files', error: 'too_many', max: LIMITS.files.maxFiles });
        }
    }

    return { ok: errors.length === 0, errors };
}

const SCHEMA_TYPES = {
    string: (v) => typeof v === 'string',
    number: (v) => typeof v === 'number' && !isNaN(v),
    integer: (v) => Number.isInteger(v),
    boolean: (v) => typeof v === 'boolean',
    array: (v) => Array.isArray(v),
    object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
    function: (v) => typeof v === 'function',
    snowflake: (v) => typeof v === 'string' && SNOWFLAKE_REGEX.test(v),
    url: (v) => typeof v === 'string' && URL_REGEX.test(v)
};

function validateSchema(data, schema) {
    const errors = [];

    for (const [key, rules] of Object.entries(schema)) {
        const value = data?.[key];
        const isPresent = value !== undefined && value !== null;

        if (rules.required && !isPresent) {
            errors.push({ field: key, error: 'required' });
            continue;
        }

        if (!isPresent) continue;

        if (rules.type && SCHEMA_TYPES[rules.type] && !SCHEMA_TYPES[rules.type](value)) {
            errors.push({ field: key, error: 'wrong_type', expected: rules.type, actual: typeof value });
            continue;
        }

        if (rules.min !== undefined) {
            const check = typeof value === 'string' || Array.isArray(value) ? value.length : value;
            if (check < rules.min) errors.push({ field: key, error: 'too_small', min: rules.min });
        }

        if (rules.max !== undefined) {
            const check = typeof value === 'string' || Array.isArray(value) ? value.length : value;
            if (check > rules.max) errors.push({ field: key, error: 'too_large', max: rules.max });
        }

        if (rules.enum && !rules.enum.includes(value)) {
            errors.push({ field: key, error: 'invalid_enum', allowed: rules.enum });
        }

        if (rules.regex && typeof value === 'string' && !rules.regex.test(value)) {
            errors.push({ field: key, error: 'invalid_format' });
        }

        if (rules.custom) {
            const result = rules.custom(value, data);
            if (result !== true) {
                errors.push({ field: key, error: result ?? 'custom_validation_failed' });
            }
        }

        if (rules.properties && typeof value === 'object') {
            const nested = validateSchema(value, rules.properties);
            for (const e of nested.errors) {
                errors.push({ field: `${key}.${e.field}`, error: e.error, ...e });
            }
        }

        if (rules.items && Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                if (rules.items.type && SCHEMA_TYPES[rules.items.type] && !SCHEMA_TYPES[rules.items.type](value[i])) {
                    errors.push({ field: `${key}[${i}]`, error: 'wrong_type', expected: rules.items.type });
                }
            }
        }
    }

    return { ok: errors.length === 0, errors };
}

const FRAMEWORK_CONFIG_SCHEMA = {
    token: { type: 'string', required: false },
    prefix: { type: 'string', max: 10 },
    getPrefix: { type: 'function' },
    ownerId: { type: 'snowflake' },
    ownerIds: { type: 'array', items: { type: 'snowflake' } },
    commandsPath: { type: 'string' },
    listenersPath: { type: 'string' },
    defaultCooldown: { type: 'integer', min: 0 },
    maxCooldown: { type: 'integer', min: 0 },
    shards: { type: 'string', enum: ['auto', 'manual'] },
    shardCount: { type: 'integer', min: 1 }
};

function validateFrameworkConfig(config) {
    const result = validateSchema(config, FRAMEWORK_CONFIG_SCHEMA);

    if (config.token && (config.token.startsWith('Bot ') || config.token.startsWith('Bearer '))) {
        result.errors.push({ field: 'token', error: 'token_should_not_include_prefix' });
        result.ok = false;
    }

    if (config.prefix === '/') {
        result.errors.push({ field: 'prefix', error: 'slash_prefix_is_reserved_for_slash_commands' });
        result.ok = false;
    }

    if (config.ownerIds && !Array.isArray(config.ownerIds)) {
        result.errors.push({ field: 'ownerIds', error: 'must_be_array' });
        result.ok = false;
    }

    return result;
}

function validateCommandDefinition(command) {
    const errors = [];

    if (!command.name || typeof command.name !== 'string') {
        errors.push({ field: 'name', error: 'required_string' });
    } else if (!/^[\w-]{1,32}$/.test(command.name)) {
        errors.push({ field: 'name', error: 'invalid_format', hint: 'Must match /^[\\w-]{1,32}$/' });
    }

    if (!command.executeSlash && !command.executePrefix) {
        errors.push({ field: 'execute', error: 'at_least_one_execute_required' });
    }

    if (command.executeSlash && typeof command.executeSlash !== 'function') {
        errors.push({ field: 'executeSlash', error: 'must_be_function' });
    }

    if (command.executePrefix && typeof command.executePrefix !== 'function') {
        errors.push({ field: 'executePrefix', error: 'must_be_function' });
    }

    if (command.aliases && !Array.isArray(command.aliases)) {
        errors.push({ field: 'aliases', error: 'must_be_array' });
    }

    if (command.cooldown !== undefined && (!Number.isInteger(command.cooldown) || command.cooldown < 0)) {
        errors.push({ field: 'cooldown', error: 'must_be_non_negative_integer' });
    }

    if (command.preconditions && !Array.isArray(command.preconditions)) {
        errors.push({ field: 'preconditions', error: 'must_be_array' });
    }

    return { ok: errors.length === 0, errors };
}

module.exports = {
    validateAndSanitizeOption,
    validateCustomId,
    validatePayload,
    validateSchema,
    validateFrameworkConfig,
    validateCommandDefinition,
    SCHEMA_TYPES
};
