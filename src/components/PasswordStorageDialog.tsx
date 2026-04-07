import { useEffect, useState } from "react";
import type { PasswordStorageMode } from "../lib/connectionProfiles";

type PasswordStorageDialogProps = {
  isOpen: boolean;
  mode: PasswordStorageMode;
  onConfirm: (mode: PasswordStorageMode) => void;
  onClose: () => void;
};

const OPTIONS: Array<{
  mode: PasswordStorageMode;
  title: string;
  description: string;
}> = [
  {
    mode: "none",
    title: "不保存密码",
    description: "密码只用于这次输入，保存配置时会直接丢弃。"
  },
  {
    mode: "session",
    title: "仅当前会话",
    description: "密码放在当前应用会话里，重启应用后自动失效。"
  },
  {
    mode: "local",
    title: "保存到本地",
    description: "密码跟连接配置一起写入本地存储，下次可直接带出。"
  }
];

export default function PasswordStorageDialog({
  isOpen,
  mode,
  onConfirm,
  onClose
}: PasswordStorageDialogProps) {
  const [selectedMode, setSelectedMode] = useState<PasswordStorageMode>(mode);

  useEffect(() => {
    if (isOpen) {
      setSelectedMode(mode);
    }
  }, [isOpen, mode]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop">
      <section className="glass-panel connect-dialog action-dialog password-storage-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <div>
            <p className="eyebrow">密码策略</p>
            <h2>选择密码保存方式</h2>
          </div>
          <span className={`status-pill ${selectedMode === "local" ? "live" : ""}`}>
            {selectedMode === "none" ? "不保存" : selectedMode === "session" ? "本会话" : "本地"}
          </span>
        </div>

        <div className="password-storage-options">
          {OPTIONS.map((option) => (
            <button
              key={option.mode}
              className={`password-storage-option ${selectedMode === option.mode ? "active" : ""}`}
              onClick={() => setSelectedMode(option.mode)}
            >
              <strong>{option.title}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>

        <div className="form-alert">
          <strong>本地保存提醒</strong>
          <span>“保存到本地”会把密码直接存进本机存储，不做加密。图省事可以，用公共电脑就别犯浑。</span>
        </div>

        <div className="action-row">
          <button className="primary-button" onClick={() => onConfirm(selectedMode)}>
            应用策略
          </button>
          <button className="ghost-button" onClick={onClose}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
