// node --test server/tests/llm.test.mjs
//
// Unit tests for server/llm.js using _setClientForTests injection.
// All tests are offline — no real Anthropic API calls are made.
// Coverage:
//   a) system-role lifting to top-level system param
//   b) fast vs reasoning param mapping (thinking + output_config.effort)
//   c) jsonSchema → output_config.format passed through
//   d) timeout error from SDK → Error with .code==="LLM_TIMEOUT"
//   e) chatStream yields text_delta texts only (skips thinking_delta)
//   f) legacy options sanitization (top_p/repeat_penalty dropped, temperature kept)

import test from "node:test";
import assert from "node:assert/strict";

import {
  chat,
  chatStream,
  _setClientForTests,
  FAST_OPTIONS,
  REASONING_OPTIONS,
  STUDENT_SAMPLING,
  DETERMINISTIC_SAMPLING,
} from "../llm.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Captures what was passed to client.messages.create.
function captureClient(response = "hello") {
  let captured = null;
  const fake = {
    messages: {
      create(params, reqOpts) {
        captured = { params, reqOpts };
        return Promise.resolve({ content: [{ type: "text", text: response }] });
      },
      stream() {
        // Returns an empty async iterable by default
        return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true }) }) };
      },
    },
  };
  return { fake, getCapture: () => captured };
}

// Build a fake streaming client that emits a sequence of SSE-style events.
function streamClient(events) {
  const fake = {
    messages: {
      create() {
        throw new Error("should not call create in streaming test");
      },
      stream(_params, _opts) {
        return {
          [Symbol.asyncIterator]() {
            let i = 0;
            return {
              next() {
                if (i >= events.length) return Promise.resolve({ done: true });
                return Promise.resolve({ value: events[i++], done: false });
              },
            };
          },
        };
      },
    },
  };
  return fake;
}

// Build a timeout-throwing client.
function timeoutClient() {
  const err = new Error("Request timed out");
  err.constructor = { name: "APIConnectionTimeoutError" };
  // Use the class name trick: SDK error check uses constructor.name
  const TimeoutErr = class APIConnectionTimeoutError extends Error {};
  const timeoutErr = new TimeoutErr("Request timed out");
  const fake = {
    messages: {
      create() { return Promise.reject(timeoutErr); },
      stream() { throw timeoutErr; },
    },
  };
  return fake;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.afterEach(() => {
  _setClientForTests(null); // restore real client (won't be called since tests exit)
});

// a) System role is lifted to top-level system param; non-system messages stay in messages[]
test("a) system-role lifting: leading system message moves to top-level system param", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  await chat([
    { role: "system", content: "You are a student." },
    { role: "user", content: "Hello" },
  ], FAST_OPTIONS);

  const { params } = getCapture();
  assert.equal(params.system, "You are a student.", "system param must contain the lifted message");
  assert.ok(Array.isArray(params.messages), "messages must be an array");
  // The system message must not appear in params.messages
  assert.ok(
    !params.messages.some((m) => m.role === "system"),
    "system role must not appear in params.messages",
  );
  assert.equal(params.messages.length, 1, "only the user message remains");
  assert.equal(params.messages[0].content, "Hello");
});

// b) Fast mode → thinking.type=disabled, output_config.effort=low
//    Reasoning mode → thinking.type=adaptive, output_config.effort=high
test("b1) fast mode: thinking.type=disabled and effort=low", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  await chat([{ role: "user", content: "hi" }], { ...FAST_OPTIONS });

  const { params } = getCapture();
  assert.equal(params.thinking?.type, "disabled");
  assert.equal(params.output_config?.effort, "low");
});

test("b2) reasoning mode: thinking.type=adaptive and effort=high", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  await chat([{ role: "user", content: "hi" }], { ...REASONING_OPTIONS });

  const { params } = getCapture();
  assert.equal(params.thinking?.type, "adaptive");
  assert.equal(params.output_config?.effort, "high");
});

test("b3) reasoning mode drops temperature (incompatible with adaptive thinking)", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  await chat([{ role: "user", content: "hi" }], { ...REASONING_OPTIONS, temperature: 0.9 });

  const { params } = getCapture();
  assert.equal(params.thinking?.type, "adaptive");
  assert.ok(!("temperature" in params), "temperature must not be sent with adaptive thinking");
});

// c) jsonSchema drives output_config.format
test("c) jsonSchema option sets output_config.format.type=json_schema", async () => {
  const schema = {
    type: "object",
    properties: { answer: { type: "string" } },
    required: ["answer"],
    additionalProperties: false,
  };
  const { fake, getCapture } = captureClient('{"answer":"yes"}');
  _setClientForTests(fake);

  await chat([{ role: "user", content: "answer?" }], { ...FAST_OPTIONS, jsonSchema: schema });

  const { params } = getCapture();
  assert.equal(params.output_config?.format?.type, "json_schema", "format type must be json_schema");
  assert.deepEqual(params.output_config?.format?.schema, schema, "schema must be passed through");
});

