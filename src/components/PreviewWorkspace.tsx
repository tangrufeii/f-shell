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
  editorThemeMode: "aurora" | "light" | "dark";
  previewDisplayMode: "edit" | "read";
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdownToHtml(content: string): string {
  const lines = content.replace(/\r/g, "").split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let inList = false;
  let paragraphLines: string[] = [];

  function flushParagraph() {
    if (!paragraphLines.length) {
      return;
    }

    html.push(`<p>${applyInlineMarkdown(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  }

  function closeList() {
    if (!inList) {
      return;
    }

    html.push("</ul>");
    inList = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      closeList();
      if (inCodeBlock) {
        html.push("</code></pre>");
        inCodeBlock = false;
      } else {
        html.push("<pre><code>");
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${applyInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${applyInlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    const listMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${applyInlineMarkdown(listMatch[1])}</li>`);
      continue;
    }

    closeList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  closeList();
  if (inCodeBlock) {
    html.push("</code></pre>");
  }

  return html.join("");
}

export function PreviewWorkspaceActions({
  preview,
  previewDisplayMode,
  isSaving,
  saveFeedback,
  onTogglePreviewDisplayMode,
  onPasteText,
  onSave
}: Pick<
  PreviewWorkspaceProps,
  "preview" | "previewDisplayMode" | "isSaving" | "saveFeedback" | "onPasteText" | "onSave"
> & {
  onTogglePreviewDisplayMode: () => void;
}) {
  const saveFeedbackClass = saveFeedback ? `status-pill save-feedback-pill ${saveFeedback.tone}` : "status-pill save-feedback-pill";
  const isReadOnly = Boolean(preview?.readonly);
  const canToggleMarkdownMode = preview?.kind === "Text" && preview.language === "markdown";

  return (
    <>
      {canToggleMarkdownMode ? (
        <button className="ghost-button small" onClick={onTogglePreviewDisplayMode}>
          {previewDisplayMode === "read" ? "源码模式" : "阅读模式"}
        </button>
      ) : null}
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
  editorThemeMode,
  previewDisplayMode,
  isActive,
  accessNotice,
  selectedEntry,
  selectionPath,
  onSave,
  onEditorChange,
  onEditorMount
}: Omit<PreviewWorkspaceProps, "isSaving" | "saveFeedback" | "onPasteText">) {
  const isMarkdownReadMode = preview?.kind === "Text" && preview.language === "markdown" && previewDisplayMode === "read";
  const previewSummaryPath = selectionPath || selectedEntry?.path || preview?.path || "--";

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
        {preview.truncated ? (
          <div className="preview-access-banner warning">
            <strong>当前只加载了文件前部内容</strong>
            <span>
              远端文件总大小是 {preview.size.toLocaleString()} bytes，当前预览只读取了前 {preview.previewBytes.toLocaleString()} bytes，
              这样做是为了避免大文件直接把预览区拖死。
            </span>
          </div>
        ) : null}
        {isMarkdownReadMode ? (
          <div className="markdown-preview-shell">
            <div className="markdown-preview-body" dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(editorContent) }} />
          </div>
        ) : (
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
                themeMode={editorThemeMode}
                onChange={onEditorChange}
                onMount={onEditorMount}
                onSave={onSave}
                path={preview.path}
                readOnly={preview.readonly}
                value={editorContent}
              />
            </Suspense>
          </div>
        )}
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
    <div className="preview-content-stack">
      <div className="empty-state preview-state preview-rich-state">
        <strong>{preview?.path ?? "选择一个远端文件"}</strong>
        <p>
          {preview
            ? preview.kind === "Binary"
              ? `文件 ${previewSummaryPath} 是二进制内容，当前不会强行按文本打开，省得把内容和性能一起搞炸。`
              : preview.kind === "Pdf"
                ? `文件 ${previewSummaryPath} 是 PDF，当前版本还没接内嵌阅读器。`
                : `当前文件类型为 ${preview.kind}。`
            : "点左边文件树里的文件，这里会切到预览页签并显示真实内容。"}
        </p>
        {preview ? (
          <div className="preview-facts-grid">
            <div className="preview-fact-card">
              <span>文件类型</span>
              <strong>{preview.kind}</strong>
            </div>
            <div className="preview-fact-card">
              <span>文件大小</span>
              <strong>{preview.size.toLocaleString()} bytes</strong>
            </div>
            <div className="preview-fact-card wide">
              <span>处理建议</span>
              <strong>
                {preview.kind === "Pdf"
                  ? "当前建议先下载到本地，再交给系统 PDF 阅读器打开。"
                  : preview.kind === "Binary"
                    ? "二进制文件继续保持只读说明最稳，避免误判编码后把内容搞花。"
                    : "这个类型暂时没有专门阅读器，后续再补针对性预览。"}
              </strong>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
