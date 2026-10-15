// ============================================
// WATCH PARTY — Client Logic
// ============================================

const socket = io();

// --- DOM References ---
const lobbyView = document.getElementById('screen-lobby');
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
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const wishlistItems = document.getElementById('wishlist-items');
const playlistItems = document.getElementById('playlist-items');
const trailerModal = document.getElementById('trailer-modal');
const trailerTitle = document.getElementById('trailer-title');
const closeModalBtn = document.getElementById('close-modal-btn');
const emojiBar = document.getElementById('emoji-bar');
const reactionOverlay = document.getElementById('reaction-overlay');
const copyInviteBtn = document.getElementById('copy-invite-btn');
const inviteBanner = document.getElementById('invite-banner');
const inviteRoomCode = document.getElementById('invite-room-code');

// Users chip + dropdown
const usersChip = document.getElementById('users-chip');
const usersDropdown = document.getElementById('users-dropdown');
const usersCount = document.getElementById('users-count');

// Toast
const toast = document.getElementById('toast');
const toastIcon = toast.querySelector('.toast-icon');
const toastText = toast.querySelector('.toast-text');

// Promote modal
const promoteModal = document.getElementById('promote-modal');
const promoteCloseBtn = document.getElementById('promote-close-btn');
const promoteTitle = document.getElementById('promote-title');
const promoteUrlInput = document.getElementById('promote-url-input');
const promoteCancelBtn = document.getElementById('promote-cancel-btn');
const promoteConfirmBtn = document.getElementById('promote-confirm-btn');

// Poll elements
const startPollBtn = document.getElementById('start-poll-btn');
const pollEmpty = document.getElementById('poll-empty');
const pollEmptyMsg = document.getElementById('poll-empty-msg');
const pollActive = document.getElementById('poll-active');
const pollVotingView = document.getElementById('poll-voting-view');
const pollResultsView = document.getElementById('poll-results-view');
const pollCountdown = document.getElementById('poll-countdown');
const pollVotesLeft = document.getElementById('poll-votes-left');
const pollResetBtn = document.getElementById('poll-reset-btn');
const pollModalOptions = document.getElementById('poll-modal-options');
const pollWinnerDisplay = document.getElementById('poll-winner-display');
const pollDoneBtn = document.getElementById('poll-done-btn');
const pollVotedStatus = document.getElementById('poll-voted-status');
const pollDeclareRow = document.getElementById('poll-declare-row');
const pollDeclareBtn = document.getElementById('poll-declare-btn');

// Lobby flow
const showEnterCodeBtn = document.getElementById('show-enter-code-btn');
const backBtn = document.getElementById('back-btn');
const enterCodeSection = document.getElementById('enter-code-section');
const lobbyActions = document.getElementById('lobby-actions');
const lobbyTitle = document.getElementById('lobby-title');

// --- State ---
let currentRoomCode = '';
let currentUsername = '';
let isHost = false;
let syncLock = false;
let isBuffering = false;
let ytPlayer = null;
let isRemoteTrailerAction = false;
let invitedRoomCode = null;
let searchTimeout;
let currentCategory = 'trending';
let currentGenreId = '';
let currentWishlist = [];
let currentPlaylist = [];
let currentPoll = null;
let currentPollResults = null;
let pollCountdownInterval = null;
let promotingMovie = null;
let activeTab = 'chat';
let hasConnectedOnce = false;

// ============================================
// SESSION STORAGE (for reconnection)
// ============================================
const SESSION_KEY = 'watchparty_session';

function saveSession() {
    if (!currentRoomCode || !currentUsername) return;
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            roomCode: currentRoomCode,
            username: currentUsername,
            savedAt: Date.now()
        }));
    } catch (e) {}
}

function loadSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        // Expire sessions older than 2 hours
        if (Date.now() - data.savedAt > 2 * 60 * 60 * 1000) {
            localStorage.removeItem(SESSION_KEY);
            return null;
        }
        return data;
    } catch (e) {
        return null;
    }
}

function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
let toastTimeout = null;

