/**
 * WebRTC peer-to-peer manager for robust data syncing.
 */
export class WebRTCManager {
    constructor(socket, store) {
        this.socket = socket;
        this.store = store;
        this.peers = {};
        this.dataChannels = {};
        this.rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

        this._bindSocketEvents();
    }

    _bindSocketEvents() {
        this.socket.on('webrtc_hello', (data) => {
            if (data.sender && data.sender !== this.socket.id) {
                this.createPeerConnection(data.sender, true);
            }
        });

        this.socket.on('webrtc_offer', async (data) => {
            if (data.sender === this.socket.id) return;
            const pc = this.createPeerConnection(data.sender, false);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.socket.emit('webrtc_answer', { target: data.sender, answer });
        });

        this.socket.on('webrtc_answer', async (data) => {
            if (data.sender === this.socket.id) return;
            const pc = this.peers[data.sender];
            if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        });

        this.socket.on('webrtc_ice_candidate', async (data) => {
            if (data.sender === this.socket.id) return;
            const pc = this.peers[data.sender];
            if (pc && data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        });

        this.socket.on('peer_disconnected', data => {
            if (this.peers[data.peerId]) {
                this.peers[data.peerId].close();
                delete this.peers[data.peerId];
                delete this.dataChannels[data.peerId];
            }
            this._updatePeerCountUI();
        });
    }

    _updatePeerCountUI() {
        const el = document.getElementById('peer-count');
        if (el) el.innerText = Object.keys(this.peers).length;
    }

    startHello() {
        this.socket.emit('webrtc_hello', {});
    }

    createPeerConnection(peerId, isInitiator = false) {
        if (this.peers[peerId]) return this.peers[peerId];

        const pc = new RTCPeerConnection(this.rtcConfig);
        this.peers[peerId] = pc;
        this._updatePeerCountUI();

        pc.onicecandidate = event => {
            if (event.candidate) {
                this.socket.emit('webrtc_ice_candidate', { target: peerId, candidate: event.candidate });
            }
        };

        if (isInitiator) {
            const dc = pc.createDataChannel('sync', { negotiated: false });
            this._setupDataChannel(dc, peerId);

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    this.socket.emit('webrtc_offer', { target: peerId, offer: pc.localDescription });
                }).catch(err => console.error(err));
        } else {
            pc.ondatachannel = event => {
                this._setupDataChannel(event.channel, peerId);
            };
        }
        return pc;
    }

    _setupDataChannel(dc, peerId) {
        this.dataChannels[peerId] = dc;

        dc.onopen = () => {
            console.log('WebRTC Data channel opened with peer', peerId);
            dc.send(JSON.stringify({ type: 'sync', entries: this.store.getState().entries }));
        };

        dc.onmessage = event => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'sync') {
                    this.store.mergeSyncEntries(msg.entries);
                }
            } catch (e) {
                console.error('WebRTC rx error', e);
            }
        };
    }

    broadcastSync() {
        const payload = JSON.stringify({ type: 'sync', entries: this.store.getState().entries });
        Object.values(this.dataChannels).forEach(dc => {
            if (dc.readyState === 'open') {
                dc.send(payload);
            }
        });
    }
}
