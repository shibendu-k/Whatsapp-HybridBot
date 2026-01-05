# 🏗️ Architecture - WhatsApp Hybrid Bot v3.2

Technical architecture and design documentation.

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     WhatsApp Hybrid Bot v3.2                 │
│                    (Single Node.js Process)                  │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Account 1  │      │   Account 2  │      │   Account 3  │
│  (Baileys    │      │  (Baileys    │      │  (Baileys    │
│   Client)    │      │   Client)    │      │   Client)    │
└──────────────┘      └──────────────┘      └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
        ┌──────────────┐          ┌──────────────┐
        │  Movie Bot   │          │   Stealth    │
        │   Service    │          │   Logger     │
        │   (TMDB)     │          │   Service    │
        └──────────────┘          └──────────────┘
                │                           │
                └─────────────┬─────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Health Monitor  │
                    │  (Express :8080) │
                    └──────────────────┘
```

## Technology Stack

### Core Technologies

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Runtime | Node.js | 16+ | JavaScript execution |
| Package Manager | npm | 7+ | Dependency management |
| WhatsApp Client | @whiskeysockets/baileys | 6.6.0+ | WhatsApp WebSocket connection |
| Process Manager | PM2 | 5.3.0+ | Process management & monitoring |
| Web Server | Express | 4.18.2 | Health dashboard HTTP server |

### Key Dependencies

| Library | Purpose |
|---------|---------|
| axios | HTTP client for TMDB API |
| qrcode-terminal | QR code display in terminal |
| winston | Structured logging |
| chalk | Colored terminal output |
| commander | CLI argument parsing |
| inquirer | Interactive CLI prompts |
| fs-extra | Enhanced file system operations |
| mime-types | File type detection |
| dotenv | Environment variable management |

## Architecture Patterns

### 1. Multi-Account Architecture

**Pattern**: Single Process, Multiple Clients

Each account runs as an isolated Baileys client instance within the same process:

```javascript
AccountManager
  ├── Account 1 (BaileysClient)
  │   ├── Session Data (./sessions/account1/)
  │   ├── Message Queue
  │   ├── Event Handlers
  │   └── Module Instances
  ├── Account 2 (BaileysClient)
  │   └── ...
  └── Account 3 (BaileysClient)
      └── ...
```

**Benefits:**
- Lower memory overhead (~90MB per account vs ~400MB with Puppeteer)
- Shared service instances (TMDB, Command Router)
- Single PM2 process to manage
- Easier debugging and logging

### 2. Event-Driven Message Processing

**Pattern**: Event Emitters + Queue-Based Processing

```javascript
WhatsApp Server
      │
      ▼ (WebSocket)
Baileys Client
      │
      ▼ (Event: messages.upsert)
Message Queue
      │
      ▼ (Sequential Processing)
Message Handler
      │
      ├─▶ Stealth Logger
      ├─▶ Movie Bot
      └─▶ Other Modules
```

**Key Events:**
- `messages.upsert`: New messages arrive
- `connection.update`: Connection state changes
- `messages.update`: Message deletions/edits
- `creds.update`: Authentication credentials update

### 3. Service-Oriented Architecture

**Pattern**: Shared Services, Independent Modules

```javascript
┌─────────────────────────────────────┐
│        Shared Services Layer        │
├─────────────────────────────────────┤
│ • TMDB Service (with caching)       │
│ • Command Router (rate limiting)    │
│ • Logger (winston + console)        │
│ • Validators (config validation)    │
│ • Helpers (utilities)               │
└─────────────────────────────────────┘
           │           │
           ▼           ▼
    ┌──────────┐ ┌──────────┐
    │ Movie    │ │ Stealth  │
    │ Bot      │ │ Logger   │
    └──────────┘ └──────────┘
