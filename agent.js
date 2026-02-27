#!/usr/bin/env node
// ^ Tells the OS to run this file with Node.js when executed directly (e.g. ./agent.js)

/**
 * Real-Time AI Agent Script
 *
 * An agentic loop using the Anthropic API with **streaming** enabled, so
 * the model's text appears token-by-token in real time.  The agent can
 * call tools, observe results, and iterate until it produces a final answer.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=<key> node agent.js
 *   ANTHROPIC_API_KEY=<key> node agent.js "Your task here"
 */

// Import the official Anthropic SDK so we can talk to the Claude API
import Anthropic from "@anthropic-ai/sdk";
// execSync lets us run shell commands (e.g. "ls", "cat file.txt") and wait for the result
import { execSync } from "child_process";
// fs gives us functions to read, write, and inspect files on disk
import * as fs from "fs";
// path gives us helpers for working with file/folder paths safely across OSes
import * as path from "path";
// readline lets us read input typed by the user in the terminal line by line
import * as readline from "readline";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
// This array tells the Claude model which tools it is allowed to call.
// Each object describes one tool: its name, what it does, and what inputs it needs.

const TOOLS = [
  {
    // Tool name the model will use when it wants to run a shell command
    name: "run_command",
    description:
      "Execute a shell command and return its stdout/stderr. Use for running scripts, listing files, etc.",
    input_schema: {
      type: "object",          // the input must be a JSON object
      properties: {
        command: {
          type: "string",      // the command must be a plain string, e.g. "ls -la"
          description: "The shell command to run.",
        },
      },
      required: ["command"],   // the model MUST supply this field
    },
  },
  {
    // Tool name the model will use when it wants to read a file
    name: "read_file",
    description: "Read the contents of a file on disk.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",      // path to the file, e.g. "./package.json"
          description: "Absolute or relative path to the file.",
        },
      },
      required: ["file_path"],
    },
  },
  {
    // Tool name the model will use when it wants to create or overwrite a file
    name: "write_file",
    description: "Write text content to a file, creating it if necessary.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",      // where to save the file
          description: "Path where the file should be written.",
        },
        content: {
          type: "string",      // the text that will be written into the file
          description: "Text content to write into the file.",
        },
      },
      required: ["file_path", "content"],  // both fields are mandatory
    },
  },
  {
    // Tool name the model will use when it wants to see what's inside a folder
    name: "list_directory",
    description: "List the files and sub-directories inside a directory.",
    input_schema: {
      type: "object",
      properties: {
        dir_path: {
          type: "string",      // folder to list; defaults to current directory if omitted
          description: "Path to the directory (defaults to '.' if omitted).",
        },
      },
      required: [],            // no required fields — dir_path is optional
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

/**
 * Dispatch a tool call and return a string result.
 * @param {string} name  - Tool name
 * @param {object} input - Tool input object
 * @returns {string}
 */
function executeTool(name, input) {
  // Match the tool name the model requested and run the correct logic
  switch (name) {

    case "run_command": {
      try {
        // Run the shell command synchronously and capture its output as a string
        const output = execSync(input.command, {
          encoding: "utf8",            // return output as text, not a Buffer
          timeout: 15_000,             // kill the command if it takes more than 15 seconds
          stdio: ["pipe", "pipe", "pipe"], // capture stdin, stdout, and stderr separately
        });
        // Return the output, or a placeholder if the command produced nothing
        return output || "(no output)";
      } catch (err) {
        // If the command failed, return the error message and any stderr text
        return `ERROR: ${err.message}\n${err.stderr ?? ""}`.trim();
      }
    }

    case "read_file": {
      try {
        // Read the entire file as a UTF-8 string and return it
        return fs.readFileSync(input.file_path, "utf8");
      } catch (err) {
        // Return an error string so the model knows what went wrong
        return `ERROR reading file: ${err.message}`;
      }
    }

    case "write_file": {
      try {
        // Extract the folder part of the file path (e.g. "src/utils" from "src/utils/helper.js")
        const dir = path.dirname(input.file_path);
        // Create all missing parent folders if they don't exist yet
        if (dir) fs.mkdirSync(dir, { recursive: true });
        // Write the content to disk, overwriting any existing file at that path
        fs.writeFileSync(input.file_path, input.content, "utf8");
        // Let the model know the write succeeded
        return `File written successfully: ${input.file_path}`;
      } catch (err) {
        return `ERROR writing file: ${err.message}`;
      }
    }

    case "list_directory": {
      // Use the provided path, or fall back to the current working directory
      const target = input.dir_path || ".";
      try {
        // Read the directory and get entry objects that tell us if each item is a file or folder
        const entries = fs.readdirSync(target, { withFileTypes: true });
        // Format each entry: append "/" to folder names so they're easy to tell apart
        const lines = entries.map((e) =>
          e.isDirectory() ? `${e.name}/` : e.name
        );
        // Join all names with newlines into one string, or say the folder is empty
        return lines.join("\n") || "(empty directory)";
      } catch (err) {
        return `ERROR listing directory: ${err.message}`;
      }
    }

    default:
      // The model asked for a tool that doesn't exist — report it clearly
      return `ERROR: Unknown tool "${name}"`;
  }
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

// ANSI escape codes for colouring terminal output.
// These are special character sequences the terminal interprets as colour commands.
const RESET  = "\x1b[0m";   // cancel any active colour/style
const DIM    = "\x1b[2m";   // dim/faded text (used for separators and labels)
const CYAN   = "\x1b[36m";  // cyan  — used for the [Agent] label
const YELLOW = "\x1b[33m";  // yellow — used for tool names and warnings
const GREEN  = "\x1b[32m";  // green  — used for success/status messages
const RED    = "\x1b[31m";  // red    — used for errors

/**
 * Stream a single turn of the agent using the Anthropic streaming API.
 * Prints text tokens to stdout in real time and returns the finalMessage.
 *
 * @param {Anthropic}  client   - Anthropic client
 * @param {object}     params   - Parameters for messages.stream()
 * @returns {Promise<Anthropic.Message>}
 */
async function streamTurn(client, params) {
  // Open a streaming connection to the Anthropic API.
  // Unlike messages.create(), this sends us tokens one at a time as they're generated.
  const stream = client.messages.stream(params);

  // Track whether we've already printed the "[Agent]" prefix for this turn
  let inText = false;

  // "text" fires every time a new chunk of text arrives from the model
  stream.on("text", (text) => {
    if (!inText) {
      // Print the coloured "[Agent]" label before the very first token of this turn
      process.stdout.write(`\n${CYAN}[Agent]${RESET} `);
      inText = true; // don't print the label again for subsequent tokens
    }
    // Print the token immediately — this is what makes the output feel "real time"
    process.stdout.write(text);
  });

  // "message" fires once when the model has finished its entire response
  stream.on("message", () => {
    if (inText) {
      process.stdout.write("\n"); // move to a new line after the last token
      inText = false;             // reset for the next turn
    }
  });

  // "error" fires if the stream connection breaks or the API returns an error
  stream.on("error", (err) => {
    process.stderr.write(`\n${RED}[Stream error] ${err.message}${RESET}\n`);
  });

  // Wait for the full response object which contains tool calls and the stop reason.
  // The streamed tokens are already printed above; we need this for the agent logic.
  return stream.finalMessage();
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

// The system prompt is sent with every request and shapes how the model behaves.
// It tells Claude what role it's playing and what rules to follow.
const SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools that let you
interact with the local filesystem and run shell commands.

Guidelines:
- Break down complex tasks into steps using the available tools.
- Always verify results after writing files or running commands.
- Be concise but thorough in your final answers.
- If a task cannot be completed safely, explain why instead.`;

/**
 * Run the real-time agent loop for a given user task.
 *
 * @param {Anthropic} client      - Anthropic client instance
 * @param {string}    task        - The user's task/question
 * @param {object}    [options]
 * @param {number}    [options.maxIterations=20] - Safety cap on tool rounds
 * @param {string}    [options.model]            - Claude model to use
 * @returns {Promise<string>} Final text response from the agent
 */
async function runAgent(client, task, options = {}) {
  // Pull out options, using sensible defaults if the caller didn't supply them
  const { maxIterations = 20, model = "claude-opus-4-6" } = options;

  // Start the conversation with the user's task as the first message
  const messages = [{ role: "user", content: task }];

  // Print a visible header so the user knows the agent has started
  console.log(`\n${DIM}${"─".repeat(60)}${RESET}`);
  console.log(`${GREEN}Agent started${RESET}  (model: ${model})`);
  console.log(`${YELLOW}Task:${RESET} ${task}`);
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);

  // Will hold the last text the model produced (returned at the end)
  let finalText = "";

  // Loop up to maxIterations times. Each iteration is one model call + tool execution round.
  for (let iteration = 1; iteration <= maxIterations; iteration++) {

    // Call the model and stream its response to the terminal in real time
    const response = await streamTurn(client, {
      model,
      max_tokens: 4096,   // maximum tokens the model can generate in this turn
      system: SYSTEM_PROMPT,
      tools: TOOLS,       // give the model the list of tools it can call
      messages,           // the full conversation history so far
    });

    // Pull out any plain-text blocks from the response (there may also be tool_use blocks)
    const textBlocks = response.content.filter((b) => b.type === "text");
    // Concatenate all text blocks into one string to use as the final answer
    finalText = textBlocks.map((b) => b.text).join("\n");

    // "end_turn" means the model is done and didn't request any tool calls
    if (response.stop_reason === "end_turn") {
      // Print a footer and return the final answer to the caller
      console.log(`\n${DIM}${"─".repeat(60)}${RESET}`);
      console.log(`${GREEN}Agent finished${RESET} after ${iteration} iteration(s).`);
      console.log(`${DIM}${"─".repeat(60)}${RESET}\n`);
      return finalText;
    }

    // Add the model's response (including any tool_use blocks) to the conversation history
    // so the model remembers what it said on the next iteration
    messages.push({ role: "assistant", content: response.content });

    // Find all the tool calls the model made in this response
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    // If there are no tool calls but the model hasn't ended its turn, something unexpected happened
    if (toolUseBlocks.length === 0) {
      console.warn(
        `${YELLOW}[Agent] Warning: no tool calls and stop_reason is not end_turn.${RESET}`
      );
      break; // exit the loop to avoid an infinite hang
    }

    // Execute each tool the model requested, one by one, and collect the results
    const toolResults = toolUseBlocks.map((toolUse) => {
      // Show the user which tool is being called and with what arguments
      process.stdout.write(
        `\n${DIM}[Tool]${RESET} ${YELLOW}${toolUse.name}${RESET}` +
          `(${JSON.stringify(toolUse.input)})\n`
      );

      // Actually run the tool (shell command, file read, etc.) and get the result string
      const result = executeTool(toolUse.name, toolUse.input);

      // Only show the first 300 characters of the result to keep the terminal readable
      const preview = result.length > 300 ? result.slice(0, 300) + "…" : result;
      process.stdout.write(`${DIM}[Result]${RESET} ${preview}\n`);

      // Return a "tool_result" message so the model can see what the tool returned
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,  // links this result back to the specific tool_use block
        content: result,           // the full result (not the preview — model needs everything)
      };
    });

    // Add the tool results to the conversation so the model can read them on the next iteration
    messages.push({ role: "user", content: toolResults });
  }

  // We hit the iteration limit without the model reaching "end_turn" — warn and exit
  console.warn(
    `\n${RED}[Agent] Reached max iterations (${maxIterations}).${RESET}`
  );
  return finalText || "Agent reached the maximum number of iterations without a final answer.";
}

// ---------------------------------------------------------------------------
// Interactive REPL
// ---------------------------------------------------------------------------

async function interactiveLoop(client) {
  // Create a readline interface that reads from the keyboard and writes to the terminal
  const rl = readline.createInterface({
    input: process.stdin,   // read from the keyboard
    output: process.stdout, // write prompt text to the terminal
    prompt: `\n${GREEN}You>${RESET} `, // the coloured prompt shown before each input line
  });

  // Welcome message shown when the REPL starts
  console.log(
    `\n${CYAN}Real-Time AI Agent${RESET} — type your task and press Enter (Ctrl+C to quit).\n`
  );
  // Display the first prompt so the user knows the program is waiting for input
  rl.prompt();

  // "line" fires every time the user presses Enter
  rl.on("line", async (line) => {
    const task = line.trim(); // remove leading/trailing whitespace

    // If the user just pressed Enter without typing anything, show the prompt again
    if (!task) {
      rl.prompt();
      return;
    }

    // Pause the input reader so keystrokes during the agent run don't appear on screen
    rl.pause();
    try {
      // Run the agent with the user's task and wait for it to finish
      await runAgent(client, task);
    } catch (err) {
      // Show any unexpected errors in red
      console.error(`\n${RED}Error: ${err.message}${RESET}`);
    } finally {
      // Always re-enable input and show the prompt again, even if an error occurred
      rl.resume();
      rl.prompt();
    }
  });

  // "close" fires when the user presses Ctrl+C or pipes end-of-input
  rl.on("close", () => {
    console.log(`\n${DIM}Goodbye!${RESET}`);
    process.exit(0); // cleanly exit the Node.js process
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  // Read the API key from the environment — never hard-code secrets in source code
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Tell the user exactly what's missing and stop execution
    console.error(
      `${RED}Error: ANTHROPIC_API_KEY environment variable is not set.${RESET}`
    );
    process.exit(1); // exit with code 1 to signal failure
  }

  // Create the Anthropic client using our API key — all API calls go through this object
  const client = new Anthropic({ apiKey });

  // process.argv contains the command-line arguments.
  // Index 0 is "node", index 1 is the script path, so we slice from index 2 onwards.
  const cliTask = process.argv.slice(2).join(" ").trim();

  if (cliTask) {
    // A task was passed directly on the command line, e.g.:
    //   node agent.js "list the files in this folder"
    // Run the agent once for that task and then exit.
    await runAgent(client, cliTask);
  } else {
    // No task on the command line — start the interactive REPL so the user can type tasks
    await interactiveLoop(client);
  }
}

// Start the program. If anything throws an uncaught error, print it and exit with failure.
main().catch((err) => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
