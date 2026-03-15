class MiddlewareChain {
    constructor() {
        this._middlewares = [];
    }

    use(fn) {
        this._middlewares.push(fn);
        return this;
    }

    async run(context) {
        let index = 0;
        const middlewares = this._middlewares;

        const next = async () => {
            if (index >= middlewares.length) return;
            const fn = middlewares[index++];
            await fn(context, next);
        };

        await next();
    }
}

module.exports = { MiddlewareChain };
