class NaturalCommandRouter {
    constructor() {
        this._phrases = new Map();
    }

    train(commandName, phrases = []) {
        const existing = this._phrases.get(commandName) ?? [];
        this._phrases.set(commandName, [...existing, ...phrases.map(p => p.toLowerCase())]);
        return this;
    }

    autoLearn(commands) {
        for (const cmd of commands) {
            if (!cmd.data) continue;
            const json = typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : cmd.data;
            const name = json.name;
            const phrases = [name];
            if (json.description) {
                const words = json.description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                phrases.push(...words);
            }
            this.train(name, phrases);
        }
        return this;
    }

    route(text, limit = 3) {
        const lower = text.toLowerCase().trim();
        const scores = new Map();

        for (const [commandName, phrases] of this._phrases) {
            let score = 0;
            for (const phrase of phrases) {
                if (lower === phrase) { score += 10; continue; }
                if (lower.includes(phrase)) { score += 3; continue; }
                if (phrase.includes(lower)) { score += 2; continue; }
                const lev = this._levenshtein(lower, phrase);
                if (lev <= 2) score += 2 - lev;
            }
            if (score > 0) scores.set(commandName, score);
        }

        const sorted = [...scores.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit);

        if (sorted.length === 0) return null;

        const top = sorted[0];
        return {
            command: top[0],
            confidence: top[1],
            suggestions: sorted.map(([command, confidence]) => ({ command, confidence }))
        };
    }

    _levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
        return dp[m][n];
    }
}

module.exports = { NaturalCommandRouter };
