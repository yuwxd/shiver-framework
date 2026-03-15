const LIMITS = {
    embed: {
        title: 256,
        description: 4096,
        fields: 25,
        fieldName: 256,
        fieldValue: 1024,
        footer: 2048,
        authorName: 256,
        totalChars: 6000
    },
    slash: {
        commandName: 32,
        commandDescription: 100,
        optionName: 32,
        optionDescription: 100,
        maxOptions: 25,
        optionStringMin: 0,
        optionStringMax: 6000,
        maxChoices: 25
    },
    components: {
        actionRows: 5,
        buttonsPerRow: 5,
        selectsPerRow: 1,
        buttonLabel: 80,
        selectPlaceholder: 150,
        selectOptionLabel: 100,
        selectOptionValue: 100,
        selectOptionDescription: 100,
        maxSelectOptions: 25
    },
    componentsV2: {
        maxComponents: 40,
        maxTextChars: 4000
    },
    customId: 100,
    files: {
        maxSizeMb: 25,
        maxFiles: 10
    },
    autocomplete: {
        maxChoices: 25
    },
    modal: {
        title: 45,
        maxComponents: 5,
        textInputLabel: 45,
        textInputMin: 0,
        textInputMax: 4000
    },
    message: {
        content: 2000
    }
};

module.exports = { LIMITS };
