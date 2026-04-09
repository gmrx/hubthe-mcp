export interface ExcalidrawData {
  appState: Record<string, unknown>;
  elements: unknown[];
  files: Record<string, unknown>;
}

interface LexicalTextNode {
  detail: 0;
  format: 0;
  mode: "normal";
  style: "";
  text: string;
  type: "text";
  version: 1;
}

interface LexicalParagraphNode {
  children: Array<LexicalTextNode | LexicalExcalidrawNode>;
  direction: "ltr";
  format: "";
  indent: 0;
  type: "paragraph";
  version: 1;
  textFormat: 0;
  textStyle: "";
}

interface LexicalExcalidrawNode {
  type: "excalidraw";
  version: 1;
  data: string;
}

function createTextNode(text: string): LexicalTextNode {
  return {
    detail: 0,
    format: 0,
    mode: "normal",
    style: "",
    text,
    type: "text",
    version: 1,
  };
}

function createParagraphNode(
  children: Array<LexicalTextNode | LexicalExcalidrawNode>,
): LexicalParagraphNode {
  return {
    children,
    direction: "ltr",
    format: "",
    indent: 0,
    type: "paragraph",
    version: 1,
    textFormat: 0,
    textStyle: "",
  };
}

function createTextParagraphs(text: string): LexicalParagraphNode[] {
  return text
    .split("\n")
    .map((line) =>
      createParagraphNode(line ? [createTextNode(line)] : []),
    );
}

export function buildCommentLexicalJson(parts: {
  text?: string;
  diagram?: ExcalidrawData;
}): string {
  const children: Array<LexicalParagraphNode | LexicalExcalidrawNode> = [];

  if (parts.text?.trim()) {
    children.push(...createTextParagraphs(parts.text.trim()));
  }

  if (parts.diagram) {
    children.push({
      type: "excalidraw",
      version: 1,
      data: JSON.stringify(parts.diagram),
    });
  }

  if (children.length === 0) {
    children.push(createParagraphNode([]));
  }

  return JSON.stringify({
    root: {
      children,
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });
}
