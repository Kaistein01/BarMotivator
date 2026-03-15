export class SocketClient {
    constructor(socket, store, webrtcManager) {
        this.socket = socket;
        this.store = store;
        this.webrtcManager = webrtcManager;

        this._bindEvents();
    }

    _bindEvents() {
        this.socket.on('debug_toggled', (debugState) => {
            this.store.setDebugMode(debugState);
        });

        this.socket.on('new_entry', (entry) => {
            this.store.addEntry(entry);
            this.webrtcManager.broadcastSync(); // P2P Sync
        });

        this.socket.on('clear', () => {
            this.store.clearEntries();
            this.webrtcManager.broadcastSync(); // P2P Sync
        });
    }
}
