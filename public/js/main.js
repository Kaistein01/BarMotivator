import { Store } from './core/Store.js';
import { TimelineChart } from './components/TimelineChart.js';
import { Leaderboard } from './components/Leaderboard.js';
import { WebRTCManager } from './network/WebRTCManager.js';
import { SocketClient } from './network/SocketClient.js';

async function bootstrap() {
    const store = new Store();

    // Initialize UI Components
    const leaderboard = new Leaderboard('leaderboard', store);
    const timeline = new TimelineChart('timeline-chart', store);

    // Initial render bindings
    store.subscribe(() => {
        leaderboard.render();
        timeline.render();
    });

    // Network & Real-time Layer
    const socket = io();
    const webrtcManager = new WebRTCManager(socket, store);
    const socketClient = new SocketClient(socket, store, webrtcManager); // binds the socket events to state

    // Initial Data Fetch
    try {
        const [dataRes, debugRes] = await Promise.all([
            fetch('/api/data'),
            fetch('/api/debug')
        ]);

        let categories = [], entries = [];
        if (dataRes.ok) {
            const data = await dataRes.json();
            categories = data.categories || [];
            entries = data.entries || [];
        }

        store.setInitialData(categories, entries);

        if (debugRes.ok) {
            const debugData = await debugRes.json();
            store.setDebugMode(debugData.debug);
        }

        // Advertise presence to the WebRTC mesh
        webrtcManager.startHello();
    } catch (err) {
        console.error('Error fetching initial data:', err);
    }
}

document.addEventListener('DOMContentLoaded', bootstrap);
