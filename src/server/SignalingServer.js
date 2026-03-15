const { Server } = require('socket.io');

/**
 * SignalingServer encapsulates Socket.IO logic for WebRTC and real-time app events.
 */
class SignalingServer {
    constructor(httpServer) {
        this.io = new Server(httpServer, {
            cors: { origin: '*' }
        });

        this._setupEvents();
    }

    _setupEvents() {
        this.io.on('connection', (socket) => {
            console.log('Client connected:', socket.id);

            // WebRTC Signaling
            socket.on('webrtc_hello', (data) => {
                socket.broadcast.emit('webrtc_hello', { ...data, sender: socket.id });
            });

            socket.on('webrtc_offer', (data) => {
                socket.broadcast.emit('webrtc_offer', { ...data, sender: socket.id });
            });

            socket.on('webrtc_answer', (data) => {
                this.io.to(data.target).emit('webrtc_answer', { ...data, sender: socket.id });
            });

            socket.on('webrtc_ice_candidate', (data) => {
                this.io.to(data.target).emit('webrtc_ice_candidate', { ...data, sender: socket.id });
            });

            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
                socket.broadcast.emit('peer_disconnected', { peerId: socket.id });
            });
        });
    }

    broadcastNewEntry(entry) {
        this.io.emit('new_entry', entry);
    }

    broadcastClear() {
        this.io.emit('clear');
    }

    broadcastDebugState(state) {
        this.io.emit('debug_toggled', state);
    }
}

module.exports = SignalingServer;
