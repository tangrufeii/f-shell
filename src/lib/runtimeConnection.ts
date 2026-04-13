const RUNTIME_DISCONNECT_KEYWORDS = [
  "当前没有活动 ssh 会话",
  "当前没有活动连接",
  "请先登录 ssh",
  "终端会话已经断了",
  "ssh 会话已断开",
  "连接可能已经断开",
  "会话已断开",
  "网络中断",
  "远端 shell 退出",
  "tcp 连接",
  "broken pipe",
  "connection reset",
  "connection aborted",
  "connection refused",
  "connection timed out",
  "socket disconnected",
  "channel closed",
  "session closed",
  "not connected",
  "eof",
  "timed out waiting",
  "failed sending data to the peer"
] as const;

export function isLikelyRuntimeDisconnectMessage(message: string): boolean {
  const normalized = message.trim().toLocaleLowerCase();
  if (!normalized) {
    return false;
  }

  return RUNTIME_DISCONNECT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}
