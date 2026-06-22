import { afterEach, describe, expect, it, vi } from "vitest";
import { gradeAnswer, plainText, resolveGradingConfig, streamGradeAnswer } from "./answer-grader";

function streamingResponse(grade: { rating: number; feedback: string }) {
  const output = JSON.stringify(grade);
  const split = output.indexOf('"feedback"') + 15;
  return new Response([
    { type: "response.created" },
    { type: "response.output_text.delta", delta: output.slice(0, split) },
    { type: "response.output_text.delta", delta: output.slice(split) },
    { type: "response.completed", response: {} },
  ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_GRADING_MODEL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_GRADING_MODEL;
});

describe("answer grader", () => {
  it("converts card HTML into compact plain text", () => {
    expect(plainText("<p>Mass &amp; <strong>energy</strong></p><script>ignore()</script>")).toBe("Mass &amp; energy");
  });

  it("returns a structured grade from the Responses API", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(streamingResponse({ rating: 3, feedback: "Correct, but missing one detail." }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(gradeAnswer({ promptHtml: "Question", expectedAnswerHtml: "Reference", learnerAnswer: "Response" }))
      .resolves.toEqual({ rating: 3, feedback: "Correct, but missing one detail." });
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ method: "POST" }));
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toMatchObject({ stream: true });
    expect(request.instructions).toContain("same language as the learner's answer");
  });

  it("streams progress before the final grade", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamingResponse({ rating: 4, feedback: "Complete." })));
    const events = [];
    for await (const event of streamGradeAnswer({ promptHtml: "Q", expectedAnswerHtml: "A", learnerAnswer: "A" })) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["status", "status", "status", "delta", "delta", "result"]);
    expect(events.at(-1)).toEqual({ type: "result", grade: { rating: 4, feedback: "Complete." } });
  });

  it("requires a server API key", async () => {
    await expect(gradeAnswer({ promptHtml: "Q", expectedAnswerHtml: "A", learnerAnswer: "A" }))
      .rejects.toThrow("Settings");
  });

  it("prefers saved grading settings over environment fallbacks", () => {
    process.env.OPENAI_API_KEY = "environment-key";
    process.env.OPENAI_GRADING_MODEL = "environment-model";
    expect(resolveGradingConfig({ gradingEnabled: false, openaiApiKey: "saved-key", openaiModel: "saved-model" }))
      .toEqual({ enabled: false, provider: "openai", apiKey: "saved-key", model: "saved-model", endpoint: "https://api.openai.com/v1/responses" });
  });

  it("uses the OpenRouter Responses endpoint and provider key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamingResponse({ rating: 4, feedback: "Complete." }));
    vi.stubGlobal("fetch", fetchMock);
    const config = resolveGradingConfig({ gradingProvider: "openrouter", openrouterApiKey: "router-key", openaiModel: "anthropic/claude-sonnet-4.6" });
    await gradeAnswer({ promptHtml: "Q", expectedAnswerHtml: "A", learnerAnswer: "A", config });
    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/responses", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer router-key", "x-openrouter-title": "Banki" }) }));
  });
});
