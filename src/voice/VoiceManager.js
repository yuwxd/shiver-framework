const { EventEmitter } = require('events');

const VOICE_STATES = {
    IDLE: 'idle',
    PLAYING: 'playing',
    PAUSED: 'paused',
    BUFFERING: 'buffering',
    DESTROYED: 'destroyed'
};

class TrackMetadata {
    constructor(data) {
        this.title = data.title ?? 'Unknown';
        this.url = data.url ?? null;
        this.duration = data.duration ?? 0;
        this.thumbnail = data.thumbnail ?? null;
        this.requestedBy = data.requestedBy ?? null;
        this.source = data.source ?? 'unknown';
        this.stream = data.stream ?? null;
        this.extra = data.extra ?? {};
    }
}

class VoiceQueue {
    constructor(opts = {}) {
        this._tracks = [];
        this._history = [];
        this._maxHistory = opts.maxHistory ?? 50;
        this._loop = opts.loop ?? false;
        this._loopQueue = opts.loopQueue ?? false;
        this._shuffle = false;
    }

    get size() { return this._tracks.length; }
    get isEmpty() { return this._tracks.length === 0; }
    get current() { return this._tracks[0] ?? null; }
    get upcoming() { return this._tracks.slice(1); }
    get history() { return [...this._history]; }

    add(track, position = -1) {
        if (position >= 0 && position < this._tracks.length) {
            this._tracks.splice(position, 0, track);
        } else {
            this._tracks.push(track);
        }
        return this;
    }

    addMany(tracks) {
        this._tracks.push(...tracks);
        return this;
    }

    shift() {
        const track = this._tracks.shift();
        if (track) {
            this._history.unshift(track);
            if (this._history.length > this._maxHistory) this._history.pop();
            if (this._loopQueue && track) this._tracks.push(track);
        }
        return track;
    }

    remove(index) {
        if (index < 0 || index >= this._tracks.length) return null;
        return this._tracks.splice(index, 1)[0];
    }

    removeRange(start, end) {
        return this._tracks.splice(start, end - start);
    }

    move(from, to) {
        if (from < 0 || from >= this._tracks.length) return false;
        if (to < 0 || to >= this._tracks.length) return false;
        const [track] = this._tracks.splice(from, 1);
        this._tracks.splice(to, 0, track);
        return true;
    }

    shuffle() {
        for (let i = this._tracks.length - 1; i > 1; i--) {
            const j = 1 + Math.floor(Math.random() * i);
            [this._tracks[i], this._tracks[j]] = [this._tracks[j], this._tracks[i]];
        }
        return this;
    }

    clear(keepCurrent = false) {
        if (keepCurrent && this._tracks.length > 0) {
            this._tracks = [this._tracks[0]];
        } else {
            this._tracks = [];
        }
        return this;
    }

    setLoop(enabled) { this._loop = enabled; return this; }
    setLoopQueue(enabled) { this._loopQueue = enabled; return this; }
    isLoop() { return this._loop; }
    isLoopQueue() { return this._loopQueue; }

    toArray() { return [...this._tracks]; }

    previous() { return this._history[0] ?? null; }
}

class VoiceConnection extends EventEmitter {
    constructor(guildId, opts = {}) {
        super();
        this._guildId = guildId;
        this._channelId = null;
        this._connection = null;
        this._player = null;
        this._state = VOICE_STATES.IDLE;
        this._volume = opts.defaultVolume ?? 100;
        this._queue = new VoiceQueue(opts.queue ?? {});
        this._filters = new Set();
        this._recorder = null;
        this._bitrate = opts.bitrate ?? 64000;
        this._selfDeaf = opts.selfDeaf ?? true;
        this._selfMute = opts.selfMute ?? false;
        this._opts = opts;
    }

    get guildId() { return this._guildId; }
    get channelId() { return this._channelId; }
    get state() { return this._state; }
    get queue() { return this._queue; }
    get volume() { return this._volume; }
    get isPlaying() { return this._state === VOICE_STATES.PLAYING; }
    get isPaused() { return this._state === VOICE_STATES.PAUSED; }
    get isIdle() { return this._state === VOICE_STATES.IDLE; }

