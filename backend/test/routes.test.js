import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";

let mongod;
let app;
const analyseTurn = vi.fn();
const providers = {
  stt: vi.fn(async () => ({ transcript: "mane 500 joiye che", ms: 5, cached: false })),
  tts: vi.fn(async (text) => ({ hash: createHash("sha256").update(text).digest("hex"), ms: 3, cached: false })),
  llm: { analyseTurn },
};

// English listener so the "Confirmed:" line is easy to assert.
const config = readConfig({ BUYER_LANG: "en-IN" });

const analysis = (terms = {}, extra = {}) => ({ translation: "I need five hundred.", terms, ambiguities: [], ...extra });
const fullTerms = {
  quantity: { value: 500, unit: "meter" },
  product: { name: "cotton poplin" },
  price: { amount: 118, currency: "INR", per: "meter", gst: "extra" },
  delivery: { raw: "15 November", date: "2026-11-15" },
  payment: { advancePct: 30, balance: "on delivery" },
};
const fullText = "500 meter cotton poplin, 118 rupees per meter, GST extra, delivery 15 November, 30 percent advance, balance on delivery";

const newSession = async () => (await request(app).post("/api/sessions")).body.id;
const turn = (id, speaker, text) => request(app).post(`/api/sessions/${id}/turns`).send({ speaker, text });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp({ providers, config });
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  analyseTurn.mockReset();
  await mongoose.connection.db.dropDatabase();
});

