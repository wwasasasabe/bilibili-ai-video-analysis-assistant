# Security Policy

## Secrets

Do not commit API keys, OSS credentials, Tencent credentials, cookies, access tokens, or signed URLs.

If a secret is accidentally committed:

1. Revoke or rotate the secret immediately.
2. Remove it from the repository history before publishing if the repository has not been shared yet.
3. If it has already been pushed, treat the secret as permanently exposed.

## Temporary Audio Handling

The extension is designed for user-initiated video analysis. Audio used for transcription should be treated as temporary data:

- Prefer in-memory transfer from the browser to the backend.
- Upload to user-owned OSS only as a short-lived temporary object.
- Delete temporary OSS objects after transcription completes or fails.
- Do not keep downloaded audio in the browser or repository.

## Reporting Issues

Please open a GitHub issue for security-related implementation problems that do not expose active secrets. For active secret exposure, rotate the secret first.