```

**Benefits:**
- Single TMDB cache for all accounts
- Centralized rate limiting
- Consistent logging across modules
- Easy to add new modules

## Core Components

### 1. BaileysClient (`src/baileys-client.js`)

**Responsibilities:**
- Manage WhatsApp WebSocket connection
- Handle authentication (QR code generation)
- Session persistence
- Auto-reconnection logic
- Message queue management
- Media download

**Key Methods:**
```javascript
initialize()              // Setup and connect
sendMessage(jid, text)    // Send text message
sendMedia(jid, buffer)    // Send media
downloadMediaMessage()    // Download media from message
getContactName(jid)       // Get contact name
getGroupMetadata(jid)     // Get group info
disconnect()              // Clean disconnect
```

**State Management:**
- Connected/disconnected state
- Message processing queue
- QR code display state
- Auto-reconnection backoff

### 2. AccountManager (`src/account-manager.js`)

**Responsibilities:**
- Orchestrate multiple Baileys clients
- Load configuration
- Route messages to correct handlers
- Track global statistics
- Manage session registry

**Key Methods:**
```javascript
loadAccounts()                    // Load from config
addAccount(config)                // Add new account
handleMessage(accountId, msg)     // Route message
handleMovieBot(accountId, msg)    // Movie bot logic
handleMessageDelete(accountId)    // Deletion handling
getStats()                        // Global stats
```

**Data Structures:**
```javascript
accounts: Map<accountId, {
  client: BaileysClient,
  config: AccountConfig,
  stealthLogger: StealthLoggerService,
  modules: ModulesConfig
}>

activeSessions: Map<jid, {
  jid: string,
  name: string,
  isGroup: boolean,
  firstSeen: timestamp,
  lastSeen: timestamp
}>
```

### 3. StealthLoggerService (`src/services/stealth-logger.js`)

**Responsibilities:**
- Cache text messages
- Capture view-once media
- Handle deleted messages
- Process ephemeral messages
- Forward to vault account
- Clean up old files

**Key Methods:**
```javascript
cacheTextMessage(msg)              // Cache text
captureViewOnce(msg, client)       // Capture view-once
handleDeletedMessage(deleteInfo)   // Recover deleted
handleEphemeralMessage(msg)        // Handle ephemeral
sendTextToVault(data)              // Forward text
sendMediaToVault(data)             // Forward media
cleanup()                          // Clean old files
```

**Data Structures:**
```javascript
textCache: Map<messageId, {
  text: string,
  sender: string,
  senderId: string,
  timestamp: number,
  groupName: string,
  cachedAt: number
}>

mediaCache: Map<messageId, {
  filepath: string,
  type: 'image' | 'video' | 'audio',
  sender: string,
  timestamp: number,
  caption: string
}>
```

### 4. TMDBService (`src/services/tmdb.js`)

**Responsibilities:**
- Search movies/series
- Get detailed information
- Download posters
- Cache results
- Handle retries with backoff

**Key Methods:**
```javascript
searchMovie(query)           // Search movies
searchSeries(query)          // Search series
getMovieDetails(id)          // Get movie details
getSeriesDetails(id)         // Get series details
downloadPoster(url)          // Download poster image
testConnection()             // Test API
```

**Caching Strategy:**
- LRU cache (1 hour expiry)
- Max 1000 entries
- Automatic cleanup when full

### 5. CommandRouter (`src/services/command-router.js`)

**Responsibilities:**
- Parse commands from messages
- Manage user search states
- Implement rate limiting
- Format responses

**Key Methods:**
```javascript
parseCommand(text, prefix)           // Parse command
checkRateLimit(userId, config)       // Check rate limit
setUserSearch(userId, data)          // Store search state
getUserSearch(userId)                // Get search state
formatSearchResults(results)         // Format results
formatDetails(details)               // Format details
```

**Rate Limiting Algorithm:**
```javascript
// Sliding window
userLimit = {
  requests: [timestamp1, timestamp2, ...],
  resetTime: timestamp
}

// Filter old requests
requests = requests.filter(t => now - t < windowMs)

// Check limit
if (requests.length >= maxRequests) {
  return { allowed: false, remainingTime }
}

// Add new request
requests.push(now)
```

### 6. HealthMonitor (`src/services/health-monitor.js`)

**Responsibilities:**
- HTTP server on port 8080
- Real-time statistics dashboard
- Account status monitoring
- HTML interface generation

**Endpoints:**
```javascript
GET /health          // Main dashboard
GET /accounts        // Account details
GET /stats           // JSON statistics
```

**Metrics Tracked:**
- System uptime
- Memory usage (heap, RSS)
- Message counts
- Account status
- Cache sizes
- Error counts

## Data Flow

### Message Processing Flow

```
1. WhatsApp Server sends message
         ↓
