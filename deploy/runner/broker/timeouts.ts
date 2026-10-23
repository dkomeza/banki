// How long the Broker and its clients wait. A request to the Broker makes up
// to four calls upstream in a row: the bot's identity (the App, then a token,
// which may first look the installation up, then the bot user), or a Linear
// revoke (two tries, each checked with GraphQL). Each call has its own limit,
// and every wait around them is longer than all four together.

/** One call from the Broker to GitHub or Linear. */
export const UPSTREAM_TIMEOUT_MS = 30_000;
/** The most calls upstream one request to the Broker makes. */
export const MAX_UPSTREAM_CALLS = 4;
/** How long `runner stage` waits on the Broker: past its longest request. */
export const CLIENT_TIMEOUT_MS = 150_000;
/**
 * How long the Broker keeps a quiet connection open, in seconds: past what
 * its clients wait. Bun's default is 10 s, shorter than a single mint, and
 * 255 s is the most it takes.
 */
export const IDLE_TIMEOUT_S = 200;
