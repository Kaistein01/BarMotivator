/**
 * Main application entry point.
 */
const http = require('http');
const Database = require('./src/database/Database');
const SignalingServer = require('./src/server/SignalingServer');
const ApiServer = require('./src/server/ApiServer');

async function bootstrap() {
    // 1. Initialize SQLite Database
    const db = new Database();
    await db.init();
    console.log('Database initialized.');

    // 2. Initialize Express API wrapper (without signaling yet to prevent circular instantiation)
    const api = new ApiServer(db, null);

    // 3. Initialize the web server with Express attached
    const server = http.createServer(api.getApp());

    // 4. Initialize Socket.io WebRTC/Real-Time Server
    const signaling = new SignalingServer(server);
    api.signaling = signaling; // Attach signaling back to API for broadcasting

    // 5. Start Listening
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

bootstrap().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