    async join(channel, opts = {}) {
        const { joinVoiceChannel } = require('@discordjs/voice');
        this._channelId = channel.id;
        this._connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: opts.selfDeaf ?? this._selfDeaf,
            selfMute: opts.selfMute ?? this._selfMute
        });
        await this._waitForReady();
        this.emit('join', channel);
        return this;
    }

    async _waitForReady() {
        const { VoiceConnectionStatus, entersState } = require('@discordjs/voice');
        try {
            await entersState(this._connection, VoiceConnectionStatus.Ready, 30_000);
        } catch (_) {
            this._connection.destroy();
            throw new Error('Voice connection failed to become ready within 30 seconds');
        }
    }

    _ensurePlayer() {
        if (this._player) return this._player;
        const { createAudioPlayer, NoSubscriberBehavior, AudioPlayerStatus } = require('@discordjs/voice');
        this._player = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
        });
        this._connection.subscribe(this._player);

        this._player.on(AudioPlayerStatus.Idle, () => {
            if (this._queue.isLoop() && this._queue.current) {
                this._playTrack(this._queue.current);
            } else {
                this._queue.shift();
                if (!this._queue.isEmpty) {
                    this._playTrack(this._queue.current);
                } else {
                    this._state = VOICE_STATES.IDLE;
                    this.emit('queueEnd');
                }
            }
        });

        this._player.on('error', (error) => {
            this.emit('playerError', error);
            this._queue.shift();
            if (!this._queue.isEmpty) {
                this._playTrack(this._queue.current);
            }
        });

        return this._player;
    }

    async _playTrack(track) {
        const { createAudioResource, StreamType } = require('@discordjs/voice');
        const player = this._ensurePlayer();
        this._state = VOICE_STATES.BUFFERING;
        this.emit('trackStart', track);

        let resource;
        if (track.stream) {
            resource = createAudioResource(track.stream, {
                inputType: track.streamType ?? StreamType.Arbitrary,
                inlineVolume: true
            });
        } else if (track.url) {
            const { Readable } = require('stream');
            const https = track.url.startsWith('https') ? require('https') : require('http');
            const stream = await new Promise((resolve, reject) => {
                https.get(track.url, res => resolve(res)).on('error', reject);
            });
            resource = createAudioResource(stream, { inlineVolume: true });
        } else {
            throw new Error('Track has no stream or URL');
        }

        if (resource.volume) {
            resource.volume.setVolumeLogarithmic(this._volume / 100);
        }

        this._currentResource = resource;
        player.play(resource);
        this._state = VOICE_STATES.PLAYING;
    }

    async play(track) {
        if (!(track instanceof TrackMetadata)) track = new TrackMetadata(track);
        this._queue.add(track);
        if (this.isIdle) {
            await this._playTrack(this._queue.current);
        }
        return this;
    }

    async playNow(track) {
        if (!(track instanceof TrackMetadata)) track = new TrackMetadata(track);
        this._queue.add(track, 0);
        this._ensurePlayer().stop(true);
        await this._playTrack(this._queue.current);
        return this;
    }

    pause() {
        if (!this._player || !this.isPlaying) return false;
        this._player.pause();
        this._state = VOICE_STATES.PAUSED;
        this.emit('pause');
        return true;
    }

    resume() {
        if (!this._player || !this.isPaused) return false;
        this._player.unpause();
        this._state = VOICE_STATES.PLAYING;
        this.emit('resume');
        return true;
    }

    skip(count = 1) {
        if (!this._player) return false;
        for (let i = 0; i < count - 1; i++) this._queue.shift();
        this._player.stop(true);
        this.emit('skip', count);
        return true;
    }

    stop() {
        if (!this._player) return false;
        this._queue.clear();
        this._player.stop(true);
        this._state = VOICE_STATES.IDLE;
        this.emit('stop');
        return true;
    }

    setVolume(volume) {
        this._volume = Math.max(0, Math.min(200, volume));
        if (this._currentResource?.volume) {
            this._currentResource.volume.setVolumeLogarithmic(this._volume / 100);
        }
        this.emit('volumeChange', this._volume);
        return this;
    }

    setLoop(enabled) {
        this._queue.setLoop(enabled);
        this.emit('loopChange', enabled);
        return this;
    }

    setLoopQueue(enabled) {
        this._queue.setLoopQueue(enabled);
        this.emit('loopQueueChange', enabled);
        return this;
    }

    shuffle() {
        this._queue.shuffle();
        this.emit('shuffle');
        return this;
    }

    seek(seconds) {
        if (!this._queue.current) return false;
        const track = this._queue.current;
        this.emit('seek', seconds);
        return true;
    }

    async startRecording(opts = {}) {
        const { EndBehaviorType } = require('@discordjs/voice');
        if (!this._connection) throw new Error('Not connected to voice');
        const { Writable } = require('stream');
        const recordings = new Map();

        this._receiver = this._connection.receiver;
        this._recorder = {
            recordings,
            start: (userId) => {
                if (recordings.has(userId)) return;
                const stream = this._receiver.subscribe(userId, {
                    end: { behavior: opts.endBehavior ?? EndBehaviorType.AfterSilence, duration: opts.silenceDuration ?? 100 }
                });
                const chunks = [];
                stream.on('data', chunk => chunks.push(chunk));
                stream.on('end', () => {
                    recordings.set(userId, Buffer.concat(chunks));
                    this.emit('recordingEnd', { userId, buffer: recordings.get(userId) });
                });
                this.emit('recordingStart', userId);
            },
            stop: (userId) => {
                recordings.delete(userId);
            },
            getBuffer: (userId) => recordings.get(userId) ?? null
        };

        return this._recorder;
    }

    stopRecording() {
        this._recorder = null;
        this._receiver = null;
    }

    async disconnect(opts = {}) {
        this.stop();
        if (this._connection) {
            if (opts.destroy !== false) {
                this._connection.destroy();
            } else {
                const { VoiceConnectionStatus } = require('@discordjs/voice');
                this._connection.disconnect();
            }
        }
        this._state = VOICE_STATES.DESTROYED;
        this.emit('disconnect');
    }

    getStatus() {
        return {
            state: this._state,
            channelId: this._channelId,
            volume: this._volume,
            queueSize: this._queue.size,
            currentTrack: this._queue.current,
            loop: this._queue.isLoop(),
            loopQueue: this._queue.isLoopQueue(),
            filters: [...this._filters]
        };
    }
}

