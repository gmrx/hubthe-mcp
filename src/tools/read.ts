import { z } from "zod";
import { server, client, autoAuth } from "../server.js";

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

// ── hubthe_whoami ───────────────────────────────────────────────

server.tool(
  "hubthe_whoami",
  "Get information about the currently authenticated user.",
  {},
  async () => {
    try {
      await autoAuth();
      return jsonResult(await client.whoami());
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_list_projects ────────────────────────────────────────

server.tool(
  "hubthe_list_projects",
  "List all projects accessible to the authenticated user.",
  {},
  async () => {
    try {
      await autoAuth();
      const projects = await client.listProjects();
      const summary = projects.map((p) => ({
        guid: p.guid,
        name: p.name,
        slug: p.slug,
        description: p.description,
        creator: p.creator,
        hidden: p.hidden,
        archive: p.archive,
      }));
      return jsonResult(summary);
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_set_project ──────────────────────────────────────────

server.tool(
  "hubthe_set_project",
  "Set the active project by GUID. Required before listing tasks.",
  {
    project_guid: z.string().uuid().describe("Project GUID"),
  },
  async ({ project_guid }) => {
    try {
      await autoAuth();
      const project = await client.getProjectDetails(project_guid);
      client.setProject(project_guid);
      return jsonResult({
        status: "project_set",
        project: {
          guid: project.guid,
          name: project.name,
          slug: project.slug,
          description: project.description,
        },
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_list_my_tasks ────────────────────────────────────────

server.tool(
  "hubthe_list_my_tasks",
  "List tasks assigned to the current user in the active project. Requires a selected project.",
  {
    top_level_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("Return only top-level tasks (no subtasks)"),
    additional_fields: z
      .array(z.string())
      .optional()
      .describe(
        "Additional custom field slugs to include in response",
      ),
  },
  async ({ top_level_only, additional_fields }) => {
    try {
      await autoAuth();
      const tasks = await client.listMyTasks({
        topLevelOnly: top_level_only,
        additionalFields: additional_fields,
      });
      return jsonResult({
        project: client.currentProject,
        count: tasks.length,
        tasks,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_list_sprints ─────────────────────────────────────────

server.tool(
  "hubthe_list_sprints",
  "List all sprints in the active project with task counts. Requires a selected project.",
  {},
  async () => {
    try {
      await autoAuth();
      const sprints = await client.listSprints();
      return jsonResult({
        project: client.currentProject,
        count: sprints.length,
        sprints,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_list_sprint_tasks ────────────────────────────────────

server.tool(
  "hubthe_list_sprint_tasks",
  "List all tasks in a specific sprint by name. Requires a selected project.",
  {
    sprint_name: z
      .string()
      .describe("Sprint name (e.g. 'Спринт 10', 'Отложено')"),
    top_level_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("Return only top-level tasks (no subtasks)"),
    additional_fields: z
      .array(z.string())
      .optional()
      .describe(
        "Additional custom field slugs to include in response",
      ),
  },
  async ({ sprint_name, top_level_only, additional_fields }) => {
    try {
      await autoAuth();
      const tasks = await client.listSprintTasks(sprint_name, {
        topLevelOnly: top_level_only,
        additionalFields: additional_fields,
      });
      return jsonResult({
        project: client.currentProject,
        sprint: sprint_name,
        count: tasks.length,
        tasks,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_list_custom_fields ───────────────────────────────────

server.tool(
  "hubthe_list_custom_fields",
  "List all custom fields available in the active project. Use this to discover field slugs for searching/filtering tasks. Requires a selected project.",
  {},
  async () => {
    try {
      await autoAuth();
      const fields = await client.listCustomFields();
      const summary = fields.map((f) => ({
        slug: f.slug,
        name: f.name ?? f.slug,
        type: f.type ?? null,
        system: f.system ?? false,
      }));
      return jsonResult({
        project: client.currentProject,
        count: summary.length,
        fields: summary,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_search_tasks ─────────────────────────────────────────

server.tool(
  "hubthe_search_tasks",
  `Search and filter tasks in the active project by any custom fields.
Use hubthe_list_custom_fields first to discover available field slugs.
Filters support modes: "include" (match any of values) and "exclude" (exclude all of values).
Example filters: [{"field": "статус", "values": ["В работе"]}, {"field": "приоритет", "values": ["Максимальный", "Высокий"]}]`,
  {
    filters: z
      .array(
        z.object({
          field: z
            .string()
            .describe(
              "Custom field slug (e.g. 'статус', 'приоритет', 'тип-задачи')",
            ),
          values: z.array(z.string()).describe("Values to match"),
          mode: z
            .enum(["include", "exclude"])
            .optional()
            .default("include")
            .describe("Filter mode: include (default) or exclude"),
        }),
      )
      .describe("Array of field filters to apply"),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Additional custom field slugs to include in the response",
      ),
    top_level_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("Return only top-level tasks (no subtasks)"),
  },
  async ({ filters, fields, top_level_only }) => {
    try {
      await autoAuth();

      const query = filters.map((f) => ({
        custom_field_slug: f.field,
        mode: f.mode,
        values: f.values,
      }));

      const tasks = await client.searchTasks(query, {
        fields,
        topLevelOnly: top_level_only,
      });

      return jsonResult({
        project: client.currentProject,
        filters: filters.map(
          (f) => `${f.field} ${f.mode} [${f.values.join(", ")}]`,
        ),
        count: tasks.length,
        tasks,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_get_task_comments ────────────────────────────────────

server.tool(
  "hubthe_get_task_comments",
  "Get comments for a specific task by its number (e.g. 'HT1233') or GUID. Returns task details, comments text, and image URLs. Use hubthe_fetch_image to view any images. Requires a selected project.",
  {
    task: z
      .string()
      .describe("Task number (e.g. 'HT1233', '339') or task GUID"),
  },
  async ({ task: taskIdentifier }) => {
    try {
      await autoAuth();
      const { task, comments } = await client.getTaskComments(taskIdentifier);

      const allImages = comments.flatMap((c, i) =>
        c.images.map((url) => ({ comment_index: i, url })),
      );

      return jsonResult({
        project: client.currentProject,
        task: {
          guid: task.guid,
          number: task.number,
          title: task.title,
          status: task.status,
          priority: task.priority,
          sprint: task.sprint,
          assignees: task.assignees,
        },
        comments_count: comments.length,
        comments,
        images_count: allImages.length,
        images: allImages,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_list_project_participants ────────────────────────────

server.tool(
  "hubthe_list_project_participants",
  "List all participants (users) of the active project. Useful to find user names/GUIDs for assigning tasks.",
  {},
  async () => {
    try {
      await autoAuth();
      const participants = await client.listProjectParticipants();
      const summary = participants.map((p) => ({
        guid: p.guid,
        name: p.name,
        email: p.email,
      }));
      return jsonResult({
        project: client.currentProject,
        count: summary.length,
        participants: summary,
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_list_field_options ───────────────────────────────────

server.tool(
  "hubthe_list_field_options",
  "List available options for a select-type custom field (e.g. статус, приоритет). Useful before creating/updating tasks.",
  {
    field_slug: z
      .string()
      .describe(
        "Custom field slug (e.g. 'статус', 'приоритет', 'тип-задачи')",
      ),
  },
  async ({ field_slug }) => {
    try {
      await autoAuth();
      const options = await client.listFieldOptions(field_slug);
      return jsonResult({
        field: field_slug,
        count: options.length,
        options: options.map((o) => ({
          guid: o.guid,
          value: o.value ?? o.title ?? o.name ?? null,
        })),
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ── hubthe_fetch_image ──────────────────────────────────────────

server.tool(
  "hubthe_fetch_image",
  "Fetch an image from HubThe by URL (e.g. from task comments). Returns the image as base64 for viewing. Requires authentication.",
  {
    url: z
      .string()
      .url()
      .describe(
        "Full image URL from HubThe (e.g. https://hubthe.team/entity-files/...)",
      ),
  },
  async ({ url }) => {
    try {
      await autoAuth();
      const { base64, mimeType } = await client.fetchImage(url);
      return {
        content: [{ type: "image" as const, data: base64, mimeType }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error fetching image: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);