function showToast(text, type = 'info', duration = 0) {
    toastText.textContent = text;
    toast.className = 'toast';
    if (type === 'success') toast.classList.add('toast-success');
    if (type === 'error') toast.classList.add('toast-error');
    if (type === 'info') toast.classList.add('toast-spinning');
    toast.classList.remove('hidden');

    if (toastTimeout) clearTimeout(toastTimeout);
    if (duration > 0) {
        toastTimeout = setTimeout(() => {
            toast.classList.add('hidden');
        }, duration);
    }
}

function hideToast() {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.classList.add('hidden');
}

// ============================================
// SOCKET CONNECTION EVENTS (reconnection)
// ============================================
socket.on('connect', () => {
    if (hasConnectedOnce) {
        // This is a RE-connection
        console.log('🔌 Socket reconnected. Attempting to rejoin room…');
        const session = loadSession();
        if (session && session.roomCode) {
            // Silently try to rejoin the room we were in
            currentRoomCode = session.roomCode;
            currentUsername = session.username;
            socket.emit('join-room', {
                username: session.username,
                roomCode: session.roomCode
            });
        } else {
            // No session — just hide the toast
            hideToast();
        }
    }
    hasConnectedOnce = true;
});

socket.on('disconnect', (reason) => {
    console.log('🔌 Socket disconnected:', reason);
    // Only show the toast if we're in a room
    if (currentRoomCode) {
        showToast('Reconnecting…', 'info', 0);
    }
});

// Handle reconnection success/failure via server responses
socket.on('room-joined', (roomCode) => {
    // If we already had this room (a reconnection), show success
    const wasReconnect = (currentRoomCode === roomCode && roomView && !roomView.classList.contains('hidden'));
    
    currentRoomCode = roomCode;
    currentUsername = usernameInput.value.trim() || currentUsername;
    showRoomView(roomCode);
    socket.emit('get-genres');
    socket.emit('browse-movies', { category: 'trending', genreId: '' });
    saveSession();
    
    if (wasReconnect) {
        showToast('Reconnected', 'success', 2000);
    }
});

socket.on('room-created', (roomCode) => {
    currentRoomCode = roomCode;
    currentUsername = usernameInput.value.trim();
    showRoomView(roomCode);
    socket.emit('get-genres');
    socket.emit('browse-movies', { category: 'trending', genreId: '' });
    saveSession();
});

// ============================================
// INVITE LINK DETECTION
// ============================================
(function checkInviteLink() {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get('room');
    if (inviteCode) {
        invitedRoomCode = inviteCode.toUpperCase();
        inviteRoomCode.textContent = invitedRoomCode;
        inviteBanner.classList.remove('hidden');

        lobbyActions.classList.add('hidden');
        enterCodeSection.classList.remove('hidden');
        roomCodeInput.classList.add('hidden');
        backBtn.classList.add('hidden');
        joinBtn.style.flex = '1';
        lobbyTitle.textContent = 'Join the party';

        usernameInput.focus();
    }
})();

// ============================================
// AUTO-RESUME ON PAGE LOAD
// ============================================
(function tryAutoResume() {
    if (invitedRoomCode) return; // invite link takes priority
    const session = loadSession();
    if (session && session.roomCode && session.username) {
        console.log('🔄 Found saved session, auto-rejoining:', session.roomCode);
        currentRoomCode = session.roomCode;
        currentUsername = session.username;
        usernameInput.value = session.username;
        socket.emit('join-room', {
            username: session.username,
            roomCode: session.roomCode
        });
    }
})();

// ============================================
// LOBBY FLOW
// ============================================
createBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) return alert('Please enter a name!');
    currentUsername = username;
    socket.emit('create-room', { username });
});

showEnterCodeBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) return alert('Please enter a name!');
    lobbyActions.classList.add('hidden');
    enterCodeSection.classList.remove('hidden');
    lobbyTitle.textContent = 'Enter Room Code';
    roomCodeInput.focus();
});

backBtn.addEventListener('click', () => {
    enterCodeSection.classList.add('hidden');
    lobbyActions.classList.remove('hidden');
    lobbyTitle.textContent = "What's your name?";
    errorMsg.textContent = '';
});

joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomCode = invitedRoomCode || roomCodeInput.value.trim().toUpperCase();
    if (!username) return alert('Please enter a name!');
    if (!roomCode) return alert('Please enter a room code!');
    currentUsername = username;
    socket.emit('join-room', { username, roomCode });
});

