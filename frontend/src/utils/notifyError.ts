// IPC 错误统一通知（B14）：console 留痕（开发可查）+ antd message 用户可见（生产不黑盒）。
// 按 code 分流用户文案：业务错（NotFound/InvalidInput/Conflict/PreconditionFailed）显示具体 message（可操作），
// 系统错（Db/Io/Serde/Secrets/Internal）统一「失败请重试」（不暴露底层细节给用户）。
// 替代散落的 `message.error(\`${e}\`)` 直显——后者在 B1 后会显示 [object Object]（reject 已是 {code, message} 对象）。
//
// 用法：替代散落的 `message.error(\`xxx：${e}\`)`：
//   .catch((e) => { notifyError("加载反链", e); setX([]); })
import { message } from "antd";
import type { AppErrorCode } from "../types";

/** 错误统一通知：console 留痕 + 用户 toast。tag 标场景（如「加载反链」），e 通常是 api 封装抛出的 AppError。 */
export function notifyError(tag: string, e: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[${tag}]`, e);
  message.error(userMessageFor(tag, e));
}

/** 按 code 分流用户可见文案：业务错显示具体 message（可操作），系统错统一简短提示。 */
function userMessageFor(tag: string, e: unknown): string {
  const { code, msg } = parseError(e);
  switch (code) {
    case "NotFound":
      return msg || "未找到";
    case "InvalidInput":
    case "Conflict":
    case "PreconditionFailed":
      return msg || `${tag}失败`;
    case "Secrets":
      return "key 读取失败，请检查系统钥匙串";
    case "Db":
    case "Io":
    case "Serde":
    case "Internal":
    default:
      return `${tag}失败，请重试`;
  }
}

/** 把任意 e 解析成 {code, msg}（对齐后端 AppError 形态 {code, message}）。 */
function parseError(e: unknown): { code: AppErrorCode; msg: string } {
  if (e !== null && typeof e === "object" && "code" in e && "message" in e) {
    const code = (e as { code: unknown }).code;
    const msg = String((e as { message: unknown }).message);
    return {
      code: typeof code === "string" ? (code as AppErrorCode) : "Internal",
      msg,
    };
  }
  if (e instanceof Error) return { code: "Internal", msg: e.message };
  if (typeof e === "string") return { code: "Internal", msg: e };
  return { code: "Internal", msg: String(e) };
}
