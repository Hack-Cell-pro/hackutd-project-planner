import { describe, expect, it } from "vitest";
import { ConnectionId } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import spacetimedb, { init } from "./src/index";

const hex = (n: number) => n.toString(16).padStart(64, "0");

describe("probe", () => {
  it("two jwt payloads give two senders", () => {
    const test = createModuleTestHarness(spacetimedb, { init });
    const a = TestAuth.fromJwtPayload(JSON.stringify({ iss: "test", sub: hex(1) }), new ConnectionId(1n));
    const b = TestAuth.fromJwtPayload(JSON.stringify({ iss: "test", sub: hex(2) }), new ConnectionId(2n));
    let sa = "", sb = "";
    test.withReducerTx(a, (ctx: any) => { sa = String(ctx.sender); });
    test.withReducerTx(b, (ctx: any) => { sb = String(ctx.sender); });
    console.log("senderA", sa, "| senderB", sb, "| differ:", sa !== sb);
    expect(sa).not.toBe(sb);
  });
});