describe("sessions", () => {
  it("health, create, get, list", async () => {
    expect((await request(app).get("/api/health")).body).toEqual({ ok: true });
    const created = await request(app).post("/api/sessions");
    expect(created.status).toBe(201);
    expect(created.body.ledger.quantity.status).toBe("empty");
    const got = await request(app).get(`/api/sessions/${created.body.id}`);
    expect(got.body.id).toBe(created.body.id);
    const list = await request(app).get("/api/sessions");
    expect(list.body[0]).toMatchObject({ id: created.body.id, status: "open", turnCount: 0 });
  });

  it("bad or unknown session id is 404", async () => {
    for (const id of ["abc", "507f1f77bcf86cd799439011"]) {
      const res = await request(app).get(`/api/sessions/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    }
    expect((await turn("abc", "seller", "hi")).status).toBe(404);
  });
});

describe("turns", () => {
  it("holds an ambiguous turn, blocks the other speaker, releases after an option", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(analysis({ quantity: { value: 500 } }));
    const first = await turn(id, "seller", "mane 500 joiye che");
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("clarify");
    expect(first.body.clarification).toMatchObject({ slot: "quantity", type: "A1", question: { lang: "gu-IN" } });
    expect(first.body.clarification.options.map((o) => o.id)).toEqual(["meter", "roll", "kg", "piece"]);
    expect(first.body.clarification.audioUrl).toMatch(/^\/api\/audio\/[0-9a-f]{64}$/);
    expect(first.body.turn.status).toBe("held");
    expect(first.body.turn.latency).toMatchObject({ llmMs: expect.any(Number), ttsMs: 3 });

    const blocked = await turn(id, "buyer", "ok");
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/seller/);

    const answered = await request(app).post(`/api/sessions/${id}/clarify`).send({ optionId: "meter" });
    expect(answered.status).toBe(200);
    expect(answered.body.outcome).toBe("released");
    expect(answered.body.release.lang).toBe("en-IN");
    expect(answered.body.release.text).toContain("I need five hundred.");
    expect(answered.body.release.text).toContain("Confirmed: Quantity 500 meters");
    expect(answered.body.session.ledger.quantity).toMatchObject({ unit: "meter", status: "ok" });
    expect(answered.body.session.turns[0].status).toBe("released");
  });

  it("skip leaves the slot unresolved and confirm is blocked", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(analysis({ quantity: { value: 500 } }));
    await turn(id, "seller", "mane 500 joiye che");
    const skipped = await request(app).post(`/api/sessions/${id}/clarify`).send({ skip: true });
    expect(skipped.body.outcome).toBe("released");
    expect(skipped.body.release.text).not.toContain("Confirmed");
    expect(skipped.body.session.ledger.quantity.status).toBe("unresolved");
    const confirm = await request(app).post(`/api/sessions/${id}/confirm`);
    expect(confirm.status).toBe(409);
    expect(confirm.body.missing).toContain("quantity");
  });

  it("a second unclear answer ends in unresolved after two rounds", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValue(analysis({ quantity: { value: 500 } }));
    expect((await turn(id, "seller", "mane 500 joiye che")).body.outcome).toBe("clarify");
    expect((await turn(id, "seller", "500 ji")).body.outcome).toBe("clarify");
    const last = await turn(id, "seller", "500 ji");
    expect(last.body.outcome).toBe("released");
    expect(last.body.session.ledger.quantity.status).toBe("unresolved");
  });

  it("a voice answer that resolves the slot releases the held turn", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(analysis({ quantity: { value: 500 } }));
    await turn(id, "seller", "mane 500 joiye che");
    analyseTurn.mockResolvedValueOnce(analysis({ quantity: { unit: "meter" } }));
    const res = await turn(id, "seller", "meter, 500 meter");
    expect(res.body.outcome).toBe("released");
    expect(res.body.release.text).toContain("Confirmed: Quantity 500 meters");
  });

  it("clean full deal can be confirmed", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(analysis(fullTerms));
    const res = await turn(id, "seller", fullText);
    expect(res.body.outcome).toBe("released");
    expect(res.body.release.text).toBe("I need five hundred.");

    const confirmed = await request(app).post(`/api/sessions/${id}/confirm`);
    expect(confirmed.status).toBe(200);
    const { card } = confirmed.body;
    expect(card.terms.price).toMatchObject({ amount: 118, gst: "extra" });
    expect(card.text.buyer).toContain("500 meters");
    expect(card.text.seller).toContain("500");
    expect(card.audioUrl.seller).toMatch(/^\/api\/audio\/[0-9a-f]{64}$/);
    expect(card.confirmedAt).toBeTruthy();
    expect(confirmed.body.session.status).toBe("confirmed");
    expect((await turn(id, "seller", "more")).status).toBe(409);
  });

  it("number guard turns an invented quantity into a question", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(analysis({ ...fullTerms, quantity: { value: 900, unit: "meter" } }));
    const res = await turn(id, "seller", fullText);
    expect(res.body.session.ledger.quantity.value).toBeNull();
    expect((await request(app).post(`/api/sessions/${id}/confirm`)).status).toBe(409);
  });

  it("validates input", async () => {
    const id = await newSession();
    expect((await turn(id, "owner", "hi")).status).toBe(400);
    expect((await turn(id, "seller", "")).status).toBe(400);
    expect((await turn(id, "seller", "x".repeat(1001))).status).toBe(400);
    expect((await request(app).post(`/api/sessions/${id}/clarify`).send({ optionId: "meter" })).status).toBe(409);
    expect((await request(app).post(`/api/sessions/${id}/clarify`).send({})).status).toBe(400);
    expect(analyseTurn).not.toHaveBeenCalled();
  });

  it("voice turn goes through stt and rejects non-wav uploads", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(analysis(fullTerms));
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(32)]);
    const ok = await request(app).post(`/api/sessions/${id}/turns`).field("speaker", "seller").attach("audio", wav, { filename: "a.wav", contentType: "audio/wav" });
    expect(ok.status).toBe(200);
    expect(ok.body.turn).toMatchObject({ source: "voice", transcript: "mane 500 joiye che" });
    const bad = await request(app).post(`/api/sessions/${id}/turns`).field("speaker", "seller").attach("audio", Buffer.from("hello"), { filename: "a.mp3", contentType: "audio/mpeg" });
    expect(bad.status).toBe(415);
    const fake = await request(app).post(`/api/sessions/${id}/turns`).field("speaker", "seller").attach("audio", Buffer.from("not really a wav file"), { filename: "a.wav", contentType: "audio/wav" });
    expect(fake.status).toBe(415);
  });

  it("provider failures give a clear error without a stack", async () => {
    const id = await newSession();
    analyseTurn.mockRejectedValueOnce(new Error("boom with secret-key-123"));
    const res = await turn(id, "seller", "hello 5");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|boom|at /);
  });
});

describe("audio", () => {
  it("validates the hash and 404s when missing", async () => {
    expect((await request(app).get("/api/audio/not-a-hash")).status).toBe(400);
    expect((await request(app).get(`/api/audio/${"a".repeat(63)}`)).status).toBe(400);
    expect((await request(app).get(`/api/audio/${"A".repeat(64)}`)).status).toBe(400);
    expect((await request(app).get(`/api/audio/${"a".repeat(64)}`)).status).toBe(404);
  });
});

describe("cors", () => {
  it("allows only the configured origin", async () => {
    const ok = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const other = await request(app).get("/api/health").set("Origin", "http://evil.example");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("accepts the 127.0.0.1 form and a comma-separated list", async () => {
    const alias = await request(app).get("/api/health").set("Origin", "http://127.0.0.1:5173");
    expect(alias.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    const listed = createApp({ providers, config: readConfig({ FRONTEND_ORIGIN: "https://a.example, https://b.example" }) });
    const ok = await request(listed).get("/api/health").set("Origin", "https://b.example");
    expect(ok.headers["access-control-allow-origin"]).toBe("https://b.example");
  });
});

describe("review fixes", () => {
  const clarify = (id, body) => request(app).post(`/api/sessions/${id}/clarify`).send(body);
  const qtyOpen = () => analysis({ quantity: { value: 500 } });

  it("a re-answer with new terms is released together with the original", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(qtyOpen());
    await turn(id, "seller", "mane 500 joiye che");
    analyseTurn.mockResolvedValueOnce(analysis({ quantity: { unit: "meter" } }, { translation: "Meters, five hundred." }));
    const res = await turn(id, "seller", "meter, 500 meter");
    expect(res.body.outcome).toBe("released");
    const [first, second] = res.body.session.turns;
    expect(first.status).toBe("released");
    expect(second.status).toBe("released");
    expect(first.releasedText).toContain("I need five hundred.");
    expect(first.releasedText).toContain("Meters, five hundred.");
    expect(second.releasedText).toBe(first.releasedText);
  });

  it("a re-answer with no new terms is released with its own translation", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(qtyOpen());
    await turn(id, "seller", "mane 500 joiye che");
    analyseTurn.mockResolvedValueOnce(analysis({}, { translation: "Please ask again." }));
    expect((await turn(id, "seller", "kahi didhu")).body.outcome).toBe("clarify");
    const res = await clarify(id, { optionId: "meter" });
    expect(res.body.outcome).toBe("released");
    const turns = res.body.session.turns;
    expect(turns.every((x) => x.status === "released")).toBe(true);
    expect(turns[1].releasedText).toBe("Please ask again.");
    expect(turns[0].releasedText).not.toContain("Please ask again.");
  });

  it("overlapping turns on one session both persist", async () => {
    const id = await newSession();
    analyseTurn.mockImplementation(async ({ transcript }) => {
      if (transcript === "slow") {
        await new Promise((r) => setTimeout(r, 150));
        return analysis({ product: { name: "poplin" } });
      }
      return analysis({ payment: { advancePct: 30, balance: "on delivery" } });
    });
    const [a, b] = await Promise.all([turn(id, "seller", "slow"), turn(id, "seller", "30 advance")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const got = (await request(app).get(`/api/sessions/${id}`)).body;
    expect(got.turns).toHaveLength(2);
    expect(got.ledger.product.name).toBe("poplin");
    expect(got.ledger.payment.advancePct).toBe(30);
  });

  it("an LLM ambiguity on the same slot as a rule is asked after the rule question", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(analysis({ quantity: { value: 500 } }, {
      ambiguities: [{ type: "A9", slot: "quantity", quote: null, options: [
        { label: "500", patch: { value: 500 } }, { label: "600", patch: { value: 600 } },
      ] }],
    }));
    const first = await turn(id, "seller", "500 ya 600");
    expect(first.body.clarification.type).toBe("A1");
    const second = await clarify(id, { optionId: "meter" });
    expect(second.body.outcome).toBe("clarify");
    expect(second.body.clarification.type).toBe("A9");
    const done = await clarify(id, { optionId: "o0" });
    expect(done.body.outcome).toBe("released");
    expect(done.body.session.ledger.quantity).toMatchObject({ value: 500, unit: "meter" });
  });

  it("skipping a changed price reverts to the old amount and marks it unresolved", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(analysis(fullTerms));
    await turn(id, "seller", fullText);
    analyseTurn.mockResolvedValueOnce(analysis({ price: { amount: 120 } }));
    const asked = await turn(id, "seller", "ok 120");
    expect(asked.body.clarification.type).toBe("A8");
    const res = await clarify(id, { skip: true });
    expect(res.body.session.ledger.price).toMatchObject({ amount: 118, status: "unresolved" });
  });

  it("a value dropped by the number guard is reported and the slot needs an answer", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(analysis({ quantity: { value: 900, unit: "meter" } }));
    const res = await turn(id, "seller", "pachchees meter joiye");
    expect(res.body.dropped).toEqual([{ slot: "quantity", field: "value" }]);
    expect(res.body.session.ledger.quantity).toMatchObject({ value: null, status: "unresolved" });
  });

  it("confirm while a question is open says so", async () => {
    const id = await newSession();
    analyseTurn.mockResolvedValueOnce(qtyOpen());
    await turn(id, "seller", "mane 500 joiye che");
    const res = await request(app).post(`/api/sessions/${id}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/question is still open/i);
    expect(res.body.error).not.toMatch(/: \./);
  });

  it("rejects a WAV longer than 25.5 seconds", async () => {
    const id = await newSession();
    const byteRate = 32000;
    const data = Buffer.alloc(byteRate * 30);
    const head = Buffer.alloc(44);
    head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
    head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
    head.writeUInt32LE(16000, 24); head.writeUInt32LE(byteRate, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
    head.write("data", 36); head.writeUInt32LE(data.length, 40);
    const res = await request(app).post(`/api/sessions/${id}/turns`).field("speaker", "seller")
      .attach("audio", Buffer.concat([head, data]), { filename: "a.wav", contentType: "audio/wav" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/25 seconds/);
  });

  it("the error handler does not log the upstream message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await newSession();
    analyseTurn.mockRejectedValueOnce(new Error("boom with secret-key-123"));
    await turn(id, "seller", "hello 5");
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/secret|boom/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
