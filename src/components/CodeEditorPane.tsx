import { useEffect, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { editor as MonacoEditor } from "monaco-editor/esm/vs/editor/editor.api";

loader.config({ monaco });

const loadedEditorLanguages = new Set<string>();

const languageLoaders: Partial<Record<string, () => Promise<unknown>>> = {
  css: () => import("monaco-editor/esm/vs/basic-languages/css/css.contribution"),
  html: () => import("monaco-editor/esm/vs/basic-languages/html/html.contribution"),
  ini: () => import("monaco-editor/esm/vs/basic-languages/ini/ini.contribution"),
  javascript: () => import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution"),
  json: () => import("monaco-editor/esm/vs/language/json/monaco.contribution"),
  markdown: () => import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution"),
  rust: () => import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution"),
  shell: () => import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution"),
  typescript: () => import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution"),
  xml: () => import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution"),
  yaml: () => import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution")
};

type CodeEditorPaneProps = {
  className?: string;
  language: string;
  themeMode: "aurora" | "light" | "dark";
  onChange: (value: string) => void;
  onMount: (editor: MonacoEditor.IStandaloneCodeEditor) => void;
  onSave: () => void | Promise<void>;
  path: string;
  readOnly?: boolean;
  value: string;
};

async function ensureEditorLanguage(language: string) {
  if (loadedEditorLanguages.has(language)) {
    return;
  }

  const loader = languageLoaders[language];
  if (!loader) {
    loadedEditorLanguages.add(language);
    return;
  }

  await loader();
  loadedEditorLanguages.add(language);
}

function handleEditorBeforeMount(monacoInstance: Monaco) {
  monacoInstance.editor.defineTheme("fshell-editor-aurora", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#111a2f",
      "editor.foreground": "#f8fbff",
      "editorLineNumber.foreground": "#6f86ad",
      "editorLineNumber.activeForeground": "#dce9ff",
      "editor.selectionBackground": "#29497c",
      "editor.inactiveSelectionBackground": "#1a3156",
      "editorCursor.foreground": "#ffffff"
    }
  });
  monacoInstance.editor.defineTheme("fshell-editor-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#f7f8fb",
      "editor.foreground": "#152033",
      "editorLineNumber.foreground": "#8b95a8",
      "editorLineNumber.activeForeground": "#44516a",
      "editor.selectionBackground": "#d9e6ff",
      "editor.inactiveSelectionBackground": "#e7eefb",
      "editorCursor.foreground": "#1f2a3d"
    }
  });
  monacoInstance.editor.defineTheme("fshell-editor-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0d1117",
      "editor.foreground": "#e6edf3",
      "editorLineNumber.foreground": "#6b7686",
      "editorLineNumber.activeForeground": "#c7d1db",
      "editor.selectionBackground": "#233a5b",
      "editor.inactiveSelectionBackground": "#1a2840",
      "editorCursor.foreground": "#ffffff"
    }
  });
}

export default function CodeEditorPane({
  className = "",
  language,
  themeMode,
  onChange,
  onMount,
  onSave,
  path,
  readOnly = false,
  value
}: CodeEditorPaneProps) {
  const [isLanguageReady, setIsLanguageReady] = useState(() => loadedEditorLanguages.has(language));
  const mountedLanguageRef = useRef(language);

  useEffect(() => {
    mountedLanguageRef.current = language;
    setIsLanguageReady(loadedEditorLanguages.has(language));

    void ensureEditorLanguage(language)
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        if (mountedLanguageRef.current === language) {
          setIsLanguageReady(true);
        }
      });
  }, [language]);

  if (!isLanguageReady) {
    return (
      <div className={`editor-loading ${className}`.trim()}>
        <strong>编辑器准备中</strong>
        <p>正在按需加载 {language} 语法支持。</p>
      </div>
    );
  }

  return (
    <Editor
      beforeMount={handleEditorBeforeMount}
      className={className}
      height="100%"
      language={language}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      onMount={(editor, monacoInstance) => {
        editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
          void onSave();
        });
        onMount(editor);
      }}
      options={{
        automaticLayout: true,
        contextmenu: true,
        fontFamily: '"SF Mono", "JetBrains Mono", Consolas, monospace',
        fontLigatures: true,
        fontSize: 14,
        lineNumbers: "on",
        minimap: { enabled: false },
        padding: { top: 16, bottom: 16 },
        readOnly,
        roundedSelection: true,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 2,
        wordWrap: "on"
      }}
      path={path}
      theme={`fshell-editor-${themeMode}`}
      value={value}
    />
  );
}
