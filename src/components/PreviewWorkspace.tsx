import { Suspense, lazy } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { FilePreview, RemoteEntry } from "../types";

const LazyCodeEditor = lazy(() => import("./CodeEditorPane"));

type SaveFeedback = {
  tone: "success" | "error";
  message: string;
};

type PreviewAccessNotice = {
  tone: "warning" | "error";
  title: string;
  message: string;
};

type PreviewWorkspaceProps = {
  preview: FilePreview | null;
  previewError: string;
  editorContent: string;
  editorLanguage: string;
  isActive: boolean;
  isSaving: boolean;
  accessNotice: PreviewAccessNotice | null;
  saveFeedback: SaveFeedback | null;
  selectedEntry: RemoteEntry | null;
  selectionPath: string;
  onPasteText: () => void;
  onSave: () => void;
  onEditorChange: (value: string) => void;
  onEditorMount: (editor: MonacoEditor.IStandaloneCodeEditor) => void;
};

export function PreviewWorkspaceActions({
  preview,
  isSaving,
  saveFeedback,
  onPasteText,
  onSave
}: Pick<PreviewWorkspaceProps, "preview" | "isSaving" | "saveFeedback" | "onPasteText" | "onSave">) {
  const saveFeedbackClass = saveFeedback ? `status-pill save-feedback-pill ${saveFeedback.tone}` : "status-pill save-feedback-pill";
  const isReadOnly = Boolean(preview?.readonly);

  return (
    <>
      <button className="ghost-button small" disabled={!preview || preview.kind !== "Text" || isReadOnly} onClick={onPasteText}>
        贴文本
      </button>
      <button
        className="primary-button small-primary"
        disabled={!preview || preview.kind !== "Text" || isSaving || isReadOnly}
        onClick={onSave}
        title={isReadOnly ? "当前文件为只读，不能保存" : "Ctrl + S"}
      >
        {isSaving ? "保存中..." : "保存"}
      </button>
      {saveFeedback ? <span className={saveFeedbackClass}>{saveFeedback.message}</span> : null}
    </>
  );
}

export default function PreviewWorkspace({
  preview,
  previewError,
  editorContent,
  editorLanguage,
  isActive,
  accessNotice,
  selectedEntry,
  selectionPath,
  onSave,
  onEditorChange,
  onEditorMount
}: Omit<PreviewWorkspaceProps, "isSaving" | "saveFeedback" | "onPasteText">) {
  if (preview?.kind === "Text") {
    if (!isActive) {
      return (
        <div className="editor-loading">
          <strong>预览已就绪</strong>
          <p>切到预览页签时再加载编辑器，避免后台白白吞资源。</p>
        </div>
      );
    }

    return (
      <div className="preview-content-stack">
        {accessNotice ? (
          <div className={`preview-access-banner ${accessNotice.tone}`}>
            <strong>{accessNotice.title}</strong>
            <span>{accessNotice.message}</span>
          </div>
        ) : null}
        <div className="editor-shell">
          <Suspense
            fallback={
              <div className="editor-loading">
                <strong>编辑器加载中</strong>
                <p>正在初始化代码编辑器和语法高亮。</p>
              </div>
            }
          >
            <LazyCodeEditor
              className="editor"
              language={editorLanguage}
              onChange={onEditorChange}
              onMount={onEditorMount}
              onSave={onSave}
              path={preview.path}
              readOnly={preview.readonly}
              value={editorContent}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  if (preview?.kind === "Image" && preview.content) {
    return (
      <div className="preview-content-stack">
        {accessNotice ? (
          <div className={`preview-access-banner ${accessNotice.tone}`}>
            <strong>{accessNotice.title}</strong>
            <span>{accessNotice.message}</span>
          </div>
        ) : null}
        <div className="image-preview-shell">
          <img className="image-preview" src={preview.content} alt={preview.path} />
        </div>
      </div>
    );
  }

  if (previewError) {
    return (
      <div className="empty-state preview-state error-state">
        <strong>无法预览</strong>
        <p>{previewError}</p>
      </div>
    );
  }

  return (
    <div className="empty-state preview-state">
      <strong>{preview?.path ?? "选择一个远端文件"}</strong>
      <p>
        {preview
          ? preview.kind === "Binary"
            ? `文件 ${selectionPath || selectedEntry?.path || preview.path} 是二进制内容，暂不支持文本预览。`
            : `当前文件类型为 ${preview.kind}。`
          : "点左边文件树里的文件，这里会切到预览页签并显示真实内容。"}
      </p>
    </div>
  );
}
