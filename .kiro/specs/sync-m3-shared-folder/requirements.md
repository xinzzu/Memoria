# Requirements: Sync M3 — Shared Folder Sync

## Introduction
M2 delivered manual encrypted `.memsync` bundles. M3 lets two devices sync automatically through a user-chosen shared folder (Dropbox, iCloud Drive, Syncthing, network share) without any Memoria server.

## Requirements

### 1. Shared folder configuration
**User story:** As a user with two machines, I want to point Memoria at a shared folder so my memories sync without manual export/import.
- WHEN the user runs `memoria sync folder set <path>` THEN the system SHALL validate the path is writable and store it in settings.
- IF sync is not set up (no group key) THEN the system SHALL refuse and print the `sync setup` instruction.

### 2. Automatic export
- WHEN the outbox has pending ops AND 30 s have passed since the last export THEN the system SHALL write a bundle `<deviceId>-<hlc>.memsync` to the shared folder.
- The system SHALL write bundles atomically (temp file + rename) so peers never read partial files.

### 3. Automatic import
- WHEN a new `.memsync` from another device appears in the folder THEN the system SHALL apply it idempotently using the existing M2 apply path.
- The system SHALL record applied bundle IDs in an applied ledger and SHALL skip bundles already applied.
- IF a bundle fails decryption or AAD verification THEN the system SHALL log it, skip it, and continue.

### 4. Conflict visibility
- WHEN LWW resolves a conflict THEN the system SHALL record it in the conflict log.
- WHEN the user runs `memoria sync conflicts` THEN the system SHALL list recent conflicts (entity, winner device, timestamps).

### 5. Cleanup
- The system SHALL delete its own bundles older than 14 days once every known peer has applied them.
