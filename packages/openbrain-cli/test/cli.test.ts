import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { runCli } from "../src/cli.js";
import { CaptureSink, FakeTransport } from "./fakes.js";

/**
 * Tests for the OpenBrain CLI (issue #9, slice S1). These mock HTTP through
 * the injectable transport seam — no real Worker, no network. They assert
 * process-level observables (stdout, stderr, exit code, request count) the
 * way a caller would see them, not internal function returns.
 *
 * Pinned strings come from the spec / test plan ("String-pinning note"): the
 * `Missing value for --<key>` and `Request failed with <status>` local
 * formats, and the server-passed API error strings. Every other local error
 * is asserted only by its `openbrain: ` prefix + non-zero + no-request +
 * no-stdout.
 */

const KEY = "test-api-key";
const SECRET = "secret-key-12345";
const BASE = "https://api.example.com/v1";
const UUID = "11111111-1111-4111-8111-111111111111";

// Server-passed API error strings (pinned by the spec).
const ERR_UNAUTHORIZED = "Unauthorized.";
const ERR_MEMORY_NOT_FOUND = "Memory not found.";
const ERR_NOT_FOUND = "Not found.";
const ERR_ID_UUID = "`id` must be a valid UUID v4.";
const ERR_METADATA_OBJECT = "`metadata` must be a JSON object when provided.";
const ERR_LIMIT_NUMBER = "`limit` must be a number when provided.";
const ERR_THRESHOLD_RANGE = "`threshold` must be a number in [0, 1].";
const ERR_CONTENT_EMPTY = "`content` must be a non-empty string.";
const ERR_QUERY_EMPTY = "`query` must be a non-empty string.";

function fullEnv(): Record<string, string | undefined> {
  return { OPENBRAIN_API_KEY: KEY, OPENBRAIN_BASE_URL: BASE };
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  transport: FakeTransport;
}

async function run(
  argv: string[],
  opts: {
    env?: Record<string, string | undefined>;
    transport?: FakeTransport;
  } = {},
): Promise<RunResult> {
  const transport = opts.transport ?? new FakeTransport();
  const stdout = new CaptureSink();
  const stderr = new CaptureSink();
  const code = await runCli({
    argv,
    env: opts.env ?? {},
    stdout,
    stderr,
    transport,
  });
  return { code, stdout: stdout.text, stderr: stderr.text, transport };
}

describe("config — missing key/base URL is fatal before any request", () => {
  it("omitting the API key sends no request", async () => {
    const r = await run(["create", "--content", "x"], {
      env: { OPENBRAIN_BASE_URL: BASE },
    });
    expect(r.transport.requestCount).toBe(0);
    expect(r.code).not.toBe(0);
    expect(r.stderr.startsWith("openbrain:")).toBe(true);
    expect(r.stdout).toBe("");
  });

  it("omitting the base URL sends no request", async () => {
    const r = await run(["create", "--content", "x"], {
      env: { OPENBRAIN_API_KEY: KEY },
    });
    expect(r.transport.requestCount).toBe(0);
    expect(r.code).not.toBe(0);
    expect(r.stderr.startsWith("openbrain:")).toBe(true);
    expect(r.stdout).toBe("");
  });
});

describe("the API key is never printed anywhere", () => {
  const argv = [
    "create",
    "--content",
    "x",
    "--api-key",
    SECRET,
    "--base-url",
    BASE,
  ];

  it("on a success path", async () => {
    const transport = new FakeTransport().respond(
      201,
      '{"memory":{"id":"abc"}}',
    );
    const r = await run(argv, { transport });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain(SECRET);
    expect(r.stderr).not.toContain(SECRET);
  });

  it("on a non-OK path", async () => {
    const transport = new FakeTransport().respond(
      401,
      `{"error":"${ERR_UNAUTHORIZED}"}`,
    );
    const r = await run(argv, { transport });
    expect(r.code).not.toBe(0);
    expect(r.stdout).not.toContain(SECRET);
    expect(r.stderr).not.toContain(SECRET);
  });

  it("on a network-failure path", async () => {
    const transport = new FakeTransport().throw(
      "getaddrinfo ENOTFOUND api.example.com",
    );
    const r = await run(argv, { transport });
    expect(r.code).not.toBe(0);
    expect(r.stdout).not.toContain(SECRET);
    expect(r.stderr).not.toContain(SECRET);
  });
});

