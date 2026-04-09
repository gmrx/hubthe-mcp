import type {
  FormattedTask,
  RawIssue,
  IssueDetailResponse,
  TaskComment,
} from "./types.js";

export function extractLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (obj.title ?? obj.value ?? obj.name ?? null) as string | null;
  }
  return null;
}

function extractAssignees(value: unknown): string[] {
  const assignees: string[] = [];
  if (!Array.isArray(value)) return assignees;

  for (const assignee of value) {
    if (assignee && typeof assignee === "object" && "name" in assignee) {
      assignees.push(String((assignee as { name: unknown }).name));
    }
  }

  return assignees;
}

function extractTaskNumber(value: unknown): string | null {
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (obj.value as string) ?? null;
  }
  return null;
}

function buildFormattedTask(
  guid: string,
  bySlug: Map<string, unknown>,
  parentGuid: string | null,
  childrenCount: number | null,
  extraSlugs?: string[],
): FormattedTask {
  const task: FormattedTask = {
    guid,
    number: extractTaskNumber(bySlug.get("нумерация-задач")),
    title: extractLabel(bySlug.get("название")),
    description: extractLabel(bySlug.get("описание")),
    status: extractLabel(bySlug.get("статус")),
    priority: extractLabel(bySlug.get("приоритет")),
    sprint: extractLabel(bySlug.get("спринт")),
    assignees: extractAssignees(bySlug.get("исполнители")),
    parent_guid: parentGuid,
    children_count: childrenCount,
  };

  if (extraSlugs) {
    for (const slug of extraSlugs) {
      if (!(slug in task)) {
        task[slug] = extractLabel(bySlug.get(slug));
      }
    }
  }

  return task;
}

export function buildSlugMapFromRawIssue(
  issue: RawIssue,
  fieldMap: Map<string, string>,
): Map<string, unknown> {
  const bySlug = new Map<string, unknown>();
  if (!Array.isArray(issue.custom_fields)) return bySlug;

  for (const cf of issue.custom_fields) {
    const slug = fieldMap.get(cf.guid);
    if (slug) bySlug.set(slug, cf.value);
  }

  return bySlug;
}

function buildSlugMapFromIssueDetail(
  issue: IssueDetailResponse,
): Map<string, unknown> {
  const bySlug = new Map<string, unknown>();
  if (!Array.isArray(issue.custom_fields)) return bySlug;

  for (const cf of issue.custom_fields) {
    if (cf.slug) bySlug.set(cf.slug, cf.value);
  }

  return bySlug;
}

export function formatIssues(
  rawIssues: RawIssue[],
  fieldMap: Map<string, string>,
  extraSlugs?: string[],
): FormattedTask[] {
  const items = Array.isArray(rawIssues) ? rawIssues : [];

  return items.map((issue) =>
    buildFormattedTask(
      issue.guid,
      buildSlugMapFromRawIssue(issue, fieldMap),
      issue.parent_guid,
      issue.children_count,
      extraSlugs,
    ),
  );
}

export function formatIssueDetail(
  issue: IssueDetailResponse,
  extraSlugs?: string[],
): FormattedTask {
  const parentGuid =
    issue.parent && typeof issue.parent === "object"
      ? ((issue.parent.guid as string | undefined) ?? null)
      : null;

  return buildFormattedTask(
    issue.guid,
    buildSlugMapFromIssueDetail(issue),
    parentGuid,
    null,
    extraSlugs,
  );
}

export function normalizeTaskIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function taskMatchesIdentifier(
  taskNumber: string | null,
  taskIdentifier: string,
): boolean {
  if (!taskNumber) return false;

  const normalizedNumber = normalizeTaskIdentifier(taskNumber);
  const normalizedIdentifier = normalizeTaskIdentifier(taskIdentifier);

  if (normalizedNumber === normalizedIdentifier) return true;

  const numberDigits = normalizedNumber.match(/(\d+)$/)?.[1];
  const identifierDigits = normalizedIdentifier.match(/(\d+)$/)?.[1];

  return Boolean(
    numberDigits && identifierDigits && numberDigits === identifierDigits,
  );
}

function describeExcalidrawNode(data: unknown): string {
  if (typeof data !== "string" || !data) {
    return "[diagram]";
  }

  try {
    const parsed = JSON.parse(data) as { elements?: unknown[] };
    const count = Array.isArray(parsed.elements) ? parsed.elements.length : 0;
    return count > 0 ? `[diagram: ${count} elements]` : "[diagram]";
  } catch {
    return "[diagram]";
  }
}

function walkLexicalNodes(
  nodes: unknown[],
  lines: string[],
  images: string[],
): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;

    if (n.type === "text" && typeof n.text === "string") {
      const lastIdx = lines.length - 1;
      if (lastIdx >= 0) {
        lines[lastIdx] += n.text;
      } else {
        lines.push(n.text);
      }
    } else if (n.type === "image") {
      const src = (n.src ?? "") as string;
      if (src) images.push(src);
      lines.push(`[image: ${n.altText ?? src}]`);
    } else if (n.type === "excalidraw") {
      lines.push(describeExcalidrawNode(n.data));
    } else if (n.type === "paragraph" || n.type === "heading") {
      lines.push("");
      if (Array.isArray(n.children)) {
        walkLexicalNodes(n.children, lines, images);
      }
    } else if (Array.isArray(n.children)) {
      walkLexicalNodes(n.children, lines, images);
    }
  }
}

export function extractLexicalContent(raw: string): {
  text: string;
  images: string[];
} {
  if (!raw) return { text: "", images: [] };
  try {
    const parsed = JSON.parse(raw);
    const lines: string[] = [];
    const images: string[] = [];
    walkLexicalNodes(parsed.root?.children ?? [], lines, images);
    return { text: lines.join("\n").trim(), images };
  } catch {
    return { text: raw, images: [] };
  }
}

export function parseComments(raw: unknown): TaskComment[] {
  if (!raw || !Array.isArray(raw)) return [];

  return raw.map((c) => {
    if (c && typeof c === "object") {
      const obj = c as Record<string, unknown>;

      const author = obj.author ?? obj.user;
      let authorName: string | null = null;
      if (typeof author === "string") {
        authorName = author;
      } else if (author && typeof author === "object") {
        const a = author as Record<string, unknown>;
        authorName = (a.name ?? a.email ?? null) as string | null;
      }

      const rawText = (obj.text ?? obj.content ?? obj.value ?? "") as string;
      const { text, images } = extractLexicalContent(rawText);

      return {
        guid: (obj.guid ?? "") as string,
        author: authorName ?? "Unknown",
        text,
        images,
        created: (obj.created ?? obj.date ?? obj.created_at ?? null) as
          | string
          | null,
      };
    }
    return {
      guid: "",
      author: "Unknown",
      text: String(c),
      images: [],
      created: null,
    };
  });
}