2. Baileys emits 'messages.upsert' event
         ↓
3. BaileysClient adds to message queue
         ↓
4. Queue processor (with random delay)
         ↓
5. AccountManager.handleMessage()
         ↓
6. Extract sender info, group name
         ↓
7. Register session
         ↓
8. ┌─ Stealth Logger Processing ─┐
   │ • Cache text message         │
   │ • Check for view-once        │
   │ • Check for ephemeral        │
   └──────────────────────────────┘
         ↓
9. ┌─ Movie Bot Processing ──────┐
   │ • Check allowed groups       │
   │ • Parse command              │
   │ • Check rate limit           │
   │ • Execute search or selection│
   │ • Send response              │
   └──────────────────────────────┘
```

### View-Once Capture Flow

```
1. View-once message arrives
         ↓
2. Detect viewOnceMessage in structure
         ↓
3. Extract nested content (image/video/audio)
         ↓
4. Download media using downloadMediaMessage()
         ↓
5. Save to temp_storage/ with unique ID
         ↓
6. Cache metadata (sender, timestamp, caption)
         ↓
7. Send to vault with formatted message
         ↓
8. Schedule cleanup after 68 hours
```

### Deleted Message Recovery Flow

```
1. Message arrives and is cached
         ↓
2. User deletes message
         ↓
3. Baileys emits 'messages.update' event
         ↓
4. Check if message ID in cache
         ↓
5. If found, retrieve from cache
         ↓
6. Format vault message with metadata
         ↓
7. Send to vault account
         ↓
8. Keep in cache until expiry
```

## Storage Architecture

### Directory Structure

```
whatsapp-hybrid-bot/
├── sessions/              # Session data (one folder per account)
│   ├── account1/
│   │   ├── creds.json     # Authentication credentials
│   │   └── app-state-*.json  # App state
│   ├── account2/
│   └── account3/
├── temp_storage/          # Temporary media files
│   ├── view-once-*.jpg
│   ├── view-once-*.mp4
│   └── status-*.jpg
├── logs/                  # Application logs
│   ├── error.log
│   ├── combined.log
│   ├── pm2-error.log
│   └── pm2-out.log
└── config/                # Configuration files
    ├── accounts.json      # Account configuration
    └── default.json       # Global settings
