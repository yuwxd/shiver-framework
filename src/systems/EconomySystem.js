const { EventEmitter } = require('events');

class EconomySystem extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._storage = opts.storage ?? null;
        this._currencyName = opts.currencyName ?? 'coins';
        this._currencySymbol = opts.currencySymbol ?? '🪙';
        this._dailyAmount = opts.dailyAmount ?? 100;
        this._dailyCooldown = opts.dailyCooldown ?? 86400000;
        this._workAmount = opts.workAmount ?? [10, 50];
        this._workCooldown = opts.workCooldown ?? 3600000;
        this._startingBalance = opts.startingBalance ?? 0;
        this._maxBalance = opts.maxBalance ?? Infinity;
        this._taxRate = opts.taxRate ?? 0;
        this._shopItems = new Map(Object.entries(opts.shopItems ?? {}));
    }

    setStorage(storage) {
        this._storage = storage;
        return this;
    }

    async _getData(guildId, userId) {
        if (!this._storage) return { balance: this._startingBalance, bank: 0, lastDaily: 0, lastWork: 0, inventory: [] };
        const data = await this._storage.get('economy', `${guildId}:${userId}`);
        return data ?? { balance: this._startingBalance, bank: 0, lastDaily: 0, lastWork: 0, inventory: [] };
    }

    async _setData(guildId, userId, data) {
        if (!this._storage) return;
        await this._storage.set('economy', `${guildId}:${userId}`, data);
    }

    async getBalance(guildId, userId) {
        const data = await this._getData(guildId, userId);
        return { wallet: data.balance, bank: data.bank, total: data.balance + data.bank };
    }

    async addBalance(guildId, userId, amount) {
        const data = await this._getData(guildId, userId);
        data.balance = Math.min(this._maxBalance, data.balance + amount);
        await this._setData(guildId, userId, data);
        this.emit('balanceChange', guildId, userId, amount, 'add');
        return data.balance;
    }

    async removeBalance(guildId, userId, amount) {
        const data = await this._getData(guildId, userId);
        if (data.balance < amount) throw new EconomyError('INSUFFICIENT_FUNDS', 'Insufficient funds');
        data.balance -= amount;
        await this._setData(guildId, userId, data);
        this.emit('balanceChange', guildId, userId, -amount, 'remove');
        return data.balance;
    }

    async setBalance(guildId, userId, amount) {
        const data = await this._getData(guildId, userId);
        data.balance = Math.max(0, Math.min(this._maxBalance, amount));
        await this._setData(guildId, userId, data);
        return data.balance;
    }

    async deposit(guildId, userId, amount) {
        const data = await this._getData(guildId, userId);
        if (amount === 'all') amount = data.balance;
        if (data.balance < amount) throw new EconomyError('INSUFFICIENT_FUNDS', 'Insufficient funds in wallet');
        data.balance -= amount;
        data.bank += amount;
        await this._setData(guildId, userId, data);
        return { wallet: data.balance, bank: data.bank };
    }

    async withdraw(guildId, userId, amount) {
        const data = await this._getData(guildId, userId);
        if (amount === 'all') amount = data.bank;
        if (data.bank < amount) throw new EconomyError('INSUFFICIENT_FUNDS', 'Insufficient funds in bank');
        data.bank -= amount;
        data.balance += amount;
        await this._setData(guildId, userId, data);
        return { wallet: data.balance, bank: data.bank };
    }

    async transfer(guildId, fromUserId, toUserId, amount) {
        const fromData = await this._getData(guildId, fromUserId);
        if (fromData.balance < amount) throw new EconomyError('INSUFFICIENT_FUNDS', 'Insufficient funds');
        const tax = Math.floor(amount * this._taxRate);
        const received = amount - tax;
        fromData.balance -= amount;
        await this._setData(guildId, fromUserId, fromData);
        await this.addBalance(guildId, toUserId, received);
        this.emit('transfer', guildId, fromUserId, toUserId, amount, received, tax);
        return { sent: amount, received, tax };
    }

    async daily(guildId, userId) {
        const data = await this._getData(guildId, userId);
        const now = Date.now();
        const remaining = this._dailyCooldown - (now - data.lastDaily);
        if (remaining > 0) {
            throw new EconomyError('ON_COOLDOWN', 'Daily already claimed', { remaining });
        }
        data.lastDaily = now;
        data.balance = Math.min(this._maxBalance, data.balance + this._dailyAmount);
        await this._setData(guildId, userId, data);
        this.emit('daily', guildId, userId, this._dailyAmount);
        return { amount: this._dailyAmount, balance: data.balance };
    }

    async work(guildId, userId) {
        const data = await this._getData(guildId, userId);
        const now = Date.now();
        const remaining = this._workCooldown - (now - data.lastWork);
        if (remaining > 0) {
            throw new EconomyError('ON_COOLDOWN', 'Work is on cooldown', { remaining });
        }
        const [min, max] = this._workAmount;
        const earned = Math.floor(Math.random() * (max - min + 1)) + min;
        data.lastWork = now;
        data.balance = Math.min(this._maxBalance, data.balance + earned);
        await this._setData(guildId, userId, data);
        this.emit('work', guildId, userId, earned);
        return { amount: earned, balance: data.balance };
    }

    async gamble(guildId, userId, amount, opts = {}) {
        const data = await this._getData(guildId, userId);
        if (data.balance < amount) throw new EconomyError('INSUFFICIENT_FUNDS', 'Insufficient funds');
        const winChance = opts.winChance ?? 0.45;
        const multiplier = opts.multiplier ?? 2;
        const won = Math.random() < winChance;
        if (won) {
            data.balance = Math.min(this._maxBalance, data.balance + Math.floor(amount * (multiplier - 1)));
        } else {
            data.balance -= amount;
        }
        await this._setData(guildId, userId, data);
        this.emit('gamble', guildId, userId, amount, won);
        return { won, amount, balance: data.balance, change: won ? Math.floor(amount * (multiplier - 1)) : -amount };
    }

    async buyItem(guildId, userId, itemId) {
        const item = this._shopItems.get(itemId);
        if (!item) throw new EconomyError('ITEM_NOT_FOUND', `Item "${itemId}" not found`);
        const data = await this._getData(guildId, userId);
        if (data.balance < item.price) throw new EconomyError('INSUFFICIENT_FUNDS', 'Insufficient funds');
        if (item.maxOwned) {
            const owned = (data.inventory ?? []).filter(i => i.id === itemId).length;
            if (owned >= item.maxOwned) throw new EconomyError('MAX_OWNED', 'You already own the maximum amount of this item');
        }
        data.balance -= item.price;
        data.inventory = data.inventory ?? [];
        data.inventory.push({ id: itemId, purchasedAt: Date.now(), ...item });
        await this._setData(guildId, userId, data);
        this.emit('purchase', guildId, userId, item);
        return { item, balance: data.balance };
    }

    addShopItem(id, item) {
        this._shopItems.set(id, item);
        return this;
    }

    removeShopItem(id) {
        this._shopItems.delete(id);
        return this;
    }

    getShopItems() {
        return Object.fromEntries(this._shopItems);
    }

    async getLeaderboard(guildId, opts = {}) {
        if (!this._storage) return [];
        const entries = await this._storage.entries('economy');
        return entries
            .filter(([k]) => k.startsWith(`${guildId}:`))
            .map(([k, v]) => ({ userId: k.split(':')[1], total: (v.balance ?? 0) + (v.bank ?? 0), ...v }))
            .sort((a, b) => b.total - a.total)
            .slice(0, opts.limit ?? 10);
    }

    async resetUser(guildId, userId) {
        await this._setData(guildId, userId, { balance: this._startingBalance, bank: 0, lastDaily: 0, lastWork: 0, inventory: [] });
    }

    format(amount) {
        return `${this._currencySymbol} ${amount.toLocaleString('en-US')} ${this._currencyName}`;
    }
}

class EconomyError extends Error {
    constructor(code, message, data = {}) {
        super(message);
        this.code = code;
        this.data = data;
        this.name = 'EconomyError';
    }
}

module.exports = { EconomySystem, EconomyError };
