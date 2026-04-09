import { z } from "zod";
import { server, client, autoAuth } from "../server.js";
import { mermaidToExcalidrawData } from "../mermaid/converter.js";
import { buildCommentLexicalJson } from "../mermaid/lexical.js";

function errorResult(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  };
}

function jsonResult(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

async function requireProject() {
  if (client.currentProject) return null;

  const projects = await client.listProjects();
  const active = projects.filter((p) => !p.archive && !p.hidden);

  return jsonResult({
    status: "no_project_selected",
    message:
      "No active project selected. Please ask the user which project to use, then call hubthe_set_project with the chosen GUID.",
    available_projects: active.map((p) => ({
      guid: p.guid,
      name: `${p.name} (${p.guid})`,
      slug: p.slug,
      description: p.description,
    })),
  });
}

// ── hubthe_add_comment ──────────────────────────────────────────

server.tool(
  "hubthe_add_comment",
  `Add a comment to a task. A comment can contain text, a Mermaid diagram (rendered as Excalidraw), or both.
Pass text for a plain text comment, mermaid for a diagram, or both to combine them in one comment.
The diagram is converted to Excalidraw and embedded as a visual block inside the Lexical editor.
To reply to an existing comment, pass its GUID in reply_to.
Example mermaid: "graph TD; A[Start] --> B{Decision}; B -->|Yes| C[OK]; B -->|No| D[Fail];"`,
  {
    task: z
      .string()
      .describe("Task number (e.g. 'HT1233') or task GUID"),
    text: z
      .string()
      .optional()
      .describe("Comment text (plain text, supports newlines)"),
    mermaid: z
      .string()
      .optional()
      .describe(
        "Mermaid diagram syntax — will be rendered as Excalidraw inside the comment",
      ),
    reply_to: z
      .string()
      .optional()
      .describe("GUID of the parent comment to reply to"),
  },
  async ({
    task: taskIdentifier,
    text,
    mermaid: mermaidSyntax,
    reply_to,
  }) => {
    try {
      if (!text && !mermaidSyntax) {
        throw new Error("Provide at least one of: text, mermaid");
      }

      await autoAuth();
      const noProject = await requireProject();
      if (noProject) return noProject;

      let diagram = undefined;
      if (mermaidSyntax) {
        diagram = await mermaidToExcalidrawData(mermaidSyntax);
      }

      const lexicalJson = buildCommentLexicalJson({ text, diagram });

      const { task, comments } = await client.addComment(
        taskIdentifier,
        lexicalJson,
        reply_to,
      );

      return jsonResult({
        status: "comment_added",
        task: {
          guid: task.guid,
          number: task.number,
          title: task.title,
        },
        has_text: !!text,
        has_diagram: !!diagram,
        diagram_elements_count: diagram?.elements.length ?? 0,
        comments_count: comments.length,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_create_task ──────────────────────────────────────────

server.tool(
  "hubthe_create_task",
  `Create a new task in the active project.
IMPORTANT workflow:
1. Before creating a task, always confirm with the user which project to use.
   If no project is selected, a list of available projects will be returned — ask the user to choose.
   Even if the project seems obvious from context, get explicit confirmation before proceeding.
2. Always assign the task to the latest (highest-numbered) sprint unless the user specifies otherwise.
   Call hubthe_list_sprints to find the latest sprint and include it in the fields automatically.
   If unclear which sprint to use, ask the user.
3. If the user doesn't specify a deadline (срок-до), no need to ask — but always set the sprint.
Values are resolved automatically:
- select fields (статус, приоритет): pass human-readable value like "В работе", "Высокий"
- users fields (исполнители): pass user name or email like "Alim" or "alim@mail.ru" (comma-separated for multiple)
- sprint field (спринт): pass sprint name like "Спринт 51"
- datetime fields (срок-до, дата-начала): ALWAYS use format "YYYY-MM-DDT12:00:00.000000+03:00", e.g. "2026-04-13T12:00:00.000000+03:00"
- text fields (название, описание): pass plain text
Use hubthe_list_custom_fields, hubthe_list_project_participants, hubthe_list_sprints to discover available values.
Example: {"название": "Fix login bug", "статус": "В работе", "исполнители": "Alim", "спринт": "Спринт 51", "срок-до": "2026-04-13T12:00:00.000000+03:00"}`,
  {
    fields: z
      .record(z.string(), z.string())
      .describe(
        "Task fields as slug:value pairs. 'название' (title) is required.",
      ),
    parent_task: z
      .string()
      .optional()
      .describe(
        "Parent task number (e.g. 'HT100') or GUID to create a subtask",
      ),
  },
  async ({ fields, parent_task }) => {
    try {
      await autoAuth();
      const noProject = await requireProject();
      if (noProject) return noProject;

      if (!fields["название"]) {
        return {
          content: [
            {
              type: "text" as const,
              text: 'Error: Field "название" (title) is required.',
            },
          ],
          isError: true,
        };
      }

      let parentGuid: string | undefined;
      if (parent_task) {
        parentGuid = await client.resolveTaskGuid(parent_task);
      }

      const result = await client.createTask(fields, parentGuid);

      return jsonResult({
        status: "created",
        project: client.currentProjectLabel,
        result,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_update_task ──────────────────────────────────────────

server.tool(
  "hubthe_update_task",
  `Update fields of an existing task. Only the specified fields will be updated.
If no project is selected, returns available projects — ask the user to choose first.
Values are resolved automatically (same as hubthe_create_task):
- select fields: pass readable values like "Готово", "Средний"
- users fields: pass names like "Alim"
- sprint: pass name like "Спринт 51"
- datetime fields (срок-до, дата-начала): ALWAYS use format "YYYY-MM-DDT12:00:00.000000+03:00", e.g. "2026-04-13T12:00:00.000000+03:00"
Example: hubthe_update_task({task: "HT1233", fields: {"статус": "Готово", "срок-до": "2026-04-13T12:00:00.000000+03:00"}})`,
  {
    task: z
      .string()
      .describe("Task number (e.g. 'HT1233') or task GUID"),
    fields: z
      .record(z.string(), z.string())
      .describe("Fields to update as slug:value pairs"),
  },
  async ({ task: taskIdentifier, fields }) => {
    try {
      await autoAuth();
      const noProject = await requireProject();
      if (noProject) return noProject;

      if (Object.keys(fields).length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: At least one field must be specified for update.",
            },
          ],
          isError: true,
        };
      }

      const result = await client.updateTask(taskIdentifier, fields);

      return jsonResult({
        status: "updated",
        task: taskIdentifier,
        updated_fields: Object.keys(fields),
        result,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);
