import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";

interface ExcalidrawData {
  appState: Record<string, unknown>;
  elements: unknown[];
  files: Record<string, unknown>;
}

declare global {
  interface Window {
    __hubtheConvertMermaid?: (mermaidSyntax: string) => Promise<ExcalidrawData>;
  }
}

async function convertMermaidToExcalidraw(
  mermaidSyntax: string,
): Promise<ExcalidrawData> {
  const { elements: rawElements, files = {} } =
    await parseMermaidToExcalidraw(mermaidSyntax, {
      themeVariables: { fontSize: "25px" },
    });

  return {
    appState: {
      exportBackground: true,
      exportScale: 1,
      exportWithDarkMode: false,
      isBindingEnabled: true,
      isLoading: false,
      name: "Mermaid diagram",
      theme: "light",
      viewBackgroundColor: "#ffffff",
      viewModeEnabled: false,
      zenModeEnabled: false,
      zoom: { value: 1 },
    },
    elements: convertToExcalidrawElements(rawElements),
    files: files as Record<string, unknown>,
  };
}

window.__hubtheConvertMermaid = convertMermaidToExcalidraw;

export {};