describe("non-OK HTTP → non-zero + server error on stderr, nothing on stdout", () => {
  it("401 Unauthorized", async () => {
    const transport = new FakeTransport().respond(
      401,
      `{"error":"${ERR_UNAUTHORIZED}"}`,
    );
    const r = await run(["create", "--content", "x"], {
      env: fullEnv(),
      transport,
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ERR_UNAUTHORIZED);
    expect(r.stdout).toBe("");
  });

  it("404 Memory not found (fetch)", async () => {
    const transport = new FakeTransport().respond(
      404,
      `{"error":"${ERR_MEMORY_NOT_FOUND}"}`,
    );
    const r = await run(["fetch", "--id", UUID], { env: fullEnv(), transport });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ERR_MEMORY_NOT_FOUND);
    expect(r.stdout).toBe("");
  });

  it("500 internal boom (search)", async () => {
    const transport = new FakeTransport().respond(500, `{"error":"boom"}`);
    const r = await run(["search", "--query", "q"], {
      env: fullEnv(),
      transport,
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("boom");
    expect(r.stdout).toBe("");
  });
});

describe("network failure (no HTTP response)", () => {
  it("exits non-zero with a local openbrain: message on stderr", async () => {
    const transport = new FakeTransport().throw("fetch failed");
    const r = await run(["create", "--content", "x"], {
      env: fullEnv(),
      transport,
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr.startsWith("openbrain:")).toBe(true);
    expect(r.stdout).toBe("");
  });
});

describe("local errors send no request", () => {
  it("unknown command", async () => {
    const r = await run(["bogus"], { env: fullEnv() });
    expect(r.transport.requestCount).toBe(0);
    expect(r.code).not.toBe(0);
    expect(r.stderr.startsWith("openbrain:")).toBe(true);
    expect(r.stdout).toBe("");
  });

  it("fetch with no --id (path param missing)", async () => {
    const r = await run(["fetch"], { env: fullEnv() });
    expect(r.transport.requestCount).toBe(0);
    expect(r.code).not.toBe(0);
    expect(r.stderr.startsWith("openbrain:")).toBe(true);
    expect(r.stdout).toBe("");
  });

  it("create with invalid --metadata JSON", async () => {
    const r = await run(
      ["create", "--content", "x", "--metadata", "{invalid"],
      { env: fullEnv() },
    );
    expect(r.transport.requestCount).toBe(0);
    expect(r.code).not.toBe(0);
    expect(r.stderr.startsWith("openbrain:")).toBe(true);
    expect(r.stdout).toBe("");
  });
});

describe("1:1 route mapping, headers, and body per command", () => {
  it("create → POST {api}/memories with json body, no Authorization", async () => {
    const transport = new FakeTransport().respond(201, "{}");
    const r = await run(["create", "--content", "x"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    const req = r.transport.requests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${BASE}/memories`);
    expect(req.headers["x-api-key"]).toBe(KEY);
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.body).toBe('{"content":"x"}');
  });

  it("fetch → GET {api}/memories/{id}, no body, no content-type", async () => {
    const transport = new FakeTransport().respond(200, "{}");
    const r = await run(["fetch", "--id", UUID], { env: fullEnv(), transport });
    expect(r.transport.requestCount).toBe(1);
    const req = r.transport.requests[0];
    expect(req.method).toBe("GET");
    expect(req.url).toBe(`${BASE}/memories/${UUID}`);
    expect(req.headers["x-api-key"]).toBe(KEY);
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers["content-type"]).toBeUndefined();
    expect(req.body).toBeUndefined();
  });

  it("delete → DELETE {api}/memories/{id}, no body, no content-type", async () => {
    const transport = new FakeTransport().respond(200, "{}");
    const r = await run(["delete", "--id", UUID], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    const req = r.transport.requests[0];
    expect(req.method).toBe("DELETE");
    expect(req.url).toBe(`${BASE}/memories/${UUID}`);
    expect(req.headers["x-api-key"]).toBe(KEY);
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers["content-type"]).toBeUndefined();
    expect(req.body).toBeUndefined();
  });

  it("search → POST {api}/memories/search with json body, no Authorization", async () => {
    const transport = new FakeTransport().respond(200, "{}");
    const r = await run(["search", "--query", "q"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    const req = r.transport.requests[0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${BASE}/memories/search`);
    expect(req.headers["x-api-key"]).toBe(KEY);
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.body).toBe('{"query":"q"}');
  });
});

describe("--id is one URL-encoded segment (no route escape)", () => {
  it("a path-traversal id is encoded and yields the API UUID error, not a 404", async () => {
    const transport = new FakeTransport().respond(
      400,
      `{"error":"${ERR_ID_UUID}"}`,
    );
    const r = await run(["fetch", "--id", "../foo"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    const req = r.transport.requests[0];
    // The slash is encoded (%2F) so the id is a single path segment under
    // /memories/ — it can never become /v1/foo (a wrong-route 404). Dots are
    // unreserved, so encodeURIComponent leaves them; only the slash is encoded.
    expect(req.url).toBe(`${BASE}/memories/..%2Ffoo`);
    expect(req.url).not.toMatch(/\/v1\/foo$/);
    // Nothing after /memories/ is a raw path separator.
    expect(req.url.split("/memories/")[1]).toBe("..%2Ffoo");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ERR_ID_UUID);
    expect(r.stdout).toBe("");
  });

  it("a valid UUID is sent unchanged (encoding is a no-op on hex+hyphens)", async () => {
    const transport = new FakeTransport().respond(200, "{}");
    const r = await run(["fetch", "--id", UUID], { env: fullEnv(), transport });
    const req = r.transport.requests[0];
    expect(req.url).toBe(`${BASE}/memories/${UUID}`);
  });
});

describe("redirects are not followed; the key is never re-sent", () => {
  it("a 302 is surfaced as non-OK with exactly one request to the original host", async () => {
    const transport = new FakeTransport().respond(302, "", {
      Location: "https://evil.example/steal",
    });
    const r = await run(["create", "--content", "x"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    const req = r.transport.requests[0];
    expect(req.url.startsWith(BASE)).toBe(true);
    for (const sent of r.transport.requests) {
      expect(sent.url).not.toContain("evil.example");
    }
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("Request failed with 302");
    expect(r.stdout).toBe("");
  });
});

describe("success prints the API body verbatim + a single trailing newline", () => {
  it("byte-for-byte, no re-serialization / key sort / pretty-print", async () => {
    const body =
      '{"z":1, "a":2,\n"msg":"héllo 🧠 → ok","nested":{"x":[1,2,3]}}';
    const transport = new FakeTransport().respond(200, body);
    const r = await run(["fetch", "--id", UUID], { env: fullEnv(), transport });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(body + "\n");
    expect(r.stderr).toBe("");
  });
});

describe("help is local, exits 0, and goes to stdout", () => {
  it("openbrain --help with no env/flags", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.transport.requestCount).toBe(0);
    expect(r.stderr).toBe("");
    for (const cmd of ["create", "fetch", "delete", "search"]) {
      expect(r.stdout).toContain(cmd);
    }
    for (const token of [
      "--api-key",
      "--base-url",
      "OPENBRAIN_API_KEY",
      "OPENBRAIN_BASE_URL",
    ]) {
      expect(r.stdout).toContain(token);
    }
  });

  it("openbrain -h works identically", async () => {
    const r = await run(["-h"]);
    expect(r.code).toBe(0);
    expect(r.transport.requestCount).toBe(0);
    expect(r.stdout).toContain("create");
  });

  it("openbrain create --help shows required vs optional + value types + an example", async () => {
    const r = await run(["create", "--help"]);
    expect(r.code).toBe(0);
    expect(r.transport.requestCount).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("--content");
    expect(r.stdout).toContain("required");
    expect(r.stdout).toContain("Example");
  });

  it("each command has per-command help with no request", async () => {
    for (const cmd of ["fetch", "delete", "search"]) {
      const r = await run([cmd, "--help"]);
      expect(r.code).toBe(0);
      expect(r.transport.requestCount).toBe(0);
      expect(r.stdout).toContain(cmd);
    }
  });
});

describe("unknown command vs no-args stream discipline", () => {
  it("unknown command → non-zero, openbrain: + usage on stderr, no request", async () => {
    const r = await run(["bogus"], { env: fullEnv() });
    expect(r.code).not.toBe(0);
    expect(r.transport.requestCount).toBe(0);
    expect(r.stderr.startsWith("openbrain:")).toBe(true);
    expect(r.stderr).toContain("create");
    expect(r.stdout).toBe("");
  });

  it("bare no-args → exit 0, usage on stdout, no openbrain: prefix", async () => {
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.transport.requestCount).toBe(0);
    expect(r.stdout).toContain("create");
    expect(r.stdout.startsWith("openbrain:")).toBe(false);
    expect(r.stderr).toBe("");
  });
});

describe("a flag overrides the matching env var", () => {
  it("--api-key overrides OPENBRAIN_API_KEY", async () => {
    const transport = new FakeTransport().respond(201, "{}");
    const r = await run(["create", "--content", "x", "--api-key", "flag-key"], {
      env: { OPENBRAIN_API_KEY: "env-key", OPENBRAIN_BASE_URL: BASE },
      transport,
    });
    expect(r.transport.requests[0].headers["x-api-key"]).toBe("flag-key");
  });

  it("--base-url overrides OPENBRAIN_BASE_URL", async () => {
    const transport = new FakeTransport().respond(200, "{}");
    const r = await run(
      ["fetch", "--id", UUID, "--base-url", "https://flag.example/v1"],
      {
        env: {
          OPENBRAIN_API_KEY: KEY,
          OPENBRAIN_BASE_URL: "https://env.example/v1",
        },
        transport,
      },
    );
    expect(r.transport.requests[0].url).toBe(
      `https://flag.example/v1/memories/${UUID}`,
    );
  });
});

describe("--base-url is used verbatim (no /v1 detection)", () => {
  it("a base URL without /v1 is used as-is and fails at the API", async () => {
    const transport = new FakeTransport().respond(
      404,
      `{"error":"${ERR_NOT_FOUND}"}`,
    );
    const r = await run(["create", "--content", "x"], {
      env: { OPENBRAIN_API_KEY: KEY, OPENBRAIN_BASE_URL: "https://host" },
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    expect(r.transport.requests[0].url).toBe("https://host/memories");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ERR_NOT_FOUND);
    expect(r.stdout).toBe("");
  });

  it("trailing slashes are stripped, then used verbatim", async () => {
    const transport = new FakeTransport().respond(200, "{}");
    const r = await run(["fetch", "--id", UUID], {
      env: {
        OPENBRAIN_API_KEY: KEY,
        OPENBRAIN_BASE_URL: "https://h/v1///",
      },
      transport,
    });
    expect(r.transport.requests[0].url).toBe(`https://h/v1/memories/${UUID}`);
  });
});

describe("--metadata local-parse vs forward boundary", () => {
  it("invalid JSON is a local error and sends no request", async () => {
    const r = await run(
      ["create", "--content", "x", "--metadata", "{invalid"],
      { env: fullEnv() },
    );
    expect(r.transport.requestCount).toBe(0);
    expect(r.code).not.toBe(0);
    expect(r.stderr.startsWith("openbrain:")).toBe(true);
    expect(r.stdout).toBe("");
  });

  it("valid JSON that is not an object ([]) is forwarded; API rejects", async () => {
    const transport = new FakeTransport().respond(
      400,
      `{"error":"${ERR_METADATA_OBJECT}"}`,
    );
    const r = await run(["create", "--content", "x", "--metadata", "[]"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    expect(r.transport.requests[0].body).toContain('"metadata":[]');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ERR_METADATA_OBJECT);
    expect(r.stdout).toBe("");
  });

  it("valid JSON that is not an object (42) is forwarded; API rejects", async () => {
    const transport = new FakeTransport().respond(
      400,
      `{"error":"${ERR_METADATA_OBJECT}"}`,
    );
    const r = await run(["create", "--content", "x", "--metadata", "42"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    expect(r.transport.requests[0].body).toContain('"metadata":42');
    expect(r.stderr).toContain(ERR_METADATA_OBJECT);
  });
});

describe("--limit / --threshold are forwarded (not locally rejected)", () => {
  it("--limit abc is forwarded and the API rejects", async () => {
    const transport = new FakeTransport().respond(
      400,
      `{"error":"${ERR_LIMIT_NUMBER}"}`,
    );
    const r = await run(["search", "--query", "q", "--limit", "abc"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ERR_LIMIT_NUMBER);
    expect(r.stdout).toBe("");
  });

  it("--limit Infinity is forwarded as a raw string and the API rejects", async () => {
    const transport = new FakeTransport().respond(
      400,
      `{"error":"${ERR_LIMIT_NUMBER}"}`,
    );
    const r = await run(["search", "--query", "q", "--limit", "Infinity"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    expect(r.transport.requests[0].body).toContain('"limit":"Infinity"');
    expect(r.stderr).toContain(ERR_LIMIT_NUMBER);
  });

  it("--threshold 5 is forwarded and the API rejects (range)", async () => {
    const transport = new FakeTransport().respond(
      400,
      `{"error":"${ERR_THRESHOLD_RANGE}"}`,
    );
    const r = await run(["search", "--query", "q", "--threshold", "5"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requestCount).toBe(1);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ERR_THRESHOLD_RANGE);
    expect(r.stdout).toBe("");
  });
});

describe("missing --content / --query is forwarded; the API rejects", () => {
  it("create without --content", async () => {
    const transport = new FakeTransport().respond(
      400,
      `{"error":"${ERR_CONTENT_EMPTY}"}`,
    );
    const r = await run(["create"], { env: fullEnv(), transport });
    expect(r.transport.requestCount).toBe(1);
    expect(r.transport.requests[0].body).toBe("{}");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ERR_CONTENT_EMPTY);
    expect(r.stdout).toBe("");
  });

  it("search without --query", async () => {
    const transport = new FakeTransport().respond(
      400,
      `{"error":"${ERR_QUERY_EMPTY}"}`,
    );
    const r = await run(["search"], { env: fullEnv(), transport });
    expect(r.transport.requestCount).toBe(1);
    expect(r.transport.requests[0].body).toBe("{}");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(ERR_QUERY_EMPTY);
    expect(r.stdout).toBe("");
  });
});

describe("non-OK responses without an error body", () => {
  it("an empty body → Request failed with <status>", async () => {
    const transport = new FakeTransport().respond(502, "");
    const r = await run(["create", "--content", "x"], {
      env: fullEnv(),
      transport,
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("Request failed with 502");
    expect(r.stdout).toBe("");
  });

  it("proxy HTML → Request failed with <status>", async () => {
    const transport = new FakeTransport().respond(
      502,
      "<html>Bad Gateway</html>",
    );
    const r = await run(["create", "--content", "x"], {
      env: fullEnv(),
      transport,
    });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("Request failed with 502");
    expect(r.stdout).toBe("");
  });

  it("JSON without an error field → Request failed with <status>", async () => {
    const transport = new FakeTransport().respond(500, '{"ok":false}');
    const r = await run(["create", "--content", "x"], {
      env: fullEnv(),
      transport,
    });
    expect(r.stderr).toContain("Request failed with 500");
  });

  it("JSON with a non-string error → Request failed with <status>", async () => {
    const transport = new FakeTransport().respond(500, '{"error":42}');
    const r = await run(["create", "--content", "x"], {
      env: fullEnv(),
      transport,
    });
    expect(r.stderr).toContain("Request failed with 500");
  });
});

describe("Missing value for --<key> fixed string", () => {
  it("--api-key with no value", async () => {
    const r = await run(["--api-key"], { env: fullEnv() });
    expect(r.transport.requestCount).toBe(0);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toBe("openbrain: Missing value for --api-key\n");
    expect(r.stdout).toBe("");
  });

  it("--base-url with no value", async () => {
    const r = await run(["--base-url"], { env: fullEnv() });
    expect(r.transport.requestCount).toBe(0);
    expect(r.stderr).toBe("openbrain: Missing value for --base-url\n");
  });
});

describe("success stream discipline", () => {
  it("stdout is exactly body + newline and stderr is empty", async () => {
    const body = '{"memory":{"id":"abc","content":"hi"}}';
    const transport = new FakeTransport().respond(201, body);
    const r = await run(["create", "--content", "hi"], {
      env: fullEnv(),
      transport,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(body + "\n");
    expect(r.stderr).toBe("");
  });
});

describe("--key=value is accepted identically to --key value", () => {
  it("content via = form", async () => {
    const transport = new FakeTransport().respond(201, "{}");
    const r = await run(["create", "--content=x"], {
      env: fullEnv(),
      transport,
    });
    expect(r.transport.requests[0].body).toBe('{"content":"x"}');
  });

  it("--api-key=flag overrides env", async () => {
    const transport = new FakeTransport().respond(201, "{}");
    const r = await run(["create", "--content=x", "--api-key=flag-key"], {
      env: { OPENBRAIN_API_KEY: "env-key", OPENBRAIN_BASE_URL: BASE },
      transport,
    });
    expect(r.transport.requests[0].headers["x-api-key"]).toBe("flag-key");
  });
});

describe("package.json structural requirements", () => {
  function readPkg(): {
    name: string;
    description: string;
    bin: Record<string, string>;
  } {
    const text = readFileSync(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    return JSON.parse(text);
  }

  it("exposes the openbrain bin (not openbrain-cli)", () => {
    const pkg = readPkg();
    expect(pkg.bin.openbrain).toBeDefined();
    expect(pkg.bin["openbrain-cli"]).toBeUndefined();
  });

  it("is the OpenBrain CLI package", () => {
    const pkg = readPkg();
    expect(pkg.name).toBe("@snaveevans/openbrain-cli");
    expect(pkg.description).toContain("OpenBrain CLI");
  });
});
