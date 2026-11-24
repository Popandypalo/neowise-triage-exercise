import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { createTriageServer } from "./server.mjs";

const server = createTriageServer();
let endpoint;

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  endpoint = `http://127.0.0.1:${server.address().port}/api/triage`;
});

after(async () => {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  await closed;
});

async function post(body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

test("accepts all supported model topics and a non-blank draft", async () => {
  const examples = [
    ["Когда будет доставка?", "delivery"],
    ["Уточните стоимость заказа", "pricing"],
    ["Хочу уточнить детали", "other"],
  ];

  for (const [text, topic] of examples) {
    assert.deepEqual(await post(JSON.stringify({ text })), {
      status: 200,
      body: {
        status: "ready",
        topic,
        draft: "Спасибо за обращение. Уточним детали заявки.",
      },
    });
  }
});

test("rejects malformed JSON and invalid input with HTTP 400", async () => {
  const bodies = [
    "",
    '{"text":',
    "null",
    "{}",
    '{"text":null}',
    '{"text":42}',
    '{"text":""}',
    JSON.stringify({ text: " \t\n" }),
  ];

  for (const body of bodies) {
    assert.deepEqual(await post(body), {
      status: 400,
      body: { status: "invalid_input" },
    }, body);
  }
});

for (const marker of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`${marker} returns HTTP 200 with an empty manual review result`, async () => {
    const start = performance.now();
    const response = await post(JSON.stringify({ text: `Когда будет доставка? ${marker}` }));

    assert.deepEqual(response, {
      status: 200,
      body: { status: "manual_review", topic: null, draft: null },
    });

    if (marker === "[timeout]") {
      const elapsed = performance.now() - start;
      // Allow scheduling and HTTP overhead while still catching the mock's 1200 ms delay.
      assert.ok(elapsed < 1000, `The timeout request took ${Math.round(elapsed)} ms`);
    }
  });
}