// ============================================
// ROOM EVENTS
// ============================================
socket.on('is-host', (status) => {
    isHost = status;
    if (currentWishlist.length) renderWishlist(currentWishlist);
    if (currentPlaylist.length) renderPlaylist(currentPlaylist);
    updatePollEmptyState();
});

socket.on('user-list', (users) => {
    userList.innerHTML = '';
    users.forEach(user => {
        const li = document.createElement('li');
        li.textContent = user.name;
        userList.appendChild(li);
    });
    if (usersCount) usersCount.textContent = users.length;
});

socket.on('error-message', (msg) => {
    // If we were trying to auto-rejoin and the room is gone, clear session and go back to lobby
    if (msg.includes('Room not found') && currentRoomCode) {
        clearSession();
        currentRoomCode = '';
        currentUsername = '';
        hideToast();
        // If room is open, go back to lobby
        if (roomView && !roomView.classList.contains('hidden')) {
            showToast('Room no longer exists', 'error', 3000);
            setTimeout(() => window.location.reload(), 1500);
            return;
        }
    }
    errorMsg.textContent = msg;
    if (msg.toLowerCase().includes('trailer')) alert(msg);
    if (msg.toLowerCase().includes('poll')) alert(msg);
});

function showRoomView(roomCode) {
    lobbyView.classList.add('hidden');
    roomView.classList.remove('hidden');
    displayRoomCode.textContent = roomCode;
    errorMsg.textContent = '';
}

// ============================================
// USERS DROPDOWN
// ============================================
if (usersChip) {
    usersChip.addEventListener('click', (e) => {
        if (e.target.closest('#users-dropdown')) return;
        e.stopPropagation();
        usersDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!usersChip.contains(e.target)) {
            usersDropdown.classList.add('hidden');
        }
    });
}

// ============================================
// COPY INVITE LINK
// ============================================
copyInviteBtn.addEventListener('click', () => {
    const inviteUrl = `${window.location.origin}?room=${currentRoomCode}`;

    navigator.clipboard.writeText(inviteUrl).then(() => {
        const original = copyInviteBtn.innerHTML;
        copyInviteBtn.innerHTML = '✅ Copied!';
        copyInviteBtn.style.background = 'rgba(76, 175, 80, 0.25)';
        copyInviteBtn.style.borderColor = '#4CAF50';
        setTimeout(() => {
            copyInviteBtn.innerHTML = original;
            copyInviteBtn.style.background = '';
            copyInviteBtn.style.borderColor = '';
        }, 2000);
    }).catch(() => {
        prompt('Copy this link:', inviteUrl);
    });
});

// ============================================
// MOVIE DISCOVERY
// ============================================
function displayMovies(results) {
    searchResults.innerHTML = '';
    if (results.length === 0) {
        searchResults.innerHTML = '<p class="muted-text">No movies found.</p>';
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
            socket.emit('add-to-wishlist', { roomCode: currentRoomCode, movie });
            const addBtn = div.querySelector('.add-btn');
            addBtn.textContent = '✓ Added';
            addBtn.classList.add('added');
            div.style.opacity = '0.6';
            setTimeout(() => { div.style.opacity = '1'; }, 300);
        });

        searchResults.appendChild(div);
    });
}

const browseCache = new Map();

function cacheKey(category, genreId) {
    return category + '|' + (genreId || '');
}

function fetchBrowse(category, genreId) {
    const key = cacheKey(category, genreId);
    const cached = browseCache.get(key);

    if (cached) {
        displayMovies(cached);
    } else {
        searchResults.innerHTML = '<p class="muted-text">Loading movies…</p>';
        socket.emit('browse-movies', { category, genreId });
    }
}

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (query.length < 2) {
        fetchBrowse(currentCategory, currentGenreId);
        return;
    }
    searchResults.innerHTML = '<p class="muted-text">Searching…</p>';
    searchTimeout = setTimeout(() => socket.emit('search-movies', { query }), 400);
});

socket.on('search-results', (results) => displayMovies(results));

socket.on('browse-results', ({ category, genreId, results }) => {
    if (results.length > 0) {
        browseCache.set(cacheKey(category, genreId), results);
    }
    if (category === currentCategory && genreId === (currentGenreId || '')) {
        displayMovies(results);
    }
});

