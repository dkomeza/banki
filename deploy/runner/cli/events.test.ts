import { describe, expect, test } from "bun:test";
import { summarize } from "./events";

// One line per stream-json event from `claude -p --verbose`, for a person
// watching `runner stage` in a terminal. The full event is in the log.

const line = (event: unknown) => JSON.stringify(event);

const call = (name: string, input: unknown) =>
  summarize(line({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } }));

const result = (content: unknown, isError: boolean) =>
  summarize(
    line({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", content, is_error: isError }],
      },
    }),
  );

describe("an event's line", () => {
  test("for the start names the model, the session and the MCP servers' state", () => {
    expect(
      summarize(
        line({
          type: "system",
          subtype: "init",
          session_id: "abc-123",
          model: "claude-opus-5-5",
          mcp_servers: [{ name: "linear-banki", status: "connected" }],
        }),
      ),
    ).toBe("start: claude-opus-5-5, session abc-123, MCP linear-banki connected");
  });

  test("for assistant text is its first line, shortened", () => {
    expect(
      summarize(
        line({
          type: "assistant",
          message: { content: [{ type: "text", text: "Reading the issue.\nThen the ADRs." }] },
          parent_tool_use_id: null,
        }),
      ),
    ).toBe("say: Reading the issue.");
    const long = summarize(
      line({ type: "assistant", message: { content: [{ type: "text", text: "x".repeat(500) }] } }),
    );
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });

  test("for a tool call names the tool and what it is called on", () => {
    expect(
      call("Bash", { command: "bun run test\n# and more", description: "Run the tests" }),
    ).toBe("tool: Bash bun run test # and more");
    expect(call("Read", { file_path: "/work/banki/CONTEXT.md" })).toBe(
      "tool: Read /work/banki/CONTEXT.md",
    );
    expect(call("Grep", { pattern: "isCommit", path: "deploy" })).toBe("tool: Grep isCommit");
    expect(
      call("Agent", { description: "Review the branch", subagent_type: "spec-reviewer" }),
    ).toBe("tool: Agent Review the branch");
    expect(call("mcp__linear-banki__get_issue", { id: "BAN-94" })).toBe(
      "tool: mcp__linear-banki__get_issue BAN-94",
    );
    expect(call("TodoWrite", { todos: [] })).toBe("tool: TodoWrite");
  });

  test("for a tool's result says only whether it failed, and how", () => {
    expect(result("ok output", false)).toBe("tool result");
    expect(result("Exit code 1\nlots of output", true)).toBe("tool error: Exit code 1");
    expect(result([{ type: "text", text: "File not found" }], true)).toBe(
      "tool error: File not found",
    );
  });

  test("from a subagent is indented under its parent", () => {
    expect(
      summarize(
        line({
          type: "assistant",
          message: { content: [{ type: "text", text: "Checking." }] },
          parent_tool_use_id: "toolu_1",
        }),
      ),
    ).toBe("  ↳ say: Checking.");
  });

  test("for the end gives the outcome, turns, time and cost", () => {
    expect(
      summarize(
        line({
          type: "result",
          subtype: "success",
          is_error: false,
          num_turns: 42,
          duration_ms: 3_725_000,
          total_cost_usd: 12.3456,
          result: "Done.",
        }),
      ),
    ).toBe("end: success, 42 turns, 1h 2m 5s, $12.35");
    expect(
      summarize(line({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 3 })),
    ).toBe("end: error_max_turns (error), 3 turns");
  });

  test("for any other event is its type and subtype", () => {
    expect(summarize(line({ type: "rate_limit_event", rate_limit_info: {} }))).toBe(
      "rate_limit_event",
    );
    expect(summarize(line({ type: "system", subtype: "compact_boundary" }))).toBe(
      "system: compact_boundary",
    );
    expect(summarize(line({ type: "assistant", message: { content: [] } }))).toBe("assistant");
  });

  test("for a line that isn't a JSON event says so, shortened", () => {
    expect(summarize("not json at all")).toBe("(not an event) not json at all");
    expect(summarize(line([1, 2]))).toBe("(not an event) [1,2]");
  });
});