// d) SDK timeout error maps to Error with .code==="LLM_TIMEOUT"
test("d) SDK timeout error is mapped to Error with .code=LLM_TIMEOUT", async () => {
  // Use a class whose name is APIConnectionTimeoutError, matching the SDK's error class name.
  const TimeoutErr = class APIConnectionTimeoutError extends Error {};
  const fakeTimeoutErr = new TimeoutErr("connection timed out");
  const fake = {
    messages: {
      create() { return Promise.reject(fakeTimeoutErr); },
      stream() { return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(fakeTimeoutErr) }) }; },
    },
  };
  _setClientForTests(fake);

  let caught;
  try {
    await chat([{ role: "user", content: "hi" }], { ...FAST_OPTIONS, timeoutMs: 5000, maxRetries: 0 });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "should have thrown");
  assert.equal(caught.code, "LLM_TIMEOUT", `expected LLM_TIMEOUT, got: ${caught.code} / ${caught.message}`);
});

// e) chatStream yields only text_delta texts; thinking_delta is skipped
test("e) chatStream yields text_delta only, skips thinking_delta", async () => {
  const events = [
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "internal reasoning" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "more thinking" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
    { type: "message_stop" },
  ];
  _setClientForTests(streamClient(events));

  const tokens = [];
  for await (const tok of chatStream([{ role: "user", content: "hi" }], FAST_OPTIONS)) {
    tokens.push(tok);
  }

  assert.deepEqual(tokens, ["Hello", " world"], "only text_delta texts should be yielded");
});

// f) Legacy option sanitization: top_p and repeat_penalty are dropped, temperature kept
test("f) top_p and repeat_penalty are dropped; temperature is kept", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  await chat([{ role: "user", content: "hi" }], {
    mode: "fast",
    temperature: 0.9,
    top_p: 0.95,
    repeat_penalty: 1.3,
  });

  const { params } = getCapture();
  assert.equal(params.temperature, 0.9, "temperature must be kept");
  assert.ok(!("top_p" in params), "top_p must be dropped");
  assert.ok(!("repeat_penalty" in params), "repeat_penalty must be dropped");
  assert.ok(!("frequency_penalty" in params), "no frequency_penalty translation should happen");
});

// g) Prompt-caching: systemParts → params.system is a 2-block array with
//    cache_control only on block 0; messages[] contains no system-role entry.
test("g1) systemParts builds a 2-block system array; cache_control on block 0 only", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  const systemParts = { stable: "The stable prefix text.", variable: "The variable suffix text." };
  await chat([{ role: "user", content: "hi" }], { ...FAST_OPTIONS, systemParts });

  const { params } = getCapture();
  assert.ok(Array.isArray(params.system), "params.system must be an array when systemParts is given");
  assert.equal(params.system.length, 2, "system array must have 2 blocks");
  assert.equal(params.system[0].type, "text", "block 0 must be type text");
  assert.equal(params.system[0].text, "The stable prefix text.", "block 0 text must equal stable");
  assert.deepEqual(params.system[0].cache_control, { type: "ephemeral" }, "block 0 must have ephemeral cache_control");
  assert.equal(params.system[1].type, "text", "block 1 must be type text");
  assert.equal(params.system[1].text, "The variable suffix text.", "block 1 text must equal variable");
  assert.ok(!("cache_control" in params.system[1]), "block 1 must NOT have cache_control");
});

test("g2) systemParts + temperature still includes temperature in fast mode", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  const systemParts = { stable: "Stable.", variable: "Variable." };
  await chat([{ role: "user", content: "hi" }], { mode: "fast", temperature: 0.9, systemParts });

  const { params } = getCapture();
  assert.equal(params.temperature, 0.9, "temperature must be present in fast mode with systemParts");
  assert.ok(Array.isArray(params.system), "system must still be an array");
});

test("g3) systemParts with empty variable emits only 1 block", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  const systemParts = { stable: "Stable only.", variable: "" };
  await chat([{ role: "user", content: "hi" }], { ...FAST_OPTIONS, systemParts });

  const { params } = getCapture();
  assert.ok(Array.isArray(params.system), "system must be an array");
  assert.equal(params.system.length, 1, "should be 1 block when variable is empty");
  assert.equal(params.system[0].text, "Stable only.");
});

test("g4) messages array contains no system-role entry when systemParts is used", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  const systemParts = { stable: "Stable.", variable: "Variable." };
  // No system-role message — only user messages.
  await chat([{ role: "user", content: "hello" }], { ...FAST_OPTIONS, systemParts });

  const { params } = getCapture();
  assert.ok(Array.isArray(params.messages), "messages must be an array");
  assert.ok(
    !params.messages.some((m) => m.role === "system"),
    "no system-role entry should appear in params.messages",
  );
  assert.equal(params.messages.length, 1, "only the user message remains in messages[]");
});

test("g5) systemParts wins over a leading system-role message in the array", async () => {
  const { fake, getCapture } = captureClient("OK");
  _setClientForTests(fake);

  const systemParts = { stable: "Parts stable.", variable: "Parts variable." };
  // Pass both — systemParts should win, system-role message is discarded.
  await chat([
    { role: "system", content: "Ignored system message." },
    { role: "user", content: "hi" },
  ], { ...FAST_OPTIONS, systemParts });

  const { params } = getCapture();
  assert.ok(Array.isArray(params.system), "system must be the parts array");
  assert.equal(params.system[0].text, "Parts stable.", "parts stable wins over system-role message");
  assert.ok(
    !params.messages.some((m) => m.role === "system"),
    "system-role message is not in messages[] when systemParts wins",
  );
});