socket.on('genres-list', (genres) => {
    const select = document.getElementById('genre-select');
    select.innerHTML = '<option value="">All Genres</option>';
    genres.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        select.appendChild(opt);
    });
});

document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentCategory = tab.dataset.category;
        searchInput.value = '';
        fetchBrowse(currentCategory, currentGenreId);
    });
});

document.getElementById('genre-select').addEventListener('change', (e) => {
    currentGenreId = e.target.value;
    searchInput.value = '';
    fetchBrowse(currentCategory, currentGenreId);
});

// ============================================
// WISHLIST
// ============================================
socket.on('wishlist-updated', (wishlist) => {
    currentWishlist = wishlist;
    renderWishlist(wishlist);
    updatePollEmptyState();
});

function renderWishlist(wishlist) {
    wishlistItems.innerHTML = '';
    if (wishlist.length === 0) {
        wishlistItems.innerHTML = '<p class="muted-text">No movies in the wishlist yet. Add from the Movies tab!</p>';
        return;
    }
    wishlist.forEach(movie => {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        div.innerHTML = `
            <img src="${movie.poster || 'https://via.placeholder.com/35x52/333/888?text=?'}" alt="${movie.title}">
            <div class="playlist-item-info">
                <h4>${movie.title}</h4>
                <span>${movie.year}${movie.rating ? ' · ⭐ ' + movie.rating : ''}</span>
            </div>
            <div class="playlist-item-actions">
                <button class="trailer-btn" style="background-color: var(--gold); color: #0d0d12;">▶ Trailer</button>
                ${isHost ? `<button class="promote-btn" style="background-color: #2196F3;">→ Playlist</button>` : ''}
                <button class="remove-btn" style="background-color: #3a3a44;">✕</button>
            </div>
        `;
        div.querySelector('.trailer-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            socket.emit('play-trailer', { roomCode: currentRoomCode, tmdbId: movie.tmdbId, title: movie.title });
        });
        const promoteBtn = div.querySelector('.promote-btn');
        if (promoteBtn) {
            promoteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openPromoteModal(movie);
            });
        }
        div.querySelector('.remove-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            socket.emit('remove-from-wishlist', { roomCode: currentRoomCode, movieId: movie.id });
        });
        wishlistItems.appendChild(div);
    });
}

// ============================================
// PLAYLIST
// ============================================
socket.on('playlist-updated', (playlist) => {
    currentPlaylist = playlist;
    renderPlaylist(playlist);
});

function renderPlaylist(playlist) {
    playlistItems.innerHTML = '';
    if (playlist.length === 0) {
        playlistItems.innerHTML = '<p class="muted-text">No videos in the playlist yet. Promote from Wishlist or paste a URL.</p>';
        return;
    }
    playlist.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        div.innerHTML = `
            <span class="playlist-index">${index + 1}</span>
            <img src="${item.poster || 'https://via.placeholder.com/35x52/333/888?text=?'}" alt="${item.title}">
            <div class="playlist-item-info">
                <h4>${item.title}</h4>
                <span>${item.url.substring(0, 30)}…</span>
            </div>
            <div class="playlist-item-actions">
                <button class="play-btn" style="background-color: var(--success);">▶ Play</button>
                ${isHost ? `<button class="remove-btn" style="background-color: #3a3a44;">✕</button>` : ''}
            </div>
        `;
        div.querySelector('.play-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            socket.emit('play-from-playlist', { roomCode: currentRoomCode, itemId: item.id });
        });
        const removeBtn = div.querySelector('.remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                socket.emit('remove-from-playlist', { roomCode: currentRoomCode, itemId: item.id });
            });
        }
        playlistItems.appendChild(div);
    });
}

// ============================================
// PROMOTE MODAL
// ============================================
function openPromoteModal(movie) {
    promotingMovie = movie;
    promoteTitle.textContent = `Add "${movie.title}" to Playlist`;
    promoteUrlInput.value = '';
    promoteModal.classList.remove('hidden');
    promoteUrlInput.focus();
}

promoteCloseBtn.addEventListener('click', () => {
    promoteModal.classList.add('hidden');
    promotingMovie = null;
});

