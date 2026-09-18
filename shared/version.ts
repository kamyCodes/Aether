/**
 * Single version declaration for the frontend↔backend handshake.
 * The server reports this from /api/health; the web UI compares it against
 * its own bundled copy on boot and warns on drift (a cached tab talking to a
 * freshly updated backend — spec Section 4.6). Bump with each release.
 */
export const APP_VERSION = '0.1.2';
/** Schema of the settings.json file (see server/settings.ts). */
export const SETTINGS_SCHEMA = 1;
