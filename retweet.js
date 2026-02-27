#!/usr/bin/env node
/**
 * Terminal Retweet Script
 * Usage: node retweet.js <tweet_id>
 *
 * Required environment variables (set in .env or export them):
 *   TWITTER_API_KEY            - Twitter App API Key (Consumer Key)
 *   TWITTER_API_SECRET         - Twitter App API Secret (Consumer Secret)
 *   TWITTER_ACCESS_TOKEN       - Your account Access Token
 *   TWITTER_ACCESS_TOKEN_SECRET - Your account Access Token Secret
 *
 * How to get credentials:
 *   1. Go to https://developer.twitter.com/en/portal/dashboard
 *   2. Create a project/app with Read & Write permissions
 *   3. Generate Access Token & Secret under "Keys and Tokens"
 */

import { TwitterApi } from "twitter-api-v2";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load .env file manually (no dotenv dependency needed)
function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

// ── Validate credentials ────────────────────────────────────────────────────
const {
  TWITTER_API_KEY,
  TWITTER_API_SECRET,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_TOKEN_SECRET,
} = process.env;

const missing = [
  ["TWITTER_API_KEY", TWITTER_API_KEY],
  ["TWITTER_API_SECRET", TWITTER_API_SECRET],
  ["TWITTER_ACCESS_TOKEN", TWITTER_ACCESS_TOKEN],
  ["TWITTER_ACCESS_TOKEN_SECRET", TWITTER_ACCESS_TOKEN_SECRET],
]
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length) {
  console.error("Missing required environment variables:");
  missing.forEach((k) => console.error(`  - ${k}`));
  console.error("\nCreate a .env file with these values or export them in your shell.");
  process.exit(1);
}

// ── Validate tweet ID argument ──────────────────────────────────────────────
const tweetId = process.argv[2];

if (!tweetId) {
  console.error("Usage: node retweet.js <tweet_id>");
  console.error("Example: node retweet.js 1234567890123456789");
  process.exit(1);
}

if (!/^\d+$/.test(tweetId)) {
  console.error(`Invalid tweet ID: "${tweetId}" — must be a numeric string.`);
  process.exit(1);
}

// ── Retweet ─────────────────────────────────────────────────────────────────
async function retweet(tweetId) {
  const client = new TwitterApi({
    appKey: TWITTER_API_KEY,
    appSecret: TWITTER_API_SECRET,
    accessToken: TWITTER_ACCESS_TOKEN,
    accessSecret: TWITTER_ACCESS_TOKEN_SECRET,
  });

  // Fetch the authenticated user's ID
  const me = await client.v2.me();
  const myUserId = me.data.id;

  console.log(`Logged in as @${me.data.username} (id: ${myUserId})`);
  console.log(`Retweeting tweet ${tweetId} ...`);

  const result = await client.v2.retweet(myUserId, tweetId);

  if (result.data.retweeted) {
    console.log("Retweet successful!");
  } else {
    console.log("Tweet was already retweeted (no change).");
  }
}

retweet(tweetId).catch((err) => {
  const msg = err?.data?.detail ?? err?.message ?? String(err);
  console.error("Retweet failed:", msg);
  process.exit(1);
});
