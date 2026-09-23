import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider, getProviderInfo } from "@/lib/gsp/registry";
import { httpProvider } from "@/lib/gsp/http-provider";
import { GspError } from "@/lib/gsp/types";
import { parseGstr2bJson } from "@/lib/import/gstr2b-json";
import { buildGstin } from "@/lib/gstin";

const GSTIN = buildGstin("29", "AABCA1234A");
const ENV_KEYS = ["GSP_PROVIDER", "GSP_HTTP_BASE_URL", "GSP_HTTP_PATH", "GSP_HTTP_API_KEY", "GSP_HTTP_AUTH_SCHEME", "GSP_HTTP_RESPONSE_PATH"];

afterEach(() => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  vi.unstubAllGlobals();
});

describe("GSP registry", () => {
  it("defaults to no provider (file upload only)", () => {
    expect(getProvider()).toBeNull();
    expect(getProviderInfo()).toMatchObject({ id: "none", configured: false });
  });

  it("reports an unknown provider id as not configured", () => {
    process.env.GSP_PROVIDER = "nope";
    expect(getProviderInfo().configured).toBe(false);
    expect(getProviderInfo().description).toMatch(/not a registered provider/);
  });

  it("mock provider output is valid GSTR-2B JSON that the importer accepts", async () => {
    process.env.GSP_PROVIDER = "mock";
    const p = getProvider()!;
    expect(p.isConfigured()).toBe(true);
    const doc = await p.fetchGstr2b({ gstin: GSTIN, year: 2025, month: 4 });
    const out = parseGstr2bJson(doc);
    expect(out.errorRows).toBe(0);
    expect(out.docs.length).toBe(6);
    expect(out.gstin).toBe(GSTIN);
    expect(out.returnPeriod).toEqual({ year: 2025, month: 4 });
  });
});

describe("HTTP provider", () => {
  const configure = () => {
    process.env.GSP_PROVIDER = "http";
    process.env.GSP_HTTP_BASE_URL = "https://gsp.example.in";
    process.env.GSP_HTTP_PATH = "/gstr2b?gstin={gstin}&period={period}";
    process.env.GSP_HTTP_API_KEY = "secret-token";
    process.env.GSP_HTTP_AUTH_SCHEME = "Bearer";
  };

  it("needs base URL, path and key; refuses plain http", () => {
    expect(httpProvider.isConfigured()).toBe(false);
    configure();
    expect(httpProvider.isConfigured()).toBe(true);
    process.env.GSP_HTTP_BASE_URL = "http://gsp.example.in";
    expect(httpProvider.isConfigured()).toBe(false);
  });

  it("calls the templated URL with the credential header and unwraps the response path", async () => {
    configure();
    process.env.GSP_HTTP_RESPONSE_PATH = "result";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { data: { gstin: GSTIN } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const doc = await httpProvider.fetchGstr2b({ gstin: GSTIN, year: 2025, month: 4 });
    expect(doc).toEqual({ data: { gstin: GSTIN } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(`https://gsp.example.in/gstr2b?gstin=${GSTIN}&period=042025`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(init.redirect).toBe("error");
  });

  it("turns upstream failures into safe messages without leaking credentials", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("token secret-token invalid", { status: 401 })));
    const err = await httpProvider.fetchGstr2b({ gstin: GSTIN, year: 2025, month: 4 }).then(() => { throw new Error("expected the provider to fail"); }, (e: unknown) => e as GspError);
    expect(err).toBeInstanceOf(GspError);
    expect(err.message).not.toContain("secret-token");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect((await httpProvider.fetchGstr2b({ gstin: GSTIN, year: 2025, month: 4 }).then(() => { throw new Error("expected the provider to fail"); }, (e: unknown) => e as GspError)).status).toBe(404);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    expect((await httpProvider.fetchGstr2b({ gstin: GSTIN, year: 2025, month: 4 }).then(() => { throw new Error("expected the provider to fail"); }, (e: unknown) => e as GspError)).message).toMatch(/valid JSON/);
  });

  it("never lets the path template escape the configured host", async () => {
    configure();
    process.env.GSP_HTTP_PATH = "//evil.example.com/x";
    vi.stubGlobal("fetch", vi.fn());
    const err = await httpProvider.fetchGstr2b({ gstin: GSTIN, year: 2025, month: 4 }).then(() => { throw new Error("expected the provider to fail"); }, (e: unknown) => e as GspError);
    expect(err).toBeInstanceOf(GspError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
