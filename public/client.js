// ============================================
// WATCH PARTY - Client Logic
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
const playlistItems = document.getElementById('playlist-items');
const trailerModal = document.getElementById('trailer-modal');
const trailerTitle = document.getElementById('trailer-title');
const closeModalBtn = document.getElementById('close-modal-btn');
const emojiBar = document.getElementById('emoji-bar');
const reactionOverlay = document.getElementById('reaction-overlay');
const copyInviteBtn = document.getElementById('copy-invite-btn');
const inviteBanner = document.getElementById('invite-banner');
const inviteRoomCode = document.getElementById('invite-room-code');

// Poll elements
const pollHeaderBtn = document.getElementById('poll-header-btn');
const pollModal = document.getElementById('poll-modal');
const pollModalCloseBtn = document.getElementById('poll-modal-close-btn');
const pollVotingView = document.getElementById('poll-voting-view');
const pollResultsView = document.getElementById('poll-results-view');
const pollCountdown = document.getElementById('poll-countdown');
const pollVotesLeft = document.getElementById('poll-votes-left');
const pollResetBtn = document.getElementById('poll-reset-btn');
const pollModalOptions = document.getElementById('poll-modal-options');
const pollWinnerDisplay = document.getElementById('poll-winner-display');
const pollFinalOptions = document.getElementById('poll-final-options');
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
let isHost = false;
let syncLock = false;
let isBuffering = false;
let ytPlayer = null;
let isRemoteTrailerAction = false;
let invitedRoomCode = null;
let searchTimeout;
let currentCategory = 'trending';
let currentGenreId = '';
let currentPlaylist = [];
let currentPoll = null;
let currentPollResults = null;
let pollCountdownInterval = null;

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
// LOBBY FLOW
// ============================================
createBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) return alert('Please enter a name!');
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
    socket.emit('join-room', { username, roomCode });
});

// ============================================
// ROOM EVENTS
// ============================================
socket.on('room-created', (roomCode) => {
    currentRoomCode = roomCode;
    showRoomView(roomCode);
    socket.emit('get-genres');
    socket.emit('browse-movies', { category: 'trending', genreId: '' });
});

socket.on('room-joined', (roomCode) => {
    currentRoomCode = roomCode;
    showRoomView(roomCode);
    socket.emit('get-genres');
    socket.emit('browse-movies', { category: 'trending', genreId: '' });
});

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
    if (msg.toLowerCase().includes('poll')) alert(msg);
});

function showRoomView(roomCode) {
    lobbyView.classList.add('hidden');
    roomView.classList.remove('hidden');
    displayRoomCode.textContent = roomCode;
    errorMsg.textContent = '';
}

// ============================================
// COPY INVITE LINK
// ============================================
copyInviteBtn.addEventListener('click', () => {
    const inviteUrl = `${window.location.origin}?room=${currentRoomCode}`;

    navigator.clipboard.writeText(inviteUrl).then(() => {
        copyInviteBtn.textContent = '✅';
        copyInviteBtn.style.backgroundColor = '#4CAF50';
        setTimeout(() => {
            copyInviteBtn.textContent = '🔗';
            copyInviteBtn.style.backgroundColor = '';
        }, 2000);
    }).catch(() => {
        prompt('Copy this link:', inviteUrl);
    });
});

// ============================================
// MOVIE DISCOVERY (Search + Browse)
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
            socket.emit('add-to-playlist', { roomCode: currentRoomCode, movie });

            const addBtn = div.querySelector('.add-btn');
            addBtn.textContent = '✓ Added';
            addBtn.classList.add('added');

            div.style.opacity = '0.6';
            setTimeout(() => { div.style.opacity = '1'; }, 300);
        });

        searchResults.appendChild(div);
    });
}

