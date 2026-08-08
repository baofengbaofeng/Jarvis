# Provider field max lengths

## Limits

| Field | Max | Enforced |
|-------|-----|----------|
| name | 64 | DB CHECK + main IPC + UI `maxLength` / submit |
| type | enum only | existing CHECK + IPC |
| base_url | 2048 | DB CHECK + main IPC + UI |
| apiKey (secret) | 512 | main IPC + UI (not stored in DB; DB has `api_key_ref`) |
| api_key_ref | 128 | DB CHECK (generated ref, not user-typed) |

## Notes

SQLite previously had unbounded TEXT; v13 rebuilds `providers` with length CHECKs. UI must not rely on DB alone.
