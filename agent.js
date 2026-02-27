#!/usr/bin/env node
/**
 * AI Agent Script
 *
 * A simple agentic loop using the Anthropic API.
 * The agent can call tools, observe results, and iterate
 * until it produces a final answer.
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
        const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
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
 * Run the agent loop for a given user task.
 *
 * @param {Anthropic} client      - Anthropic client instance
 * @param {string}    task        - The user's task/question
 * @param {object}    [options]
 * @param {number}    [options.maxIterations=20]  - Safety cap on tool rounds
 * @param {string}    [options.model]             - Claude model to use
 * @returns {Promise<string>} Final text response from the agent
 */
async function runAgent(client, task, options = {}) {
  const { maxIterations = 20, model = "claude-opus-4-6" } = options;

  const messages = [{ role: "user", content: task }];

  console.log("\n--- Agent started ---");
  console.log(`Task: ${task}\n`);

  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    // Collect all text blocks for logging
    const textBlocks = response.content.filter((b) => b.type === "text");
    if (textBlocks.length > 0) {
      console.log(`[Agent] ${textBlocks.map((b) => b.text).join("\n")}`);
    }

    // If the model is done (no more tool calls), return the final answer
    if (response.stop_reason === "end_turn") {
      const finalText = textBlocks.map((b) => b.text).join("\n");
      console.log("\n--- Agent finished ---\n");
      return finalText;
    }

    // Push the assistant's message (may contain text + tool_use blocks)
    messages.push({ role: "assistant", content: response.content });

    // Process all tool_use blocks in this response
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      // Unexpected: no tool calls and stop_reason is not end_turn
      console.warn("[Agent] Warning: no tool calls but stop_reason is not end_turn.");
      break;
    }

    const toolResults = toolUseBlocks.map((toolUse) => {
      console.log(`[Tool] ${toolUse.name}(${JSON.stringify(toolUse.input)})`);
      const result = executeTool(toolUse.name, toolUse.input);
      console.log(`[Tool result] ${result.slice(0, 200)}${result.length > 200 ? "…" : ""}\n`);

      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      };
    });

    messages.push({ role: "user", content: toolResults });
  }

  console.warn(`[Agent] Reached max iterations (${maxIterations}).`);
  return "Agent reached the maximum number of iterations without a final answer.";
}

// ---------------------------------------------------------------------------
// Interactive REPL (optional)
// ---------------------------------------------------------------------------

async function interactiveLoop(client) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\nYou> ",
  });

  console.log("AI Agent REPL — type your task and press Enter (Ctrl+C to quit).\n");
  rl.prompt();

  rl.on("line", async (line) => {
    const task = line.trim();
    if (!task) {
      rl.prompt();
      return;
    }

    try {
      const answer = await runAgent(client, task);
      console.log(`\nFinal answer:\n${answer}`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  // If a task is passed as a CLI argument, run once and exit.
  const cliTask = process.argv.slice(2).join(" ").trim();
  if (cliTask) {
    const answer = await runAgent(client, cliTask);
    console.log(`\nFinal answer:\n${answer}`);
  } else {
    // Otherwise, start the interactive REPL.
    await interactiveLoop(client);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
