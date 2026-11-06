import { describe, it, expect, vi, afterEach } from "vitest";
import { readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { stt, tts, audioPath } from "../src/gnani.js";

afterEach(() => vi.unstubAllGlobals());
const CACHE_DIR = fileURLToPath(new URL("../.cache/", import.meta.url));

describe("gnani", () => {
  it("concurrent identical tts calls hit the network once and leave no temp files", async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.from("RIFFdata"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const text = `cache test ${randomUUID()}`;
    const [a, b] = await Promise.all([tts(text, "en-IN", "V"), tts(text, "en-IN", "V")]);
    expect(a.hash).toBe(b.hash);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await readdir(CACHE_DIR)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    await rm(audioPath(a.hash), { force: true });
  });

  it("sends a timeout signal and does not forward upstream detail", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "key sk-secret-999 bad" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await tts(`detail test ${randomUUID()}`, "en-IN", "V").catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).not.toMatch(/secret|sk-/);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("treats a timeout as a retryable network error and reports it clearly", async () => {
    const fetchMock = vi.fn(async () => { throw new DOMException("timed out", "TimeoutError"); });
    vi.stubGlobal("fetch", fetchMock);
    const err = await stt(Buffer.from(randomUUID()), "en-IN").catch((e) => e);
    expect(err.message).toMatch(/took too long/);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  }, 15000);
});
