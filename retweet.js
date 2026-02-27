#!/usr/bin/env node
// ^ Tells the OS to run this file with Node.js when executed directly (e.g. ./retweet.js)

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
// ^ Import the TwitterApi class from the twitter-api-v2 package (installed via npm)

import { readFileSync, existsSync } from "fs";
// ^ Import built-in Node.js file system functions:
//   readFileSync  → read a file's contents as text
//   existsSync    → check if a file exists

import { resolve } from "path";
// ^ Import 'resolve' from Node.js path module — builds an absolute file path

// ── .env Loader ──────────────────────────────────────────────────────────────
// Reads a .env file and loads its key=value pairs into process.env
// This way you don't have to export variables in your shell manually
function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  // ^ Build the full path to the .env file in the current working directory

  if (!existsSync(envPath)) return;
  // ^ If no .env file exists, stop here — nothing to load

  const lines = readFileSync(envPath, "utf-8").split("\n");
  // ^ Read the entire .env file as a string, then split it into an array of lines

  for (const line of lines) {
    // ^ Loop over each line in the file

    const trimmed = line.trim();
    // ^ Remove leading and trailing whitespace from the line

    if (!trimmed || trimmed.startsWith("#")) continue;
    // ^ Skip empty lines and comment lines (lines that start with #)

    const eqIdx = trimmed.indexOf("=");
    // ^ Find the position of the first '=' character (separates key from value)

    if (eqIdx === -1) continue;
    // ^ If there's no '=' on this line, it's not a valid key=value pair — skip it

    const key = trimmed.slice(0, eqIdx).trim();
    // ^ Extract the part before '=' as the variable name, and trim extra spaces

    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    // ^ Extract the part after '=' as the value, trim spaces, and strip any surrounding quotes

    if (!(key in process.env)) process.env[key] = value;
    // ^ Only set the variable if it isn't already set in the environment
    //   (shell exports take priority over the .env file)
  }
}

loadEnv();
// ^ Call the function above to load the .env file before anything else runs

// ── Credential Validation ────────────────────────────────────────────────────
const {
  TWITTER_API_KEY,            // Your Twitter app's API Key (Consumer Key)
  TWITTER_API_SECRET,         // Your Twitter app's API Secret (Consumer Secret)
  TWITTER_ACCESS_TOKEN,       // Your personal Access Token (for your account)
  TWITTER_ACCESS_TOKEN_SECRET,// Your personal Access Token Secret
} = process.env;
// ^ Destructure the 4 required Twitter credentials out of process.env

const missing = [
  ["TWITTER_API_KEY",             TWITTER_API_KEY],
  ["TWITTER_API_SECRET",          TWITTER_API_SECRET],
  ["TWITTER_ACCESS_TOKEN",        TWITTER_ACCESS_TOKEN],
  ["TWITTER_ACCESS_TOKEN_SECRET", TWITTER_ACCESS_TOKEN_SECRET],
]
// ^ Build an array of [name, value] pairs for each required credential

  .filter(([, v]) => !v)
  // ^ Keep only the pairs where the value is missing (undefined, null, or empty string)

  .map(([k]) => k);
  // ^ From those, extract just the variable names (we only need names for the error message)

if (missing.length) {
  // ^ If any credentials are missing...

  console.error("Missing required environment variables:");
  // ^ Print a header error message

  missing.forEach((k) => console.error(`  - ${k}`));
  // ^ Print each missing variable name on its own line

  console.error("\nCreate a .env file with these values or export them in your shell.");
  // ^ Give the user a hint on how to fix the problem

  process.exit(1);
  // ^ Exit the script with error code 1 (signals failure to the shell)
}

// ── Tweet ID Validation ───────────────────────────────────────────────────────
const tweetId = process.argv[2];
// ^ Read the first command-line argument the user passed
//   process.argv[0] = 'node', process.argv[1] = 'retweet.js', process.argv[2] = the tweet ID

if (!tweetId) {
  // ^ If the user didn't provide a tweet ID at all...

  console.error("Usage: node retweet.js <tweet_id>");
  // ^ Show how to use the script correctly

  console.error("Example: node retweet.js 1234567890123456789");
  // ^ Show a concrete example

  process.exit(1);
  // ^ Exit with error code 1
}

if (!/^\d+$/.test(tweetId)) {
  // ^ Use a regular expression to check that the tweet ID contains only digits (0-9)
  //   ^\d+$ means: start-of-string, one or more digits, end-of-string

  console.error(`Invalid tweet ID: "${tweetId}" — must be a numeric string.`);
  // ^ Tell the user their input is not a valid tweet ID

  process.exit(1);
  // ^ Exit with error code 1
}

// ── Retweet Function ──────────────────────────────────────────────────────────
async function retweet(tweetId) {
  // ^ Define an async function (async lets us use 'await' for API calls inside it)

  const client = new TwitterApi({
    appKey:       TWITTER_API_KEY,            // Twitter app's API Key
    appSecret:    TWITTER_API_SECRET,         // Twitter app's API Secret
    accessToken:  TWITTER_ACCESS_TOKEN,       // Your account's Access Token
    accessSecret: TWITTER_ACCESS_TOKEN_SECRET,// Your account's Access Token Secret
  });
  // ^ Create an authenticated Twitter API client using your OAuth 1.0a credentials

  const me = await client.v2.me();
  // ^ Call the Twitter API to get info about the authenticated user (you)
  //   'await' pauses here until the API responds

  const myUserId = me.data.id;
  // ^ Extract your numeric user ID from the response (required by the retweet endpoint)

  console.log(`Logged in as @${me.data.username} (id: ${myUserId})`);
  // ^ Confirm which account is being used

  console.log(`Retweeting tweet ${tweetId} ...`);
  // ^ Let the user know the retweet is about to happen

  const result = await client.v2.retweet(myUserId, tweetId);
  // ^ Call the Twitter API v2 retweet endpoint: POST /2/users/:id/retweets
  //   Passes your user ID and the target tweet ID
  //   'await' pauses until Twitter responds

  if (result.data.retweeted) {
    // ^ Check the API response — 'retweeted: true' means the retweet just happened

    console.log("Retweet successful!");
    // ^ Inform the user it worked

  } else {
    console.log("Tweet was already retweeted (no change).");
    // ^ 'retweeted: false' means you had already retweeted this tweet before
  }
}

retweet(tweetId).catch((err) => {
  // ^ Call the retweet function with the tweet ID
  //   .catch() handles any errors thrown inside the async function

  const msg = err?.data?.detail ?? err?.message ?? String(err);
  // ^ Try to get a readable error message:
  //   err?.data?.detail → Twitter API error message (e.g. "Tweet not found")
  //   err?.message      → Generic JavaScript error message
  //   String(err)       → Fallback: convert whatever the error is to a string

  console.error("Retweet failed:", msg);
  // ^ Print the error message

  process.exit(1);
  // ^ Exit with error code 1 to signal failure
});