class VoiceManager extends EventEmitter {
    constructor(opts = {}) {
        super();
        this._connections = new Map();
        this._opts = opts;
        this._defaultVolume = opts.defaultVolume ?? 100;
        this._maxQueueSize = opts.maxQueueSize ?? 500;
        this._autoLeave = opts.autoLeave ?? true;
        this._autoLeaveDelay = opts.autoLeaveDelay ?? 30000;
        this._autoLeaveTimers = new Map();
    }

    getConnection(guildId) {
        return this._connections.get(guildId) ?? null;
    }

    hasConnection(guildId) {
        return this._connections.has(guildId);
    }

    async join(channel, opts = {}) {
        const existing = this._connections.get(channel.guild.id);
        if (existing) {
            if (existing.channelId === channel.id) return existing;
            await existing.disconnect({ destroy: false });
        }

        const conn = new VoiceConnection(channel.guild.id, {
            defaultVolume: this._defaultVolume,
            ...this._opts,
            ...opts
        });

        conn.on('queueEnd', () => {
            if (this._autoLeave) {
                const timer = setTimeout(async () => {
                    const c = this._connections.get(channel.guild.id);
                    if (c?.isIdle) {
                        await c.disconnect();
                        this._connections.delete(channel.guild.id);
                        this.emit('autoLeave', channel.guild.id);
                    }
                    this._autoLeaveTimers.delete(channel.guild.id);
                }, this._autoLeaveDelay);
                this._autoLeaveTimers.set(channel.guild.id, timer);
            }
        });

        conn.on('trackStart', () => {
            const timer = this._autoLeaveTimers.get(channel.guild.id);
            if (timer) { clearTimeout(timer); this._autoLeaveTimers.delete(channel.guild.id); }
        });

        conn.on('disconnect', () => {
            this._connections.delete(channel.guild.id);
            this.emit('connectionDestroyed', channel.guild.id);
        });

        await conn.join(channel, opts);
        this._connections.set(channel.guild.id, conn);
        this.emit('connectionCreated', conn);
        return conn;
    }

    async leave(guildId) {
        const conn = this._connections.get(guildId);
        if (!conn) return false;
        await conn.disconnect();
        this._connections.delete(guildId);
        const timer = this._autoLeaveTimers.get(guildId);
        if (timer) { clearTimeout(timer); this._autoLeaveTimers.delete(guildId); }
        return true;
    }

    async play(channel, track, opts = {}) {
        let conn = this.getConnection(channel.guild.id);
        if (!conn) conn = await this.join(channel, opts);
        return conn.play(track);
    }

    async destroyAll() {
        for (const [guildId, conn] of this._connections) {
            await conn.disconnect();
        }
        this._connections.clear();
        for (const timer of this._autoLeaveTimers.values()) clearTimeout(timer);
        this._autoLeaveTimers.clear();
    }

    getStats() {
        return {
            connections: this._connections.size,
            playing: [...this._connections.values()].filter(c => c.isPlaying).length,
            paused: [...this._connections.values()].filter(c => c.isPaused).length,
            idle: [...this._connections.values()].filter(c => c.isIdle).length
        };
    }
}

module.exports = { VoiceManager, VoiceConnection, VoiceQueue, TrackMetadata, VOICE_STATES };
