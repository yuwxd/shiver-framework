class PresenceManager {
    constructor(options = {}) {
        this._options = options;
        this._client = null;
        this._rotationTimer = null;
        this._rotationIndex = 0;
        this._lastUpdate = 0;
        this._throttleMs = options.throttleMs ?? 60000;
    }

    setActivity(activityOptions) {
        if (!this._client) return;
        const now = Date.now();
        if (now - this._lastUpdate < this._throttleMs) return;
        this._lastUpdate = now;
        try {
            this._client.user?.setActivity(activityOptions);
        } catch (err) {
            console.error('[PresenceManager] setActivity error:', err?.message);
        }
    }

    startRotation(activities, intervalMs = 60000) {
        this.stopRotation();
        if (!activities?.length) return;

        this._rotationIndex = 0;
        this._lastUpdate = 0;
        this.setActivity(activities[0]);

        this._rotationTimer = setInterval(() => {
            this._rotationIndex = (this._rotationIndex + 1) % activities.length;
            this._lastUpdate = 0;
            this.setActivity(activities[this._rotationIndex]);
        }, Math.max(intervalMs, this._throttleMs));

        if (this._rotationTimer.unref) this._rotationTimer.unref();
    }

    stopRotation() {
        if (this._rotationTimer) {
            clearInterval(this._rotationTimer);
            this._rotationTimer = null;
        }
    }

    setStatus(status) {
        if (!this._client) return;
        try {
            this._client.user?.setStatus(status);
        } catch (err) {
            console.error('[PresenceManager] setStatus error:', err?.message);
        }
    }
}

module.exports = { PresenceManager };
