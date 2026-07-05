import { describe, it, expect } from "vitest";
import { decideApiKeyAction } from "./aiSettings";

// B4 keychain 解耦契约：saveAiSettings 的 key 决策——「输入新 key→换」「留空→保留旧（不清）」。
// 这些用例固化契约防回退（尤其「已配 key 留空保存」必须保留，不能误清除）。

describe("decideApiKeyAction", () => {
  it("非空 key → shouldSetKey=true + 原样 key", () => {
    expect(decideApiKeyAction("sk-xxx")).toEqual({ shouldSetKey: true, key: "sk-xxx" });
  });

  it("首尾空白 → trim 后非空仍写入（key 去空白）", () => {
    expect(decideApiKeyAction("  sk-spaces  ")).toEqual({
      shouldSetKey: true,
      key: "sk-spaces",
    });
  });

  it("空串 → 不写（保留旧 key）", () => {
    expect(decideApiKeyAction("")).toEqual({ shouldSetKey: false, key: "" });
  });

  it("纯空白 → trim 后空，不写", () => {
    expect(decideApiKeyAction("   ")).toEqual({ shouldSetKey: false, key: "" });
  });

  it("undefined → 不写（Form api_key 字段未填）", () => {
    expect(decideApiKeyAction(undefined)).toEqual({ shouldSetKey: false, key: "" });
  });

  it("null → 不写", () => {
    expect(decideApiKeyAction(null)).toEqual({ shouldSetKey: false, key: "" });
  });

  it("key 为 '0' → 仍写入（用 length 判定非 truthy，防未来误改为 if(key)）", () => {
    expect(decideApiKeyAction("0")).toEqual({ shouldSetKey: true, key: "0" });
  });
});