// --- Browse cache ---
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
// SHARED PLAYLIST
// ============================================
socket.on('playlist-updated', (playlist) => {
    currentPlaylist = playlist;
    playlistItems.innerHTML = '';
    if (playlist.length === 0) {
        playlistItems.innerHTML = '<p class="muted-text">No movies yet. Add from the Movies tab!</p>';
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
                <button class="play-trailer-btn" style="background-color: #e50914;">▶ Trailer</button>
                <button class="remove-btn" style="background-color: #3a3a44;">✕</button>
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

// ============================================
// TRAILER
// ============================================
socket.on('show-trailer', ({ title, key }) => {
    console.log('🎬 show-trailer received:', title, key);
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
            playerVars: {
                autoplay: 1,
                enablejsapi: 1
            },
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
        socket.emit('trailer-state-change', {
            roomCode: currentRoomCode,
            isPlaying: true,
            currentTime: ytPlayer.getCurrentTime()
        });
    } else if (event.data === 2) {
        socket.emit('trailer-state-change', {
            roomCode: currentRoomCode,
            isPlaying: false,
            currentTime: ytPlayer.getCurrentTime()
        });
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
    if (e.key === 'Escape' && !trailerModal.classList.contains('hidden')) {
        closeTrailerModal();
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
// SIDE PANEL TABS
// ============================================
document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

// ============================================
// GROUP POLLS
// ============================================

pollHeaderBtn.addEventListener('click', () => {
    if (currentPollResults) {
        pollModal.classList.remove('hidden');
        return;
    }

    if (currentPoll && currentPoll.isActive) {
        renderActivePoll();
        pollModal.classList.remove('hidden');
        return;
    }

    if (!isHost) {
        alert('Only the host can start a poll. Wait for them to start one!');
        return;
    }

    if (currentPlaylist.length < 2) {
        alert('You need at least 2 movies in the playlist to start a poll.');
        return;
    }

    socket.emit('create-poll', { roomCode: currentRoomCode });
});

pollModalCloseBtn.addEventListener('click', () => {
    pollModal.classList.add('hidden');
    if (pollCountdownInterval) clearInterval(pollCountdownInterval);
});

pollDoneBtn.addEventListener('click', () => {
    socket.emit('dismiss-poll', { roomCode: currentRoomCode });
    pollModal.classList.add('hidden');
});

pollResetBtn.addEventListener('click', () => {
    socket.emit('reset-my-votes', { roomCode: currentRoomCode });
});

pollDeclareBtn.addEventListener('click', () => {
    socket.emit('close-poll', { roomCode: currentRoomCode });
});

socket.on('poll-updated', (poll) => {
    currentPoll = poll;
    currentPollResults = null;
    updatePollHeaderBtn(true);

    if (!pollModal.classList.contains('hidden')) {
        renderActivePoll();
    }
});

socket.on('poll-results', (results) => {
    currentPollResults = results;
    currentPoll = null;
    if (pollCountdownInterval) clearInterval(pollCountdownInterval);
    updatePollHeaderBtn(false);

    pollVotingView.classList.add('hidden');
    pollResultsView.classList.remove('hidden');
    renderPollResults(results);
    pollModal.classList.remove('hidden');
});

socket.on('poll-dismissed', () => {
    currentPoll = null;
    currentPollResults = null;
    pollModal.classList.add('hidden');
    if (pollCountdownInterval) clearInterval(pollCountdownInterval);
    updatePollHeaderBtn(false);
});

function updatePollHeaderBtn(active) {
    if (active) {
        pollHeaderBtn.style.background = 'var(--accent)';
        pollHeaderBtn.style.borderColor = 'var(--accent)';
    } else {
        pollHeaderBtn.style.background = '';
        pollHeaderBtn.style.borderColor = '';
    }
}

function renderActivePoll() {
    if (!currentPoll) return;

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

    // Simple winner card
    let winnerHTML = '';
    if (isTie) {
        winnerHTML = `
            <div style="font-size: 20px; margin-bottom: 4px;">🤝</div>
            <div style="color: #ffb74d; font-size: 12px; margin-bottom: 10px;">It's a tie! Breaking by rating…</div>
            <img src="${winner.poster || 'https://via.placeholder.com/100x150/333/888?text=?'}" class="winner-poster" alt="">
            <div class="winner-title">${winner.title}</div>
            <div class="winner-rating">⭐ ${winner.rating}</div>
            <button id="winner-trailer-btn" class="btn btn-primary" style="margin-top: 16px;">▶ Watch Trailer</button>
        `;
    } else {
        winnerHTML = `
            <div style="font-size: 20px; margin-bottom: 10px;">🏆 Winner</div>
            <img src="${winner.poster || 'https://via.placeholder.com/100x150/333/888?text=?'}" class="winner-poster" alt="">
            <div class="winner-title">${winner.title}</div>
            <div class="winner-rating">⭐ ${winner.rating}</div>
            <button id="winner-trailer-btn" class="btn btn-primary" style="margin-top: 16px;">▶ Watch Trailer</button>
        `;
    }
    pollWinnerDisplay.innerHTML = winnerHTML;

    // Wire up the trailer button
       const trailerBtn = document.getElementById('winner-trailer-btn');
    if (trailerBtn) {
        trailerBtn.addEventListener('click', () => {
            console.log('🎬 Watch Trailer clicked. movieId:', winner.id);
            pollModal.classList.add('hidden');
            socket.emit('play-trailer', { roomCode: currentRoomCode, movieId: winner.id });
        });
    }
}


document.getElementById('leave-btn').addEventListener('click', () => {
    window.location.reload();
});