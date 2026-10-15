# WatchParty

A real-time collaborative video-watching platform built on Node.js and Socket.IO. WatchParty enables synchronized playback of video content across multiple clients, with integrated social features for shared movie discovery and group decision-making.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io&logoColor=white)
![License](https://img.shields.io/badge/license-Educational-lightgrey)

---

## Table of Contents

- [Overview](#overview)
- [Core Capabilities](#core-capabilities)
- [System Architecture](#system-architecture)
- [User Workflow](#user-workflow)
- [Requirements Traceability](#requirements-traceability)
- [Constraint Analysis](#constraint-analysis)
- [Installation & Deployment](#installation--deployment)
- [Latency Measurements](#latency-measurements)
- [Test Conditions](#test-conditions)
- [Failure Handling](#failure-handling)
- [Project Structure](#project-structure)
- [Technical Decisions](#technical-decisions)
- [Roadmap](#roadmap)

---

## Overview

WatchParty is a browser-based application that synchronizes video playback across multiple devices in real time. Users can create a room, share an invite link, and watch content together with frame-accurate playback control, live chat, collaborative movie selection via polling, and automatic drift correction.

The system is designed to operate with zero persistent storage — all room state is held in-memory on the server, which makes deployment lightweight and infrastructure-free for small-scale use.

**Primary use case:** A small group (2–10 participants) coordinating a shared viewing session from different locations.

---

## Core Capabilities

### Playback
- Synchronized play, pause, and seek across all room participants
- Automatic drift detection with two-tier correction (smooth and hard-seek)
- Playlist queue with automatic advance on video completion
- Late-joiner synchronization — new participants are positioned at the correct timestamp
- Custom video controls (progress bar, seek ±10s, volume, fullscreen) independent of native browser controls

### Collaboration
- Real-time chat with 50-message history retained for late joiners
- Floating emoji reactions broadcast to all participants
- Group polls with per-user vote limits, a 1-minute timer, and rating-based tie-breaking
- Shared wish list for movie nominations
- Shared playlist of playable videos (host-managed)
- Automatic host transfer on disconnect

### Discovery
- TMDB-powered search with category (Trending / Popular / Top Rated / Now Playing) and genre filtering
- Fuzzy search fallback (Fuse.js) for typo-tolerant queries
- Embedded YouTube trailer playback, synchronized across the room

### Reliability
- Session persistence — users are automatically rejoined after page refresh or network drop
- Retry logic with exponential backoff on all upstream TMDB requests
- Multi-tier caching (search, browse, trailers) to reduce external API load

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                          │
│                                                                   │
│   ┌────────────┐   ┌──────────────┐   ┌───────────────────┐      │
│   │ Video      │   │ Chat / Polls │   │ Movie Discovery   │      │
│   │ Player     │   │ / Reactions  │   │ (Search, Browse)  │      │
│   └────────────┘   └──────────────┘   └───────────────────┘      │
│          │                 │                     │                │
│          └─────────────────┴─────────────────────┘                │
│                            │                                      │
│                    Socket.IO Client                               │
└────────────────────────────┼──────────────────────────────────────┘
                             │
                   WebSocket │ HTTP
                             │
┌────────────────────────────▼──────────────────────────────────────┐
│                    SERVER (Node.js + Express)                     │
│                                                                   │
│   ┌────────────────────────────────────────────────────────────┐ │
│   │            Socket.IO Event Dispatcher                      │ │
│   │   Playback · Chat · Polls · Playlist · Wishlist · Emoji    │ │
│   └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│   ┌────────────────────────────────────────────────────────────┐ │
│   │               In-Memory Room Store                         │ │
│   │   rooms[code] = { host, users[], videoState,               │ │
│   │                   messages[], wishlist[], playlist[],      │ │
│   │                   poll, trailerState }                     │ │
│   └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│   ┌────────────────────────────────────────────────────────────┐ │
│   │            TMDB Proxy Layer                                │ │
│   │   • Search cache      (5 min TTL)                          │ │
│   │   • Browse cache      (5 min TTL)                          │ │
│   │   • Trailer cache     (30 min TTL)                         │ │
│   │   • Retry with backoff (3 attempts, ECONNRESET handling)   │ │
│   └────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬──────────────────────────────────────┘
                             │ HTTPS
                             ▼
                    ┌─────────────────┐
                    │   TMDB API      │
                    │ (Movie metadata)│
                    └─────────────────┘
```

### Technology Stack

| Layer            | Technology              | Role                                     |
|------------------|-------------------------|------------------------------------------|
| Frontend         | HTML5, CSS3, Vanilla JS | UI, video player, client-side search     |
| Real-time        | Socket.IO 4.x           | Bidirectional WebSocket messaging        |
| Server           | Node.js 18+, Express    | HTTP host, static assets, event routing  |
| Data             | In-memory JavaScript    | Room and user state (no database)        |
| External API     | TMDB v3                 | Movie metadata and YouTube trailer IDs   |
| Search           | Fuse.js                 | Client-side fuzzy matching               |
| Media            | HTML5 `<video>`, YouTube IFrame API | MP4 and YouTube playback     |

---

## User Workflow

### Phase 1 — Entry

The landing screen presents two paths: create a new room or join an existing one.

```
┌──────────────────────────────────────┐
│          WatchParty                  │
│                                      │
│   What's your name?                  │
│   ┌────────────────────────────────┐ │
│   │                                │ │
│   └────────────────────────────────┘ │
│                                      │
│   [ Create Room ]   [ Enter Code ]   │
└──────────────────────────────────────┘
```

- **Create Room** — server generates a 6-character alphanumeric room code
- **Enter Code** — user provides an existing room code
- **Invite link** (`?room=ABC123`) — the code is pre-filled and only "Join" is displayed

### Phase 2 — Room Session

The primary interface is a two-column layout: video player on the left, tabbed side panel on the right.

| Side Panel Tab | Purpose                                              |
|----------------|------------------------------------------------------|
| Chat           | Send messages; react with emoji                      |
| Movies         | Search and browse TMDB; add to wish list             |
| Polls          | Start a poll (host); vote and view results (everyone)|
| Playlist       | Manage playable videos with URLs (host-managed)      |
| Wish List      | Movie nominations for the next poll                  |

### Phase 3 — Collaborative Selection Flow

```
   ┌─────────────┐
   │  Room Open  │
   └──────┬──────┘
          │
          ▼
   ┌──────────────────┐
   │ Users add movies │
   │  to Wish List    │
   └──────┬───────────┘
          │
          ▼
   ┌──────────────────┐
   │  Host starts a   │
   │   Poll (1 min)   │
   └──────┬───────────┘
          │
          ▼
   ┌──────────────────┐
   │  Each user casts │
   │    2 votes       │
   └──────┬───────────┘
          │
          ▼
   ┌──────────────────┐
   │  Poll closes →   │
   │  Winner declared │
   │ (ties broken by  │
   │  TMDB rating)    │
   └──────┬───────────┘
          │
          ▼
   ┌──────────────────┐
   │ Host promotes to │
   │  Playlist with   │
   │   video URL      │
   └──────┬───────────┘
          │
          ▼
   ┌──────────────────┐
   │   Synchronized   │
   │     Playback     │
   └──────┬───────────┘
          │
          ▼
   ┌──────────────────┐
   │  Auto-play next  │
   │  when video ends │
   └──────────────────┘
```

---

## Requirements Traceability

The following table maps each functional requirement to its implementation site.

| ID  | Requirement                                         | Implementation                                          |
|-----|-----------------------------------------------------|---------------------------------------------------------|
| F1  | Create and join rooms via invite link or room code  | `create-room` / `join-room` socket handlers; URL query parameter `?room=` |
| F2  | Synchronize play, pause, and seek across clients    | `play-video`, `pause-video`, `seek-video` events with echo suppression |
| F3  | Movie recommendations with categories, filters, and fuzzy search | TMDB `/trending`, `/popular`, `/discover` endpoints; Fuse.js fallback |
| F4  | Emoji reactions, live chat, shared playlists, group polls, host transfer | Dedicated Socket.IO event groups; host reassignment on `disconnect` |
| F5  | Automatic playback drift detection and correction   | Host heartbeat every 4s; two-tier correction (rate adjust / hard seek) |
| F6  | Reliable handling of late joins, reconnections, and concurrent actions | Session storage, auto-rejoin, `syncLock` guard, server cache |

---

## Constraint Analysis

The project specification defines four measurable constraints. Each is addressed below.

### Constraint 1 — At least 10 concurrent users per room

**Target:** 10 users must be able to participate in a single room simultaneously.

**Analysis:**
- Socket.IO on a single Node.js process handles tens of thousands of concurrent connections under typical message rates.
- Each room maintains a user array; broadcasts execute in O(n) time.
- Real-time event traffic per user is minimal: chat (~200 B/msg), sync (~100 B/event), reactions (~150 B/event).
- **Estimated aggregate throughput for 10 users actively using all features: < 50 KB/s.**

**Bottleneck:** The video stream itself does not traverse the server. Each browser pulls media directly from its source (Google CDN or a self-hosted URL). Server bandwidth is not consumed by video.

**Result:** ✅ Requirement comfortably met.

---

### Constraint 2 — Playback control propagation ≤ 250 ms

**Target:** When one user issues a play/pause/seek command, all other clients must reflect the state within 250 ms on a local network.

**Analysis:**
- Transport is WebSocket (not HTTP long-polling), so no handshake or connection setup overhead per message.
- Local network round-trip latency is typically 1–20 ms.
- No batching or throttling is applied on playback events.

**Measured:** 50–120 ms consistently over Wi-Fi; 5–15 ms on localhost.

**Result:** ✅ Requirement comfortably met.

---

### Constraint 3 — Playback drift ≤ 500 ms after correction

**Target:** After any corrective action, the maximum drift between any two clients must be ≤ 500 ms.

**Analysis:** A two-tier correction strategy is used.

| Drift Range      | Action                                        |
|------------------|-----------------------------------------------|
| < 100 ms         | No correction (imperceptible)                 |
| 100 ms – 1.5 s   | Adjust `playbackRate` (1.05x or 0.95x)        |
| > 1.5 s          | Hard seek to host timestamp                   |

The host broadcasts its playback position every 4 seconds. Non-host clients compare their own position and correct.

**Measured:** Post-correction drift stabilizes below 200 ms.

**Result:** ✅ Requirement met.

---

### Constraint 4 — Documentation of latency, test conditions, and failure handling

Addressed in the three sections below.

---

## Installation & Deployment

### Prerequisites

| Requirement | Version | Notes                                    |
|-------------|---------|------------------------------------------|
| Node.js     | ≥ 18    | Tested on v24.21                         |
| npm         | ≥ 9     | Bundled with Node.js                     |
| TMDB API Key| v3      | Free Developer tier — [register here](https://www.themoviedb.org/signup) |

### Local Setup

```bash
# Clone the repository
git clone https://github.com/yugdev17/WatchParty.git
cd WatchParty

# Install dependencies
npm install

# Configure the API key
# Open server.js and replace the placeholder:
#   const TMDB_API_KEY = 'YOUR_TMDB_API_KEY_HERE';
#   → const TMDB_API_KEY = 'your_actual_key';

# Start the server
node server.js
```

Expected output:
```
🔑 API Key loaded, length: 32
✅ Server is running! Open http://localhost:3000
```

### LAN Deployment (multi-device testing)

1. Identify the host machine's local IP:
   ```
   ipconfig        (Windows)
   ifconfig        (macOS / Linux)
   ```
   Locate the **IPv4 Address** (e.g., `192.168.1.15`).

2. On any device connected to the same network, navigate to:
   ```
   http://192.168.1.15:3000
   ```

3. If the device cannot connect, allow Node.js through the host firewall:
   - **Windows:** Firewall & Network Protection → Allow an app → enable **Node.js** for Private and Public.

### Test Media

Verified public MP4 URLs for playback testing:

```
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4
https://www.w3schools.com/html/mov_bbb.mp4
```

---

## Latency Measurements

Measurements collected with browser DevTools (Network → WebSocket frames) on a mixed LAN environment.

| Operation                                | Network       | Latency        |
|------------------------------------------|---------------|----------------|
| Play/Pause propagation                   | localhost     | 5 – 15 ms      |
| Play/Pause propagation                   | LAN Wi-Fi     | 50 – 120 ms    |
| Seek propagation                         | LAN Wi-Fi     | 80 – 180 ms    |
| Chat message delivery                    | LAN Wi-Fi     | 40 – 90 ms     |
| Emoji reaction broadcast                 | LAN Wi-Fi     | 50 – 100 ms    |
| Poll vote update                         | LAN Wi-Fi     | 60 – 130 ms    |
| TMDB search — first fetch (network)      | Internet      | 250 – 600 ms   |
| TMDB search — cached (server)            | LAN           | < 20 ms        |

**Methodology:** Two clients connected to the same room. A stopwatch-equivalent was used by capturing `performance.now()` at event emit and comparing against the remote client's receive time via a synchronized `Date.now()` header.

---

## Test Conditions

| Aspect              | Details                                                       |
|---------------------|---------------------------------------------------------------|
| Server environment  | Windows 10, Node.js v24.21, single process                    |
| Client browsers     | Chrome 120+, Edge 120+, Safari iOS 17, Android Chrome         |
| Network             | Local Wi-Fi (single router), localhost                        |
| TMDB API tier       | Developer (free, rate-limited to ~50 req/s)                   |
| Maximum room size   | 4 physical devices + up to 10 simulated browser tabs tested   |
| Session duration    | Up to 2 hours continuous                                      |

---

## Failure Handling

The system is designed to degrade gracefully under failure conditions.

| Scenario                                | System Response                                                                 |
|-----------------------------------------|---------------------------------------------------------------------------------|
| Client network drop (temporary)         | Socket.IO auto-reconnects; client reads saved session and rejoins the same room  |
| Page refresh                            | Saved session restored from `localStorage` → auto-rejoin                         |
| Host disconnects                        | Server promotes the next user; broadcasts `is-host: true` to them                |
| Host disconnects during an active poll  | Poll timer continues server-side; results still emitted at expiry                |
| Client falls behind playback            | Drift > 1.5s triggers a hard seek to the host timestamp                          |
| Host's video buffers                    | `waiting` event pauses heartbeats so a stalled timestamp is not broadcast        |
| TMDB request fails (ECONNRESET / timeout)| Retried up to 3 times with exponential backoff (300 ms, 600 ms)                  |
| Duplicate trailer requests              | Server deduplicates while a fetch is in flight                                   |
| Cached trailer request                  | Served instantly from memory cache                                               |
| Room deleted (all users left)           | Rejoining client receives "Room not found"; session is cleared                   |
| Simultaneous play/pause from two users  | `syncLock` suppresses echoed events for 500 ms, preventing feedback loops         |
| Late joiner during active playback      | Server sends current `videoState`; client seeks before playing                   |

---

## Project Structure

```
WatchParty/
├── public/
│   ├── index.html          Application structure (lobby, room, modals)
│   ├── styles.css          Gold-themed dark UI
│   ├── client.js           Client-side logic (all event handling)
│   └── Logo.png            Branding asset
├── server.js               Express + Socket.IO server
├── package.json            Dependencies and scripts
├── .gitignore              Excludes node_modules, .env
└── README.md               This document
```

---

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **In-memory room state** | Zero-infrastructure deployment. Acceptable trade-off for small-scale use; documented as a limitation. |
| **Socket.IO over raw WebSocket** | Provides automatic reconnection, room-based broadcasting, and event namespacing out of the box. |
| **Client-side fuzzy search** | Offloads from the server; Fuse.js runs on the browser with a locally-maintained movie pool. |
| **Two-tier drift correction** | Balances smoothness (rate adjustment) against correctness (hard seek) based on drift magnitude. |
| **Server-side API proxy** | Keeps the TMDB API key off the client and enables centralized caching + retry logic. |
| **Retry with backoff** | TMDB occasionally drops connections (`ECONNRESET`); automatic retries make this invisible to users. |
| **Vanilla JS (no framework)** | Keeps the bundle small and the codebase transparent for an educational project. |

---

## Roadmap

The following improvements are outside the current scope but represent logical extensions.

- **Persistent storage** — Replace in-memory state with Redis for multi-instance deployments.
- **Voice chat** — Integrate WebRTC for in-room audio channels.
- **Adaptive streaming** — Migrate from raw MP4 URLs to HLS/DASH with quality adaptation.
- **Subtitle sync** — Allow `.srt` uploads shared across all participants.
- **OAuth login** — Google/GitHub sign-in for cross-device identity.
- **Horizontal scaling** — Sticky sessions + Redis adapter for Socket.IO multi-node deployments.

---

## Acknowledgments

- [Socket.IO](https://socket.io/) — real-time transport layer
- [The Movie Database (TMDB)](https://developers.themoviedb.org/3) — movie metadata
- [Fuse.js](https://fusejs.io/) — client-side fuzzy search
- [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference) — trailer embedding

---

## License

This project is provided for educational and personal use. It is not licensed for commercial distribution.

Movie metadata is provided by TMDB and subject to their terms of service. YouTube trailers are embedded using the official IFrame API.