promoteCancelBtn.addEventListener('click', () => {
    promoteModal.classList.add('hidden');
    promotingMovie = null;
});

promoteConfirmBtn.addEventListener('click', () => {
    const url = promoteUrlInput.value.trim();
    if (!url) return alert('Please paste a video URL');
    if (!promotingMovie) return;

    socket.emit('add-to-playlist', {
        roomCode: currentRoomCode,
        item: {
            title: promotingMovie.title,
            url: url,
            poster: promotingMovie.poster,
            tmdbId: promotingMovie.tmdbId
        }
    });

    socket.emit('remove-from-wishlist', { roomCode: currentRoomCode, movieId: promotingMovie.id });

    promoteModal.classList.add('hidden');
    promotingMovie = null;
    switchTab('playlist');
});

promoteUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') promoteConfirmBtn.click();
});

// ============================================
// TRAILER
// ============================================
socket.on('show-trailer', ({ title, key }) => {
    trailerTitle.textContent = `▶ ${title}`;
    trailerModal.classList.remove('hidden');

    const loading = document.getElementById('trailer-loading');
    if (loading) loading.classList.remove('hidden');

    if (window.ytApiReady) {
        buildYtPlayer(key);
    } else {
        window.pendingTrailerKey = key;
    }
});

window.buildYtPlayer = function(videoKey) {
    const loading = document.getElementById('trailer-loading');

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
        ytPlayer.loadVideoById(videoKey);
        setTimeout(() => { if (loading) loading.classList.add('hidden'); }, 800);
        return;
    }

    setTimeout(() => {
        ytPlayer = new YT.Player('trailer-frame', {
            videoId: videoKey,
            playerVars: { autoplay: 1, enablejsapi: 1 },
            events: {
                'onReady': (event) => {
                    event.target.playVideo();
                    if (loading) loading.classList.add('hidden');
                },
                'onStateChange': (event) => {
                    if (event.data === 1 && loading) loading.classList.add('hidden');
                    onYtStateChange(event);
                },
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

function closeTrailerModal() {
    try {
        if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
            ytPlayer.stopVideo();
        }
    } catch (err) {
        console.log('Stop video error (ignored):', err);
    }
    trailerModal.classList.add('hidden');
    const loading = document.getElementById('trailer-loading');
    if (loading) loading.classList.add('hidden');
}

closeModalBtn.addEventListener('click', closeTrailerModal);

trailerModal.addEventListener('click', (e) => {
    if (e.target === trailerModal) closeTrailerModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!trailerModal.classList.contains('hidden')) closeTrailerModal();
        if (!promoteModal.classList.contains('hidden')) {
            promoteModal.classList.add('hidden');
            promotingMovie = null;
        }
    }
});

// ============================================
// CHAT
// ============================================
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

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================
// EMOJI REACTIONS
// ============================================
emojiBar.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        socket.emit('emoji-reaction', { roomCode: currentRoomCode, emoji });
    });
});

socket.on('emoji-reaction', ({ emoji, username }) => {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.innerHTML = `<span>${emoji}</span><span class="sender">${username}</span>`;

    const randomOffset = Math.floor(Math.random() * 30) - 15;
    el.style.right = randomOffset + 'px';

    reactionOverlay.appendChild(el);
    setTimeout(() => { el.remove(); }, 3000);
});

// ============================================
// VIDEO PLAYER SYNC
// ============================================
loadVideoBtn.addEventListener('click', () => {
    const url = videoUrlInput.value.trim();
    if (!url) return alert('Please enter a video URL');
    socket.emit('change-video', { roomCode: currentRoomCode, url });
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

videoPlayer.addEventListener('ended', () => {
    if (isHost && currentRoomCode) {
        socket.emit('video-ended', { roomCode: currentRoomCode });
    }
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

// ============================================
// TAB SWITCHING
// ============================================
function switchTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel-content').forEach(c => c.classList.remove('active'));
    const tabBtn = document.querySelector(`.panel-tab[data-tab="${tabName}"]`);
    const tabContent = document.getElementById('tab-' + tabName);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabContent) tabContent.classList.add('active');
}

document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        switchTab(tab.dataset.tab);
    });
});

