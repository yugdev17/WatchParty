
const socket = io();

        const lobbyView = document.getElementById('lobby-view');
        const roomView = document.getElementById('room-view');
        const usernameInput = document.getElementById('username-input');
        const roomCodeInput = document.getElementById('room-code-input');
        const createBtn = document.getElementById('create-btn');
        const joinBtn = document.getElementById('join-btn');
        const errorMsg = document.getElementById('error-msg');
        const displayRoomCode = document.getElementById('display-room-code');
        const userList = document.getElementById('user-list');
        const videoPlayer = document.getElementById('video-player');
        const videoUrlInput = document.getElementById('video-url-input');
        const loadVideoBtn = document.getElementById('load-video-btn');
        const forceSyncBtn = document.getElementById('force-sync-btn');
        const playPauseBtn = document.getElementById('play-pause-btn');
        const chatMessages = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const sendChatBtn = document.getElementById('send-chat-btn');
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');
        const playlistItems = document.getElementById('playlist-items');
        const trailerModal = document.getElementById('trailer-modal');
        const trailerTitle = document.getElementById('trailer-title');
        const closeModalBtn = document.getElementById('close-modal-btn');
        const emojiBar = document.getElementById('emoji-bar');
        const reactionOverlay = document.getElementById('reaction-overlay');

        let currentRoomCode = '';
        let isHost = false;
        let syncLock = false;
        let isBuffering = false;

        let ytPlayer = null;
        let isRemoteTrailerAction = false;

        // --- LOBBY ---
        createBtn.addEventListener('click', () => {
            const username = usernameInput.value.trim();
            if (!username) return alert('Please enter a name!');
            socket.emit('create-room', { username });
        });

        joinBtn.addEventListener('click', () => {
            const username = usernameInput.value.trim();
            const roomCode = roomCodeInput.value.trim().toUpperCase();
            if (!username) return alert('Please enter a name!');
            if (!roomCode) return alert('Please enter a room code!');
            socket.emit('join-room', { username, roomCode });
        });

        socket.on('room-created', (roomCode) => { currentRoomCode = roomCode; showRoomView(roomCode); });
        socket.on('room-joined', (roomCode) => { currentRoomCode = roomCode; showRoomView(roomCode); });
        socket.on('is-host', (status) => { isHost = status; });

        socket.on('user-list', (users) => {
            userList.innerHTML = '';
            users.forEach(user => {
                const li = document.createElement('li');
                li.textContent = user.name;
                userList.appendChild(li);
            });
        });

        socket.on('error-message', (msg) => {
            errorMsg.textContent = msg;
            if (msg.toLowerCase().includes('trailer')) alert(msg);
        });

        function showRoomView(roomCode) {
            lobbyView.classList.add('hidden');
            roomView.classList.remove('hidden');
            displayRoomCode.textContent = roomCode;
            errorMsg.textContent = '';
        }

        // --- MOVIE SEARCH ---
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const query = searchInput.value.trim();
            if (query.length < 2) {
                searchResults.innerHTML = '<p style="color: #888; font-size: 0.85em;">Start typing to search...</p>';
                return;
            }
            searchTimeout = setTimeout(() => socket.emit('search-movies', { query }), 400);
        });

        socket.on('search-results', (results) => {
            searchResults.innerHTML = '';
            if (results.length === 0) {
                searchResults.innerHTML = '<p style="color: #888; font-size: 0.85em;">No movies found.</p>';
                return;
            }
            results.forEach(movie => {
                const div = document.createElement('div');
                div.className = 'movie-result';
                div.innerHTML = `
                    <img src="${movie.poster || 'https://via.placeholder.com/40x60/333/888?text=?'}" alt="${movie.title}">
                    <div class="movie-result-info">
                        <h4>${movie.title} <span style="color:#888;font-weight:normal;">(${movie.year})</span></h4>
                        <p>${movie.overview}</p>
                    </div>
                    <button class="add-btn">+ Add</button>
                `;
                div.addEventListener('click', () => {
                    socket.emit('add-to-playlist', { roomCode: currentRoomCode, movie });
                    div.style.opacity = '0.5';
                    setTimeout(() => { div.style.opacity = '1'; }, 300);
                });
                searchResults.appendChild(div);
            });
        });

        // --- PLAYLIST ---
        socket.on('playlist-updated', (playlist) => {
            playlistItems.innerHTML = '';
            if (playlist.length === 0) {
                playlistItems.innerHTML = '<p style="color: #888; font-size: 0.85em;">No movies in playlist yet. Add some!</p>';
                return;
            }
            playlist.forEach(movie => {
                const div = document.createElement('div');
                div.className = 'playlist-item';
                div.innerHTML = `
                    <img src="${movie.poster || 'https://via.placeholder.com/35x52/333/888?text=?'}" alt="${movie.title}">
                    <div class="playlist-item-info">
                        <h4>${movie.title}</h4>
                        <span>${movie.year} • added by ${movie.addedBy || 'user'}</span>
                    </div>
                    <div class="playlist-item-actions">
                        <button class="play-trailer-btn" style="background-color: #e91e63;">▶ Trailer</button>
                        <button class="remove-btn" style="background-color: #555;">✕ Remove</button>
                    </div>
                `;
                div.querySelector('.play-trailer-btn').addEventListener('click', () => {
                    socket.emit('play-trailer', { roomCode: currentRoomCode, movieId: movie.id });
                });
                div.querySelector('.remove-btn').addEventListener('click', () => {
                    socket.emit('remove-from-playlist', { roomCode: currentRoomCode, movieId: movie.id });
                });
                playlistItems.appendChild(div);
            });
        });

        // --- TRAILER SYNC ---
        socket.on('show-trailer', ({ title, key }) => {
            trailerTitle.textContent = `▶ ${title}`;
            trailerModal.classList.remove('hidden');

            if (window.ytApiReady) {
                buildYtPlayer(key);
            } else {
                window.pendingTrailerKey = key;
            }
        });

        window.buildYtPlayer = function(videoKey) {
            if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
                ytPlayer.loadVideoById(videoKey);
                return;
            }
            setTimeout(() => {
                ytPlayer = new YT.Player('trailer-frame', {
                    videoId: videoKey,
                    playerVars: {
                        autoplay: 1,
                        origin: window.location.origin,
                        enablejsapi: 1
                    },
                    events: {
                        'onReady': (event) => event.target.playVideo(),
                        'onStateChange': onYtStateChange,
                        'onError': (e) => console.error('YouTube Player Error:', e.data)
                    }
                });
            }, 200);
        };

        function onYtStateChange(event) {
            if (isRemoteTrailerAction) return;
            if (event.data === 1) {
                socket.emit('trailer-state-change', { roomCode: currentRoomCode, isPlaying: true, currentTime: ytPlayer.getCurrentTime() });
            } else if (event.data === 2) {
                socket.emit('trailer-state-change', { roomCode: currentRoomCode, isPlaying: false, currentTime: ytPlayer.getCurrentTime() });
            }
        }

        socket.on('trailer-state-change', ({ isPlaying }) => {
            if (!ytPlayer) return;
            isRemoteTrailerAction = true;
            if (isPlaying) ytPlayer.playVideo();
            else ytPlayer.pauseVideo();
            setTimeout(() => { isRemoteTrailerAction = false; }, 500);
        });

        closeModalBtn.addEventListener('click', () => {
            if (ytPlayer) ytPlayer.stopVideo();
            trailerModal.classList.add('hidden');
        });

        // --- CHAT ---
        sendChatBtn.addEventListener('click', sendChat);
        chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

        function sendChat() {
            const message = chatInput.value.trim();
            if (!message) return;
            socket.emit('chat-message', { roomCode: currentRoomCode, message });
            chatInput.value = '';
        }

        socket.on('chat-history', (messages) => {
            chatMessages.innerHTML = '';
            messages.forEach(msg => addChatMessage(msg));
            scrollToBottom();
        });

        socket.on('chat-message', (data) => { addChatMessage(data); scrollToBottom(); });

        function addChatMessage(data) {
            const div = document.createElement('div');
            div.className = 'chat-msg';
            div.innerHTML = `<span class="name">${data.username}</span>${data.message}<span class="time">${data.time}</span>`;
            chatMessages.appendChild(div);
        }

        function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }
                // --- 😀 EMOJI REACTIONS ---
        emojiBar.querySelectorAll('.emoji-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emoji = btn.dataset.emoji;
                socket.emit('emoji-reaction', { roomCode: currentRoomCode, emoji });
            });
        });

        socket.on('emoji-reaction', ({ emoji, username, id }) => {
            const el = document.createElement('div');
            el.className = 'floating-emoji';
            el.innerHTML = `<span>${emoji}</span><span class="sender">${username}</span>`;
            
            // Randomize horizontal position slightly so they don't stack
            const randomOffset = Math.floor(Math.random() * 30) - 15;
            el.style.right = (randomOffset) + 'px';
            
            reactionOverlay.appendChild(el);
            
            // Remove after the animation finishes (3 seconds)
            setTimeout(() => {
                el.remove();
            }, 3000);
        });

        // --- VIDEO PLAYER ---
        loadVideoBtn.addEventListener('click', () => {
            const url = videoUrlInput.value.trim();
            if (!url) return alert('Please enter a video URL');
            socket.emit('change-video', { roomCode: currentRoomCode, url });
        });

        forceSyncBtn.addEventListener('click', () => socket.emit('request-sync', { roomCode: currentRoomCode }));

        playPauseBtn.addEventListener('click', () => {
            if (videoPlayer.paused) videoPlayer.play();
            else videoPlayer.pause();
        });

        socket.on('video-changed', (url) => {
            syncLock = true;
            videoPlayer.src = url;
            videoPlayer.load();
            setTimeout(() => { syncLock = false; }, 500);
        });

        socket.on('sync-video-state', (state) => {
            if (state.url) {
                syncLock = true;
                videoPlayer.src = state.url;
                videoPlayer.currentTime = state.currentTime;
                if (state.isPlaying) videoPlayer.play().catch(e => console.log('Autoplay blocked'));
                setTimeout(() => { syncLock = false; }, 500);
            }
        });

        videoPlayer.addEventListener('waiting', () => { isBuffering = true; });
        videoPlayer.addEventListener('playing', () => { isBuffering = false; });

        videoPlayer.addEventListener('play', () => {
            if (syncLock || isBuffering) return;
            socket.emit('play-video', { roomCode: currentRoomCode, currentTime: videoPlayer.currentTime });
        });

        videoPlayer.addEventListener('pause', () => {
            if (syncLock || isBuffering) return;
            socket.emit('pause-video', { roomCode: currentRoomCode, currentTime: videoPlayer.currentTime });
        });

        videoPlayer.addEventListener('seeked', () => {
            if (syncLock || isBuffering) return;
            socket.emit('seek-video', { roomCode: currentRoomCode, currentTime: videoPlayer.currentTime });
        });

        socket.on('play-video', (time) => {
            syncLock = true;
            if (Math.abs(videoPlayer.currentTime - time) > 1.0) videoPlayer.currentTime = time;
            videoPlayer.play().catch(e => console.log('Autoplay blocked'));
            setTimeout(() => { syncLock = false; }, 500);
        });

        socket.on('pause-video', (time) => {
            syncLock = true;
            videoPlayer.currentTime = time;
            videoPlayer.pause();
            setTimeout(() => { syncLock = false; }, 500);
        });

        socket.on('seek-video', (time) => {
            syncLock = true;
            videoPlayer.currentTime = time;
            setTimeout(() => { syncLock = false; }, 500);
        });

        setInterval(() => {
            if (isHost && !videoPlayer.paused && !isBuffering && !syncLock && currentRoomCode) {
                socket.emit('sync-time', { roomCode: currentRoomCode, currentTime: videoPlayer.currentTime });
            }
        }, 4000);

        socket.on('sync-time', (hostTime) => {
            if (!isHost && !videoPlayer.paused && !isBuffering && !syncLock) {
                const drift = Math.abs(videoPlayer.currentTime - hostTime);
                if (drift > 1.5) {
                    syncLock = true;
                    videoPlayer.currentTime = hostTime;
                    setTimeout(() => { syncLock = false; }, 500);
                }
            }
        });

        document.getElementById('leave-btn').addEventListener('click', () => { window.location.reload(); });
