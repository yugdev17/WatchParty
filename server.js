const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// 🔑 PUT YOUR REAL TMDB API KEY HERE
const TMDB_API_KEY = 'd411e3bbc2de81f662b87cc90518f87f';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

console.log('🔑 API Key loaded, length:', TMDB_API_KEY.length);

// Reliable HTTPS GET helper
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { family: 4, timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error('Invalid JSON response')); }
                } else {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + data.substring(0, 150)));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('Request timed out')));
    });
}

const rooms = {};
let cachedGenres = null;

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // --- CREATE ROOM ---
    socket.on('create-room', ({ username }) => {
        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        rooms[roomCode] = {
            host: socket.id,
            users: [{ id: socket.id, name: username }],
            videoState: { url: '', isPlaying: false, currentTime: 0, playlistIndex: -1 },
            messages: [],
            wishlist: [],
            playlist: [],
            trailerState: { isOpen: false, title: '', key: '' },
            poll: null,
            pollTimer: null
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
            socket.emit('wishlist-updated', room.wishlist);
            socket.emit('playlist-updated', room.playlist);
            if (room.poll) emitPollUpdate(roomCode);
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
            rooms[roomCode].videoState = { url, isPlaying: false, currentTime: 0, playlistIndex: -1 };
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

    // --- 🎬 VIDEO ENDED (auto-play next in playlist) ---
    socket.on('video-ended', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        // Only the host triggers the advance
        if (socket.id !== room.host) return;

        const currentIndex = room.videoState.playlistIndex;
        if (currentIndex < 0) return; // not playing from playlist

        const nextIndex = currentIndex + 1;
        if (nextIndex >= room.playlist.length) {
            // No more videos — just stop
            room.videoState.isPlaying = false;
            return;
        }

        const nextVideo = room.playlist[nextIndex];
        room.videoState = {
            url: nextVideo.url,
            isPlaying: true,
            currentTime: 0,
            playlistIndex: nextIndex
        };

        io.to(roomCode).emit('video-changed', nextVideo.url);
        // Give clients a moment to load before telling them to play
        setTimeout(() => {
            io.to(roomCode).emit('play-video', 0);
        }, 800);
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
                rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : 0,
                overview: m.overview || 'No description available.'
            }));
            socket.emit('search-results', results);
        } catch (error) {
            console.log('❌ Search error:', error.message);
            socket.emit('search-results', []);
        }
    });

    // --- BROWSE MOVIES ---
    socket.on('browse-movies', async ({ category, genreId }) => {
        try {
            let url;
            if (genreId) {
                url = `${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}&sort_by=popularity.desc`;
            } else {
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
                rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : 0,
                overview: m.overview || 'No description available.'
            }));
            socket.emit('browse-results', { category, genreId: genreId || '', results });
        } catch (error) {
            console.log('❌ Browse error:', error.message);
            socket.emit('browse-results', { category, genreId: genreId || '', results: [] });
        }
    });

    // --- GENRES ---
    socket.on('get-genres', async () => {
        if (cachedGenres) {
            socket.emit('genres-list', cachedGenres);
            return;
        }
        try {
            const url = `${TMDB_BASE_URL}/genre/movie/list?api_key=${TMDB_API_KEY}`;
            const data = await httpsGet(url);
            cachedGenres = data.genres;
            socket.emit('genres-list', cachedGenres);
        } catch (error) {
            console.log('❌ Genres error:', error.message);
            socket.emit('genres-list', []);
        }
    });

    // --- 📝 WISHLIST (TMDB movies) ---
    socket.on('add-to-wishlist', ({ roomCode, movie }) => {
        if (rooms[roomCode]) {
            const item = {
                ...movie,
                tmdbId: movie.id,
                id: 'w_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                addedBy: socket.username
            };
            rooms[roomCode].wishlist.push(item);
            io.to(roomCode).emit('wishlist-updated', rooms[roomCode].wishlist);
        }
    });

    socket.on('remove-from-wishlist', ({ roomCode, movieId }) => {
        if (rooms[roomCode]) {
            rooms[roomCode].wishlist = rooms[roomCode].wishlist.filter(m => m.id !== movieId);
            io.to(roomCode).emit('wishlist-updated', rooms[roomCode].wishlist);
        }
    });

    // --- 🎞️ PLAYLIST (videos with URLs — host-only management) ---
    socket.on('add-to-playlist', ({ roomCode, item }) => {
        if (!rooms[roomCode]) return;
        if (socket.id !== rooms[roomCode].host) {
            socket.emit('error-message', 'Only the host can add to the playlist.');
            return;
        }
        const newItem = {
            id: 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            title: item.title,
            url: item.url,
            poster: item.poster || null,
            tmdbId: item.tmdbId || null,
            addedBy: socket.username
        };
        rooms[roomCode].playlist.push(newItem);
        io.to(roomCode).emit('playlist-updated', rooms[roomCode].playlist);
    });

    socket.on('remove-from-playlist', ({ roomCode, itemId }) => {
        if (!rooms[roomCode]) return;
        if (socket.id !== rooms[roomCode].host) {
            socket.emit('error-message', 'Only the host can remove from the playlist.');
            return;
        }
        rooms[roomCode].playlist = rooms[roomCode].playlist.filter(m => m.id !== itemId);
        io.to(roomCode).emit('playlist-updated', rooms[roomCode].playlist);
    });

    // --- ▶ PLAY A PLAYLIST VIDEO ---
    socket.on('play-from-playlist', ({ roomCode, itemId }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const index = room.playlist.findIndex(m => m.id === itemId);
        if (index < 0) return;
        const item = room.playlist[index];

        room.videoState = {
            url: item.url,
            isPlaying: true,
            currentTime: 0,
            playlistIndex: index
        };

        io.to(roomCode).emit('video-changed', item.url);
        setTimeout(() => {
            io.to(roomCode).emit('play-video', 0);
        }, 800);
    });

    // --- 🎬 PLAY TRAILER (for any TMDB movie) ---
    socket.on('play-trailer', async ({ roomCode, tmdbId, title }) => {
        if (!rooms[roomCode]) return;

        try {
            const fullUrl = `${TMDB_BASE_URL}/movie/${tmdbId}/videos?api_key=${TMDB_API_KEY}`;
            const data = await httpsGet(fullUrl);
            const videos = data.results;
            const trailer = videos.find(v => v.type === 'Trailer' && v.site === 'YouTube')
                         || videos.find(v => v.site === 'YouTube');

            if (trailer) {
                rooms[roomCode].trailerState = { isOpen: true, title, key: trailer.key };
                io.to(roomCode).emit('show-trailer', { title, key: trailer.key });
            } else {
                socket.emit('error-message', 'No trailer available for this movie.');
            }
        } catch (error) {
            console.log('❌ Trailer error:', error.message);
            socket.emit('error-message', 'Could not load trailer.');
        }
    });

    // --- TRAILER PLAY/PAUSE SYNC ---
    socket.on('trailer-state-change', ({ roomCode, isPlaying, currentTime }) => {
        if (rooms[roomCode] && rooms[roomCode].trailerState.isOpen) {
            socket.to(roomCode).emit('trailer-state-change', { isPlaying, currentTime });
        }
    });

    // --- EMOJI REACTIONS ---
    socket.on('emoji-reaction', ({ roomCode, emoji }) => {
        if (rooms[roomCode]) {
            io.to(roomCode).emit('emoji-reaction', {
                emoji: emoji,
                username: socket.username,
                id: Date.now() + '_' + Math.random().toString(36).substring(2, 6)
            });
        }
    });

    // --- 🗳️ GROUP POLLS (votes on WISHLIST) ---

    function emitPollUpdate(roomCode) {
        const room = rooms[roomCode];
        if (!room || !room.poll) return;
        const poll = room.poll;

        const voters = new Set();
        poll.options.forEach(opt => opt.votes.forEach(v => voters.add(v)));
        const totalUsers = room.users.length;

        // "All voted" = everyone used both their 2 votes
        const totalVotesCast = poll.options.reduce((sum, opt) => sum + opt.votes.length, 0);
        const maxPossibleVotes = totalUsers * 2;
        const allVoted = totalVotesCast >= maxPossibleVotes;

        room.users.forEach(u => {
            const optionsForUser = poll.options.map(opt => ({
                id: opt.id,
                title: opt.title,
                poster: opt.poster,
                rating: opt.rating,
                tmdbId: opt.tmdbId,
                myVotes: opt.votes.filter(v => v === u.name).length
            }));

            io.to(u.id).emit('poll-updated', {
                isActive: poll.isActive,
                createdBy: poll.createdBy,
                endTime: poll.endTime,
                allVoted: allVoted,
                totalVoters: voters.size,
                totalUsers: totalUsers,
                options: optionsForUser
            });
        });
    }

    function closePollForRoom(roomCode) {
        const room = rooms[roomCode];
        if (!room || !room.poll) return;
        const poll = room.poll;
        if (!poll.isActive) return;

        const results = poll.options.map(opt => ({
            id: opt.id,
            title: opt.title,
            poster: opt.poster,
            rating: opt.rating || 0,
            tmdbId: opt.tmdbId,
            count: opt.votes.length
        }));

        const maxVotes = Math.max(...results.map(r => r.count));
        const topOptions = results.filter(r => r.count === maxVotes);

        let winner, isTie = false;

        if (maxVotes === 0) {
            winner = results.reduce((best, curr) =>
                curr.rating > best.rating ? curr : best, results[0]);
        } else if (topOptions.length > 1) {
            isTie = true;
            winner = topOptions.reduce((best, curr) =>
                curr.rating > best.rating ? curr : best, topOptions[0]);
        } else {
            winner = topOptions[0];
        }

        poll.isActive = false;
        poll.results = {
            winner,
            isTie,
            topOptions: topOptions.map(o => o.id),
            counts: results,
            totalVotes: maxVotes
        };

        if (room.pollTimer) {
            clearTimeout(room.pollTimer);
            room.pollTimer = null;
        }

        io.to(roomCode).emit('poll-results', poll.results);
    }

    socket.on('create-poll', ({ roomCode }) => {
        if (!rooms[roomCode]) return;
        const room = rooms[roomCode];

        if (socket.id !== room.host) {
            socket.emit('error-message', 'Only the host can start a poll.');
            return;
        }
        if (room.wishlist.length < 2) {
            socket.emit('error-message', 'Need at least 2 movies in the wishlist to start a poll.');
            return;
        }
        if (room.poll && room.poll.isActive) {
            socket.emit('error-message', 'A poll is already active.');
            return;
        }

        const POLL_DURATION = 60000;

        room.poll = {
            isActive: true,
            createdBy: socket.username,
            endTime: Date.now() + POLL_DURATION,
            options: room.wishlist.map(m => ({
                id: m.id,
                title: m.title,
                poster: m.poster,
                rating: m.rating || 0,
                tmdbId: m.tmdbId,
                votes: []
            }))
        };

        emitPollUpdate(roomCode);

        if (room.pollTimer) clearTimeout(room.pollTimer);
        room.pollTimer = setTimeout(() => closePollForRoom(roomCode), POLL_DURATION);
    });

    socket.on('vote-poll', ({ roomCode, optionId, action }) => {
        if (!rooms[roomCode] || !rooms[roomCode].poll) return;
        const poll = rooms[roomCode].poll;
        if (!poll.isActive) return;

        const username = socket.username;
        const option = poll.options.find(o => o.id === optionId);
        if (!option) return;

        if (action === 'remove') {
            const idx = option.votes.indexOf(username);
            if (idx !== -1) option.votes.splice(idx, 1);
        } else {
            const userTotal = poll.options.reduce(
                (sum, opt) => sum + opt.votes.filter(v => v === username).length, 0
            );
            if (userTotal >= 2) return;
            option.votes.push(username);
        }

        emitPollUpdate(roomCode);
    });

    socket.on('reset-my-votes', ({ roomCode }) => {
        if (!rooms[roomCode] || !rooms[roomCode].poll) return;
        const poll = rooms[roomCode].poll;
        if (!poll.isActive) return;
        const username = socket.username;
        poll.options.forEach(opt => {
            opt.votes = opt.votes.filter(v => v !== username);
        });
        emitPollUpdate(roomCode);
    });

    socket.on('close-poll', ({ roomCode }) => {
        if (!rooms[roomCode]) return;
        if (socket.id !== rooms[roomCode].host) {
            socket.emit('error-message', 'Only the host can close the poll.');
            return;
        }
        closePollForRoom(roomCode);
    });

    socket.on('dismiss-poll', ({ roomCode }) => {
        if (!rooms[roomCode]) return;
        rooms[roomCode].poll = null;
        io.to(roomCode).emit('poll-dismissed');
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (roomCode && rooms[roomCode]) {
            rooms[roomCode].users = rooms[roomCode].users.filter(u => u.id !== socket.id);
            if (rooms[roomCode].users.length === 0) {
                if (rooms[roomCode].pollTimer) clearTimeout(rooms[roomCode].pollTimer);
                delete rooms[roomCode];
            } else {
                if (rooms[roomCode].host === socket.id) {
                    rooms[roomCode].host = rooms[roomCode].users[0].id;
                    io.to(rooms[roomCode].host).emit('is-host', true);
                }
                io.to(roomCode).emit('user-list', rooms[roomCode].users);
                if (rooms[roomCode].poll) emitPollUpdate(roomCode);
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is running! Open http://localhost:${PORT}`);
});