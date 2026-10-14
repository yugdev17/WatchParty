const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');

// Reliable HTTPS GET helper (avoids Node.js 24 fetch bugs on Windows)
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { family: 4, timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + data.substring(0, 150)));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Request timed out')));
    });
}
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 🔑 PUT YOUR REAL TMDB API KEY HERE (32 characters)
const TMDB_API_KEY = 'd411e3bbc2de81f662b87cc90518f87f';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

console.log('🔑 API Key loaded, length:', TMDB_API_KEY.length);

const rooms = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- CREATE ROOM ---
    socket.on('create-room', ({ username }) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomCode] = {
            host: socket.id,
            users: [{ id: socket.id, name: username }],
            videoState: { url: '', isPlaying: false, currentTime: 0 },
            messages: [],
            playlist: [],
            trailerState: { isOpen: false, title: '', key: '' }
        };
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.username = username;
        socket.emit('room-created', roomCode);
        socket.emit('is-host', true);
        io.to(roomCode).emit('user-list', rooms[roomCode].users);
    });

    // --- JOIN ROOM ---
    socket.on('join-room', ({ username, roomCode }) => {
        const room = rooms[roomCode];
        if (room) {
            room.users.push({ id: socket.id, name: username });
            socket.join(roomCode);
            socket.roomCode = roomCode;
            socket.username = username;
            socket.emit('room-joined', roomCode);
            socket.emit('is-host', false);
            io.to(roomCode).emit('user-list', room.users);
            socket.emit('sync-video-state', room.videoState);
            socket.emit('chat-history', room.messages);
            socket.emit('playlist-updated', room.playlist);
        } else {
            socket.emit('error-message', 'Room not found. Check the code.');
        }
    });

    // --- CHAT ---
    socket.on('chat-message', ({ roomCode, message }) => {
        if (rooms[roomCode]) {
            const chatData = {
                username: socket.username,
                message: message,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            rooms[roomCode].messages.push(chatData);
            if (rooms[roomCode].messages.length > 50) rooms[roomCode].messages.shift();
            io.to(roomCode).emit('chat-message', chatData);
        }
    });

    // --- VIDEO SYNC ---
    socket.on('change-video', ({ roomCode, url }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].videoState = { url, isPlaying: false, currentTime: 0 };
            io.to(roomCode).emit('video-changed', url);
        }
    });

    socket.on('play-video', ({ roomCode, currentTime }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].videoState.isPlaying = true;
            rooms[roomCode].videoState.currentTime = currentTime;
            socket.to(roomCode).emit('play-video', currentTime);
        }
    });

    socket.on('pause-video', ({ roomCode, currentTime }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].videoState.isPlaying = false;
            rooms[roomCode].videoState.currentTime = currentTime;
            socket.to(roomCode).emit('pause-video', currentTime);
        }
    });

    socket.on('seek-video', ({ roomCode, currentTime }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].videoState.currentTime = currentTime;
            socket.to(roomCode).emit('seek-video', currentTime);
        }
    });

    socket.on('sync-time', ({ roomCode, currentTime }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].videoState.currentTime = currentTime;
            socket.to(roomCode).emit('sync-time', currentTime);
        }
    });

    socket.on('request-sync', ({ roomCode }) => {
        if (rooms[roomCode]) socket.emit('sync-video-state', rooms[roomCode].videoState);
    });

    // --- MOVIE SEARCH ---
    socket.on('search-movies', async ({ query }) => {
        if (!query || query.length < 2) return;
        try {
            const url = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false`;
            const data = await httpsGet(url);
            const results = data.results.slice(0, 10).map(m => ({
                id: m.id,
                title: m.title,
                year: m.release_date ? m.release_date.split('-')[0] : 'N/A',
                poster: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
                overview: m.overview || 'No description available.'
            }));
            socket.emit('search-results', results);
        } catch (error) {
            console.log('❌ Search error:', error.message);
            socket.emit('search-results', []);
        }
    });
        // --- BROWSE MOVIES (Categories & Filters) ---
    socket.on('browse-movies', async ({ category, genreId }) => {
        try {
            let url;
            // If genre is selected, use discover endpoint
            if (genreId) {
                url = `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}&sort_by=popularity.desc`;
            } else {
                // Otherwise use the category's native endpoint
                let endpoint;
                if (category === 'trending') endpoint = '/trending/movie/day';
                else if (category === 'popular') endpoint = '/movie/popular';
                else if (category === 'top_rated') endpoint = '/movie/top_rated';
                else if (category === 'now_playing') endpoint = '/movie/now_playing';
                else endpoint = '/movie/popular';
                url = `${TMDB_BASE_URL}${endpoint}?api_key=${TMDB_API_KEY}`;
            }

            const data = await httpsGet(url);
            const results = data.results.slice(0, 20).map(m => ({
                id: m.id,
                title: m.title,
                year: m.release_date ? m.release_date.split('-')[0] : 'N/A',
                poster: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
                overview: m.overview || 'No description available.'
            }));
            socket.emit('browse-results', results);
        } catch (error) {
            console.log('❌ Browse error:', error.message);
            socket.emit('browse-results', []);
        }
    });

    // --- GET GENRES LIST ---
    socket.on('get-genres', async () => {
        try {
            const url = `${TMDB_BASE_URL}/genre/movie/list?api_key=${TMDB_API_KEY}`;
            const data = await httpsGet(url);
            socket.emit('genres-list', data.genres);
        } catch (error) {
            console.log('❌ Genres error:', error.message);
            socket.emit('genres-list', []);
        }
    });
    

    // --- SHARED PLAYLIST ---
    socket.on('add-to-playlist', ({ roomCode, movie }) => {
        if (rooms[roomCode]) {
            const item = {
                ...movie,
                tmdbId: movie.id,
                id: 'm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                addedBy: socket.username
            };
            rooms[roomCode].playlist.push(item);
            io.to(roomCode).emit('playlist-updated', rooms[roomCode].playlist);
        }
    });

    socket.on('remove-from-playlist', ({ roomCode, movieId }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].playlist = rooms[roomCode].playlist.filter(m => m.id !== movieId);
            io.to(roomCode).emit('playlist-updated', rooms[roomCode].playlist);
        }
    });

    // --- 🎬 PLAY TRAILER ---
       // --- 🎬 PLAY TRAILER ---
    socket.on('play-trailer', async ({ roomCode, movieId }) => {
        if (!rooms[roomCode]) return;
        const movie = rooms[roomCode].playlist.find(m => m.id === movieId);
        if (!movie) return;

        try {
            const fullUrl = `${TMDB_BASE_URL}/movie/${movie.tmdbId}/videos?api_key=${TMDB_API_KEY}`;
            console.log('🎬 Fetching trailer for:', movie.title);
            
            const data = await httpsGet(fullUrl);
            const videos = data.results;
            const trailer = videos.find(v => v.type === 'Trailer' && v.site === 'YouTube') 
                         || videos.find(v => v.site === 'YouTube');

            if (trailer) {
                console.log('✅ Trailer found:', trailer.key);
                rooms[roomCode].trailerState = { isOpen: true, title: movie.title, key: trailer.key };
                io.to(roomCode).emit('show-trailer', { title: movie.title, key: trailer.key });
            } else {
                console.log('❌ No YouTube trailer found');
                socket.emit('error-message', 'No trailer available for this movie.');
            }
        } catch (error) {
            console.log('❌ Trailer error:', error.message);
            socket.emit('error-message', 'Could not load trailer.');
        }
    });
        // --- 😀 EMOJI REACTIONS ---
    socket.on('emoji-reaction', ({ roomCode, emoji }) => {
        if (rooms[roomCode]) {
            io.to(roomCode).emit('emoji-reaction', {
                emoji: emoji,
                username: socket.username,
                id: Date.now() + '_' + Math.random().toString(36).substring(2, 6)
            });
        }
    });

    // --- TRAILER PLAY/PAUSE SYNC ---
    socket.on('trailer-state-change', ({ roomCode, isPlaying, currentTime }) => {
        if (rooms[roomCode] && rooms[roomCode].trailerState.isOpen) {
            socket.to(roomCode).emit('trailer-state-change', { isPlaying, currentTime });
        }
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            rooms[roomCode].users = rooms[roomCode].users.filter(u => u.id !== socket.id);
            if (rooms[roomCode].users.length === 0) {
                delete rooms[roomCode];
            } else {
                if (rooms[roomCode].host === socket.id) {
                    rooms[roomCode].host = rooms[roomCode].users[0].id;
                    io.to(rooms[roomCode].host).emit('is-host', true);
                }
                io.to(roomCode).emit('user-list', rooms[roomCode].users);
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is running! Open http://localhost:${PORT}`);
});