// ============================================
// POLLS
// ============================================
function updatePollEmptyState() {
    if (currentPoll && currentPoll.isActive) {
        pollEmpty.classList.add('hidden');
        pollActive.classList.remove('hidden');
        startPollBtn.classList.add('hidden');
        return;
    }

    if (currentPollResults) {
        pollEmpty.classList.add('hidden');
        pollActive.classList.add('hidden');
        return;
    }

    pollEmpty.classList.remove('hidden');
    pollActive.classList.add('hidden');

    if (isHost && currentWishlist.length >= 2) {
        pollEmptyMsg.textContent = 'Ready to vote? Start a poll with the wishlist!';
        startPollBtn.classList.remove('hidden');
    } else if (!isHost) {
        pollEmptyMsg.textContent = 'Waiting for the host to start a poll…';
        startPollBtn.classList.add('hidden');
    } else {
        pollEmptyMsg.textContent = 'Add at least 2 movies to the wishlist before starting a poll.';
        startPollBtn.classList.add('hidden');
    }
}

startPollBtn.addEventListener('click', () => {
    if (currentWishlist.length < 2) {
        alert('You need at least 2 movies in the wishlist to start a poll.');
        return;
    }
    socket.emit('create-poll', { roomCode: currentRoomCode });
});

pollResetBtn.addEventListener('click', () => {
    socket.emit('reset-my-votes', { roomCode: currentRoomCode });
});

pollDeclareBtn.addEventListener('click', () => {
    socket.emit('close-poll', { roomCode: currentRoomCode });
});

pollDoneBtn.addEventListener('click', () => {
    socket.emit('dismiss-poll', { roomCode: currentRoomCode });
});

socket.on('poll-updated', (poll) => {
    currentPoll = poll;
    currentPollResults = null;
    pollVotingView.classList.remove('hidden');
    pollResultsView.classList.add('hidden');
    renderActivePoll();
    updatePollEmptyState();
});

socket.on('poll-results', (results) => {
    currentPollResults = results;
    currentPoll = null;
    if (pollCountdownInterval) clearInterval(pollCountdownInterval);

    pollVotingView.classList.add('hidden');
    pollResultsView.classList.remove('hidden');
    pollEmpty.classList.add('hidden');
    pollActive.classList.add('hidden');

    renderPollResults(results);
    switchTab('polls');
});

socket.on('poll-dismissed', () => {
    currentPoll = null;
    currentPollResults = null;
    if (pollCountdownInterval) clearInterval(pollCountdownInterval);
    pollVotingView.classList.remove('hidden');
    pollResultsView.classList.add('hidden');
    updatePollEmptyState();
});

function renderActivePoll() {
    if (!currentPoll || !currentPoll.isActive) {
        updatePollEmptyState();
        return;
    }

    pollEmpty.classList.add('hidden');
    pollActive.classList.remove('hidden');
    startPollBtn.classList.add('hidden');
    pollVotingView.classList.remove('hidden');
    pollResultsView.classList.add('hidden');

    const userTotalVotes = currentPoll.options.reduce(
        (sum, opt) => sum + (opt.myVotes || 0), 0
    );
    const votesLeft = Math.max(0, 2 - userTotalVotes);
    pollVotesLeft.textContent = votesLeft;

    pollVotedStatus.textContent = `${currentPoll.totalVoters} of ${currentPoll.totalUsers} voted`;

    if (currentPoll.allVoted && isHost) {
        pollDeclareRow.classList.remove('hidden');
    } else {
        pollDeclareRow.classList.add('hidden');
    }

    startCountdown(currentPoll.endTime);

    pollModalOptions.innerHTML = '';
    currentPoll.options.forEach(opt => {
        const myVoteCount = opt.myVotes || 0;

        const div = document.createElement('div');
        div.className = 'poll-option' + (myVoteCount > 0 ? ' my-vote' : '');
        div.innerHTML = `
            <img src="${opt.poster || 'https://via.placeholder.com/32x48/333/888?text=?'}" alt="">
            <div class="poll-option-content">
                <span class="poll-option-title">${opt.title}</span>
                ${opt.rating ? `<span class="poll-option-rating">⭐ ${opt.rating}</span>` : ''}
            </div>
            <div class="poll-option-right">
                ${myVoteCount > 0 ? `<div class="poll-my-votes">${'<div class="dot"></div>'.repeat(myVoteCount)}</div>` : ''}
                ${myVoteCount > 0 ? `<button class="poll-remove-btn" title="Remove one vote">−</button>` : ''}
            </div>
        `;

        div.addEventListener('click', (e) => {
            if (e.target.closest('.poll-remove-btn')) return;
            if (votesLeft <= 0) {
                alert('You have used both your votes. Click Reset to change them.');
                return;
            }
            socket.emit('vote-poll', {
                roomCode: currentRoomCode,
                optionId: opt.id,
                action: 'add'
            });
        });

        const removeBtn = div.querySelector('.poll-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                socket.emit('vote-poll', {
                    roomCode: currentRoomCode,
                    optionId: opt.id,
                    action: 'remove'
                });
            });
        }

        pollModalOptions.appendChild(div);
    });
}

