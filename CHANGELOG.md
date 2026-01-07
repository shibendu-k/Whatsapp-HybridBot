# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.1] - 2026-01-07

### Fixed
- **Multi-Account Stability Issues**: Improved error handling for session conflicts when running multiple WhatsApp accounts simultaneously
  - Added automatic skipping of messages that failed to decrypt (common in multi-account setups)
  - Added validation for media encryption keys before download attempts to prevent "Cannot derive from empty media key" errors
  - Downgraded transient error logging (Bad MAC, decrypt failures, session conflicts) to debug level
  - Added retry logic for decryption failures with configurable delay and retry count
  - Media downloads now gracefully handle missing or empty encryption keys
  - **Added console output filtering to suppress verbose libsignal error messages** - these internal protocol errors are now completely hidden from logs while the bot continues functioning normally

### Changed
- Session errors like "Closing open session in favor of incoming prekey bundle" and "Bad MAC Error" are now completely suppressed from console output
- Bot continues functioning normally despite internal Signal protocol session conflicts
- Console filtering intercepts and suppresses libsignal error stack traces automatically

### Technical Details
- `index.js`: Added console.error and console.log interception to filter libsignal error messages
- `baileys-client.js`: Added message validation to skip stub/empty messages, added retry configuration for decryption
- `stealth-logger.js`: Added `isMediaDownloadable()` method to validate media encryption keys before download attempts
- Applied validation to regular media messages, view-once messages, and ephemeral messages

## [3.2.0] - 2025-XX-XX

### Added
- Multi-account support with hot-reload capability
- Health monitoring dashboard
- Movie and TV series search via TMDB API
- Stealth logging features (view-once, deleted messages, ephemeral messages)
- PM2 process management support

### Features
- View-once media capture
- Deleted message recovery
- Ephemeral message handling
- Status monitoring
- Group exclusions
- Vault system for captured content
