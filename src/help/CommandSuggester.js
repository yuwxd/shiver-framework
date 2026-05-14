class CommandSuggester {
    suggest(input, commands, limit = 3) {
        const lower = input.toLowerCase().replace(/^[/,]/, '');
        const scored = [];

        for (const cmd of commands) {
            const name = cmd.name ?? cmd.data?.name ?? '';
            if (!name) continue;

            const aliases = Array.isArray(cmd.aliases) ? cmd.aliases : [];
            const candidates = [name, ...aliases];
            let best = Infinity;

            for (const candidate of candidates) {
                const lev = this._levenshtein(lower, candidate.toLowerCase());
                if (lev < best) best = lev;
            }

            if (best <= 3) scored.push({ command: name, distance: best, cmd });
        }

        return scored
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit)
            .map(({ command, distance, cmd }) => ({ command, distance, cmd }));
    }

    _levenshtein(a, b) {
        if (a === b) return 0;
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const dp = Array.from({ length: a.length + 1 }, (_, i) =>
            Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
        );
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
        return dp[a.length][b.length];
    }
}

module.exports = { CommandSuggester };