```

### Session Storage

**Format**: Baileys native multi-file auth state

Each account has isolated session storage:
```
sessions/account1/
├── creds.json                    # Encrypted credentials
├── app-state-sync-key-*.json     # Sync keys
└── app-state-sync-version-*.json # App state versions
```

**Persistence**: Automatically saved by Baileys on `creds.update` event

### Cache Management

**In-Memory Caches:**

| Cache | Type | Max Size | Expiry | Cleanup |
|-------|------|----------|--------|---------|
| Text Messages | Map | 5000 entries | 3 hours | On size limit |
| Media Metadata | Map | Unlimited | 68 hours | Periodic |
| TMDB Results | Map | 1000 entries | 1 hour | On size limit |
| User Searches | Map | Unlimited | 10 minutes | Periodic |
| Rate Limits | Map | Unlimited | 60 seconds | Periodic |

**File System Cache:**
- View-once media: 68 hours
- Status captures: 24 hours
- Cleanup interval: 6 hours

## Performance Characteristics

### Memory Usage

**Per Account:**
- Base Baileys client: ~70-90MB
- Session data: ~5-10MB
- Message queue: ~1-5MB
- Module instances: ~5-10MB
- **Total**: ~90-115MB per account

**Shared Services:**
- Node.js runtime: ~30MB
- TMDB cache: ~10-20MB
- Command router: ~5MB
- Logger: ~5MB
- **Total**: ~50MB

**Example Configurations:**
- 1 account: ~140MB
- 3 accounts: ~310MB
- 5 accounts: ~510MB
- 8 accounts: ~770MB
- 10 accounts: ~950MB

### CPU Usage

**Idle**: <5%
**Processing message**: <30%
**TMDB search**: <20%
**Media download**: <15%

### Network

**Bandwidth (per hour):**
- Text messages: ~100KB
- TMDB API: ~500KB
- Media downloads: Variable (up to 150MB per file)
- Total: ~1-2MB/hour (text-heavy), 50-100MB/hour (media-heavy)

**Connections:**
- 1 WebSocket per account (to WhatsApp)
- HTTP connections to TMDB (pooled)
- Inbound HTTP on port 8080 (health dashboard)

### Latency

**Message Processing:**
- Queue to handler: <100ms
- Stealth logging: <200ms
- Movie bot: 1-3 seconds (TMDB API)
- Total user response: 3-7 seconds (includes anti-ban delay)

## Security Architecture

### Authentication

**WhatsApp:**
- QR code authentication (interactive)
- Session persistence (encrypted)
- No password storage

**Health Dashboard:**
- No authentication by default
- Can add basic auth or bind to localhost

### Data Protection

**At Rest:**
- Session files: Encrypted by Baileys
- Config files: Plain text (600 permissions)
- Logs: Plain text (600 permissions)
- Temp storage: Unencrypted (should auto-delete)

**In Transit:**
- WhatsApp: End-to-end encrypted (via Baileys/WhatsApp protocol)
- TMDB API: HTTPS
- Health dashboard: HTTP (localhost) or HTTPS (with reverse proxy)

### Anti-Ban Measures

1. **Random Delays**: 3-7 seconds between actions
2. **Rate Limiting**: Max 10 searches per 60 seconds
3. **Human-like Behavior**: Variable response times
4. **Connection Pooling**: Reuse HTTP connections
5. **Backoff Retry**: Exponential backoff on errors

## Scalability

### Vertical Scaling (Single Server)

**Limits:**
- Max ~10 accounts on 1GB RAM
- Max ~20 accounts on 2GB RAM
- CPU rarely bottleneck

**To increase capacity:**
1. Add more RAM
2. Reduce cache sizes
3. Disable unused features

### Horizontal Scaling (Multiple Servers)

**Current**: Not directly supported

**Possible Future Implementation:**
- Run multiple instances on different servers
- Each instance handles subset of accounts
- Shared Redis for cache
- Load balancer for health dashboard

## Monitoring & Observability

### Logging

**Levels:**
- ERROR: Critical failures
- WARN: Recoverable issues
- INFO: General information
- DEBUG: Detailed debugging

**Destinations:**
- Console: All levels (colored)
- File: All levels (JSON)
- PM2: Stdout/stderr

### Metrics

**Tracked:**
- Messages processed
- Movies searched
- Deleted recovered
- View-once captured
- Errors
- Active accounts
- Active sessions
- Cache sizes

**Accessible via:**
- Health dashboard (http://localhost:8080/health)
- Stats endpoint (http://localhost:8080/stats)
- CLI command (`npm run stats`)

### Health Checks

**Endpoints:**
- `/health`: HTML dashboard
- `/accounts`: Account status
- `/stats`: JSON metrics

**PM2 Integration:**
- Process monitoring
- Auto-restart on crash
- Memory monitoring
- CPU monitoring

## Future Architecture Improvements

### Planned Enhancements

1. **Database Integration**
   - PostgreSQL for message history
   - Better search and retrieval
   - Long-term storage

2. **Redis Cache**
   - Shared cache across instances
   - Better performance
   - Persistence

3. **Message Queue**
   - RabbitMQ or Redis Queue
   - Better message handling
   - Retry logic

4. **Microservices**
   - Separate movie bot service
   - Separate stealth logger service
   - Independent scaling

5. **GraphQL API**
   - Better dashboard integration
   - Real-time updates via subscriptions
   - Flexible queries

6. **Docker Support**
   - Containerization
   - Easier deployment
   - Better isolation

7. **Kubernetes**
   - Orchestration
   - Auto-scaling
   - High availability

---

**This architecture is optimized for:**
- Memory efficiency
- Easy deployment
- Single-server operation
- Educational/personal use

**Not optimized for:**
- Large scale (100+ accounts)
- Distributed systems
- Enterprise requirements
- High availability