function startCountdown(endTime) {
    if (pollCountdownInterval) clearInterval(pollCountdownInterval);

    function tick() {
        const remaining = Math.max(0, endTime - Date.now());
        const seconds = Math.floor(remaining / 1000);
        const mm = Math.floor(seconds / 60);
        const ss = seconds % 60;
        pollCountdown.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;

        if (remaining < 10000) {
            pollCountdown.classList.add('urgent');
        } else {
            pollCountdown.classList.remove('urgent');
        }

        if (remaining <= 0) {
            clearInterval(pollCountdownInterval);
        }
    }

    tick();
    pollCountdownInterval = setInterval(tick, 500);
}

function renderPollResults(results) {
    const { winner, isTie } = results;

    let winnerHTML = '';
    if (isTie) {
        winnerHTML = `
            <div style="font-size: 20px; margin-bottom: 4px;">🤝</div>
            <div style="color: var(--gold); font-size: 12px; margin-bottom: 10px;">It's a tie! Breaking by rating…</div>
            <img src="${winner.poster || 'https://via.placeholder.com/100x150/333/888?text=?'}" class="winner-poster" alt="">
            <div class="winner-title">${winner.title}</div>
            <div class="winner-rating">⭐ ${winner.rating}</div>
            <button id="winner-trailer-btn" class="btn btn-primary" style="margin-top: 16px;">▶ Watch Trailer</button>
            ${isHost ? `<button id="winner-promote-btn" class="btn btn-primary" style="margin-top: 10px; background: #2196F3; color: white;">→ Add to Playlist</button>` : ''}
        `;
    } else {
        winnerHTML = `
            <div style="font-size: 20px; margin-bottom: 10px;">🏆 Winner</div>
            <img src="${winner.poster || 'https://via.placeholder.com/100x150/333/888?text=?'}" class="winner-poster" alt="">
            <div class="winner-title">${winner.title}</div>
            <div class="winner-rating">⭐ ${winner.rating}</div>
            <button id="winner-trailer-btn" class="btn btn-primary" style="margin-top: 16px;">▶ Watch Trailer</button>
            ${isHost ? `<button id="winner-promote-btn" class="btn btn-primary" style="margin-top: 10px; background: #2196F3; color: white;">→ Add to Playlist</button>` : ''}
        `;
    }
    pollWinnerDisplay.innerHTML = winnerHTML;

    const trailerBtn = document.getElementById('winner-trailer-btn');
    if (trailerBtn) {
        trailerBtn.addEventListener('click', () => {
            socket.emit('play-trailer', { roomCode: currentRoomCode, tmdbId: winner.tmdbId, title: winner.title });
        });
    }

    const promoteBtn = document.getElementById('winner-promote-btn');
    if (promoteBtn) {
        promoteBtn.addEventListener('click', () => {
            const wlItem = currentWishlist.find(w => w.tmdbId === winner.tmdbId) || {
                title: winner.title,
                poster: winner.poster,
                tmdbId: winner.tmdbId
            };
            openPromoteModal(wlItem);
        });
    }
}

// ============================================
// LEAVE ROOM (clears session)
// ============================================
document.getElementById('leave-btn').addEventListener('click', () => {
    clearSession();
    window.location.reload();
});