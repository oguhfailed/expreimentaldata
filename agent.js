#!/usr/bin/env node
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

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "run_command",
    description:
      "Execute a shell command and return its stdout/stderr. Use for running scripts, listing files, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to run.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file on disk.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute or relative path to the file.",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "write_file",
    description: "Write text content to a file, creating it if necessary.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path where the file should be written.",
        },
        content: {
          type: "string",
          description: "Text content to write into the file.",
        },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List the files and sub-directories inside a directory.",
    input_schema: {
      type: "object",
      properties: {
        dir_path: {
          type: "string",
          description: "Path to the directory (defaults to '.' if omitted).",
        },
      },
      required: [],
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
  switch (name) {
    case "run_command": {
      try {
        const output = execSync(input.command, {
          encoding: "utf8",
          timeout: 15_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return output || "(no output)";
      } catch (err) {
        return `ERROR: ${err.message}\n${err.stderr ?? ""}`.trim();
      }
    }

    case "read_file": {
      try {
        return fs.readFileSync(input.file_path, "utf8");
      } catch (err) {
        return `ERROR reading file: ${err.message}`;
      }
    }

    case "write_file": {
      try {
        const dir = path.dirname(input.file_path);
        if (dir) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(input.file_path, input.content, "utf8");
        return `File written successfully: ${input.file_path}`;
      } catch (err) {
        return `ERROR writing file: ${err.message}`;
      }
    }

    case "list_directory": {
      const target = input.dir_path || ".";
      try {
        const entries = fs.readdirSync(target, { withFileTypes: true });
        const lines = entries.map((e) =>
          e.isDirectory() ? `${e.name}/` : e.name
        );
        return lines.join("\n") || "(empty directory)";
      } catch (err) {
        return `ERROR listing directory: ${err.message}`;
      }
    }

    default:
      return `ERROR: Unknown tool "${name}"`;
  }
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

/**
 * Stream a single turn of the agent using the Anthropic streaming API.
 * Prints text tokens to stdout in real time and returns the finalMessage.
 *
 * @param {Anthropic}  client   - Anthropic client
 * @param {object}     params   - Parameters for messages.stream()
 * @returns {Promise<Anthropic.Message>}
 */
async function streamTurn(client, params) {
  const stream = client.messages.stream(params);

  let inText = false;

  // Listen to granular streaming events
  stream.on("text", (text) => {
    if (!inText) {
      process.stdout.write(`\n${CYAN}[Agent]${RESET} `);
      inText = true;
    }
    process.stdout.write(text);
  });

  stream.on("message", () => {
    if (inText) {
      process.stdout.write("\n");
      inText = false;
    }
  });

  stream.on("error", (err) => {
    process.stderr.write(`\n${RED}[Stream error] ${err.message}${RESET}\n`);
  });

  // Await the complete message (tool calls + stop reason are only in finalMessage)
  return stream.finalMessage();
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

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
  const { maxIterations = 20, model = "claude-opus-4-6" } = options;

  const messages = [{ role: "user", content: task }];

  console.log(`\n${DIM}${"─".repeat(60)}${RESET}`);
  console.log(`${GREEN}Agent started${RESET}  (model: ${model})`);
  console.log(`${YELLOW}Task:${RESET} ${task}`);
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);

  let finalText = "";

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const response = await streamTurn(client, {
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    // Extract text from this response
    const textBlocks = response.content.filter((b) => b.type === "text");
    finalText = textBlocks.map((b) => b.text).join("\n");

    // Done — no more tool calls
    if (response.stop_reason === "end_turn") {
      console.log(`\n${DIM}${"─".repeat(60)}${RESET}`);
      console.log(`${GREEN}Agent finished${RESET} after ${iteration} iteration(s).`);
      console.log(`${DIM}${"─".repeat(60)}${RESET}\n`);
      return finalText;
    }

    // Push the assistant turn to history
    messages.push({ role: "assistant", content: response.content });

    // Handle tool_use blocks
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      console.warn(
        `${YELLOW}[Agent] Warning: no tool calls and stop_reason is not end_turn.${RESET}`
      );
      break;
    }

    // Execute every requested tool and collect results
    const toolResults = toolUseBlocks.map((toolUse) => {
      process.stdout.write(
        `\n${DIM}[Tool]${RESET} ${YELLOW}${toolUse.name}${RESET}` +
          `(${JSON.stringify(toolUse.input)})\n`
      );

      const result = executeTool(toolUse.name, toolUse.input);

      const preview =
        result.length > 300 ? result.slice(0, 300) + "…" : result;
      process.stdout.write(`${DIM}[Result]${RESET} ${preview}\n`);

      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      };
    });

    messages.push({ role: "user", content: toolResults });
  }

  console.warn(
    `\n${RED}[Agent] Reached max iterations (${maxIterations}).${RESET}`
  );
  return finalText || "Agent reached the maximum number of iterations without a final answer.";
}

// ---------------------------------------------------------------------------
// Interactive REPL
// ---------------------------------------------------------------------------

async function interactiveLoop(client) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `\n${GREEN}You>${RESET} `,
  });

  console.log(
    `\n${CYAN}Real-Time AI Agent${RESET} — type your task and press Enter (Ctrl+C to quit).\n`
  );
  rl.prompt();

  // Pause readline while the agent is running so its output isn't interleaved
  // with the prompt.
  rl.on("line", async (line) => {
    const task = line.trim();
    if (!task) {
      rl.prompt();
      return;
    }

    rl.pause();
    try {
      await runAgent(client, task);
    } catch (err) {
      console.error(`\n${RED}Error: ${err.message}${RESET}`);
    } finally {
      rl.resume();
      rl.prompt();
    }
  });

  rl.on("close", () => {
    console.log(`\n${DIM}Goodbye!${RESET}`);
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      `${RED}Error: ANTHROPIC_API_KEY environment variable is not set.${RESET}`
    );
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  // If a task is passed as a CLI argument, run once and exit.
  const cliTask = process.argv.slice(2).join(" ").trim();
  if (cliTask) {
    await runAgent(client, cliTask);
  } else {
    // Otherwise, start the interactive REPL.
    await interactiveLoop(client);
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
