# Implementation Plan

- [ ] 1. Migration v5: `sync_applied_bundle` table + tests
- [ ] 2. `folder.ts`: setSharedFolder with writable check and group-key guard
- [ ] 3. Atomic `exportPending()` writing `<deviceId>-<hlc>.memsync`
- [ ] 4. `scanAndApply()` with applied ledger, skip on decrypt/AAD failure
- [ ] 5. chokidar watcher + 30 s debounced export
- [ ] 6. CLI `sync folder set|status` and `sync conflicts`
- [ ] 7. Two-device integration test (create, delete/tombstone, LWW conflict, idempotent re-apply)
- [ ] 8. Cleanup of own bundles older than 14 days once all peers applied
