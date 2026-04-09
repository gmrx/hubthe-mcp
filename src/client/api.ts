import type {
  AuthResult,
  WhoAmIResponse,
  Project,
  ProjectDetailsFull,
  RawIssue,
  IssueDetailResponse,
  FieldDef,
  FieldDefFull,
  FieldValueOption,
  Participant,
  FormattedTask,
  SprintInfo,
  TaskComment,
  FilterRequest,
  QueryFilter,
} from "./types.js";

import {
  extractLabel,
  formatIssues,
  formatIssueDetail,
  taskMatchesIdentifier,
  parseComments,
} from "./format.js";

function parseCookieToken(setCookieHeaders: string[]): string | null {
  for (const header of setCookieHeaders) {
    const match = header.match(/access_token=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

export class HubTheClient {
  private baseUrl: string;
  private _token: string | null = null;
  private userGuid: string | null = null;
  private currentProjectGuid: string | null = null;
  private currentProjectName: string | null = null;
  private fieldMap: Map<string, string> = new Map();
  private cachedFields: FieldDef[] = [];
  private cachedFieldsFull: FieldDefFull[] = [];
  private cachedParticipants: Participant[] = [];

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || "https://hubthe.team").replace(/\/+$/, "");
  }

  get token(): string | null {
    return this._token;
  }

  get isAuthenticated(): boolean {
    return this._token !== null;
  }

  get currentProject(): string | null {
    return this.currentProjectGuid;
  }

  get currentProjectLabel(): string | null {
    if (!this.currentProjectGuid) return null;
    return this.currentProjectName
      ? `${this.currentProjectName} (${this.currentProjectGuid})`
      : this.currentProjectGuid;
  }

  private get apiV1(): string {
    return `${this.baseUrl}/api/v1`;
  }

  private get apiV3(): string {
    return `${this.baseUrl}/api/v3`;
  }

  private get baseOrigin(): string {
    return new URL(this.baseUrl).origin;
  }

  // ── HTTP ──────────────────────────────────────────────────────

  private async request<T>(
    url: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this._token) {
      headers["Cookie"] = `access_token=${this._token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      redirect: "manual",
    });

    const setCookie = response.headers.getSetCookie?.() || [];
    const tokenFromCookie = parseCookieToken(setCookie);
    if (tokenFromCookie) {
      this._token = tokenFromCookie;
    }

    if (!response.ok) {
      const text = await response.text();
      let detail: string;
      try {
        const json = JSON.parse(text);
        detail =
          json.detail || json.non_field_errors?.[0] || JSON.stringify(json);
      } catch {
        detail = text || `HTTP ${response.status}`;
      }
      throw new Error(`API error (${response.status}): ${detail}`);
    }

    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  // ── Auth ──────────────────────────────────────────────────────

  async auth(email: string, password: string): Promise<AuthResult> {
    await this.request(`${this.apiV1}/auth`, {
      method: "POST",
      body: JSON.stringify({ email: email.toLowerCase(), password }),
    });

    if (!this._token) {
      throw new Error(
        "Authentication failed: no token received in response cookies",
      );
    }

    const user = await this.whoami();
    this.userGuid = user.guid;

    return { token: this._token, user };
  }

  async whoami(): Promise<WhoAmIResponse> {
    this.ensureAuth();
    const user = await this.request<WhoAmIResponse>(`${this.apiV1}/whoami`);
    this.userGuid = user.guid;
    return user;
  }

  // ── Projects ──────────────────────────────────────────────────

  async listProjects(): Promise<Project[]> {
    this.ensureAuth();
    return this.request<Project[]>(`${this.apiV1}/project`);
  }

  setProject(projectGuid: string, projectName?: string): void {
    this.currentProjectGuid = projectGuid;
    this.currentProjectName = projectName ?? null;
    this.resetProjectCaches();
  }

  async getProjectDetails(projectGuid: string): Promise<Project> {
    this.ensureAuth();
    return this.request<Project>(`${this.apiV1}/project/${projectGuid}`);
  }

  // ── Fields / Participants ─────────────────────────────────────

  private resetProjectCaches(): void {
    this.fieldMap.clear();
    this.cachedFields = [];
    this.cachedFieldsFull = [];
    this.cachedParticipants = [];
  }

  private async loadFieldMap(): Promise<void> {
    this.ensureAuth();
    this.ensureProject();

    const fields = await this.request<FieldDefFull[]>(
      `${this.apiV3}/project/${this.currentProjectGuid}/customfields`,
    );

    this.fieldMap.clear();
    this.cachedFields = [];
    this.cachedFieldsFull = [];
    if (Array.isArray(fields)) {
      this.cachedFieldsFull = fields;
      this.cachedFields = fields.map((field) => ({
        guid: field.guid,
        slug: field.slug,
        name: field.title ?? field.slug,
        type: field.type_fields,
        system: field.system_field ?? false,
      }));
      for (const f of fields) {
        this.fieldMap.set(f.guid, f.slug);
      }
    }
  }

  private async loadParticipants(): Promise<void> {
    this.ensureAuth();
    this.ensureProject();

    const project = await this.request<ProjectDetailsFull>(
      `${this.apiV1}/project/${this.currentProjectGuid}`,
    );
    this.cachedParticipants = project.participants ?? [];
  }

  async listCustomFields(): Promise<FieldDef[]> {
    this.ensureAuth();
    this.ensureProject();

    if (this.cachedFields.length === 0) {
      await this.loadFieldMap();
    }

    return this.cachedFields;
  }

  async listProjectParticipants(): Promise<Participant[]> {
    this.ensureAuth();
    this.ensureProject();

    if (this.cachedParticipants.length === 0) {
      await this.loadParticipants();
    }
    return this.cachedParticipants;
  }

  async listFieldOptions(fieldSlug: string): Promise<FieldValueOption[]> {
    this.ensureAuth();
    this.ensureProject();

    if (this.cachedFieldsFull.length === 0) {
      await this.loadFieldMap();
    }

    const fieldDef = this.findFieldDef(fieldSlug);
    if (!fieldDef) {
      throw new Error(`Field "${fieldSlug}" not found.`);
    }

    return fieldDef.settings?.values_set ?? [];
  }

  // ── Task queries ──────────────────────────────────────────────

  async searchTasks(
    filters: QueryFilter[],
    options?: { fields?: string[]; topLevelOnly?: boolean },
  ): Promise<FormattedTask[]> {
    if (this.cachedFieldsFull.length === 0) {
      await this.loadFieldMap();
    }
    if (this.cachedParticipants.length === 0) {
      await this.loadParticipants();
    }

    const resolvedFilters = filters.map((f) => this.resolveSearchFilter(f));

    return this.queryTasks(resolvedFilters, {
      additionalFields: options?.fields,
      topLevelOnly: options?.topLevelOnly,
    });
  }

  async listMyTasks(options?: {
    additionalFields?: string[];
    topLevelOnly?: boolean;
  }): Promise<FormattedTask[]> {
    if (!this.userGuid) {
      const user = await this.whoami();
      this.userGuid = user.guid;
    }

    return this.queryTasks(
      [
        {
          custom_field_slug: "исполнители",
          mode: "include",
          type: "identifier",
          values: [this.userGuid!],
        },
      ],
      options,
    );
  }

  async listSprints(): Promise<SprintInfo[]> {
    this.ensureAuth();
    this.ensureProject();

    if (this.fieldMap.size === 0) {
      await this.loadFieldMap();
    }

    const body: FilterRequest = {
      filter_custom_fields: ["спринт"],
      filter_custom_fields_recursion: ["спринт"],
      query: [],
      entity_type: "issue",
    };

    const rawIssues = await this.request<RawIssue[]>(
      `${this.apiV3}/project/${this.currentProjectGuid}/filters`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const items = Array.isArray(rawIssues) ? rawIssues : [];
    const sprintCounts = new Map<
      string,
      { guid: string; title: string; count: number }
    >();

    for (const issue of items) {
      if (!Array.isArray(issue.custom_fields)) continue;
      for (const cf of issue.custom_fields) {
        const slug = this.fieldMap.get(cf.guid);
        if (slug !== "спринт" || cf.value == null) continue;

        const val = cf.value as Record<string, unknown>;
        let guid: string;
        let title: string;

        if (typeof val === "object" && val && "guid" in val) {
          guid = val.guid as string;
          title = (val.title ?? val.name ?? val.value ?? "Unknown") as string;
        } else if (typeof val === "string") {
          guid = val;
          title = val;
        } else {
          continue;
        }

        const existing = sprintCounts.get(guid);
        if (existing) {
          existing.count++;
        } else {
          sprintCounts.set(guid, { guid, title, count: 1 });
        }
      }
    }

    return Array.from(sprintCounts.values()).map((s) => ({
      guid: s.guid,
      title: s.title,
      task_count: s.count,
    }));
  }

  async listSprintTasks(
    sprintName: string,
    options?: { additionalFields?: string[]; topLevelOnly?: boolean },
  ): Promise<FormattedTask[]> {
    this.ensureAuth();
    this.ensureProject();

    if (this.cachedFieldsFull.length === 0) {
      await this.loadFieldMap();
    }

    const resolvedSprint = this.resolveSprintValue(sprintName);
    const isGuid = /^[0-9a-f]{8}-/.test(resolvedSprint);

    return this.queryTasks(
      [
        {
          custom_field_slug: "спринт",
          mode: "include",
          ...(isGuid ? { type: "identifier" } : {}),
          values: [resolvedSprint],
        },
      ],
      options,
    );
  }

  // ── Comments ──────────────────────────────────────────────────

  async getTaskComments(taskIdentifier: string): Promise<{
    task: FormattedTask;
    comments: TaskComment[];
  }> {
    this.ensureAuth();
    this.ensureProject();

    if (this.fieldMap.size === 0) {
      await this.loadFieldMap();
    }

    const fields = [
      "нумерация-задач",
      "название",
      "описание",
      "статус",
      "приоритет",
      "исполнители",
      "спринт",
      "комментарий",
    ];

    const taskGuid = await this.resolveTaskGuid(taskIdentifier);
    const issue = await this.getTaskDetail(taskGuid, fields);
    const task = formatIssueDetail(issue);

    const commentCf = issue.custom_fields?.find(
      (cf) => cf.slug === "комментарий",
    );

    const comments = parseComments(commentCf?.value);

    return { task, comments };
  }

  async addComment(
    taskIdentifier: string,
    lexicalJson: string,
    parentCommentGuid?: string,
  ): Promise<{ task: FormattedTask; comments: TaskComment[] }> {
    this.ensureAuth();
    this.ensureProject();

    if (this.fieldMap.size === 0) {
      await this.loadFieldMap();
    }

    const taskGuid = await this.resolveTaskGuid(taskIdentifier);

    const commentFieldGuid = this.reverseFieldMap.get("комментарий");
    if (!commentFieldGuid) {
      throw new Error('Field "комментарий" not found in the project.');
    }

    const commentField: Record<string, unknown> = {
      guid_field: commentFieldGuid,
      value: [{ text: lexicalJson }],
    };

    if (parentCommentGuid) {
      commentField.parent_value = parentCommentGuid;
    }

    const body = {
      filter_custom_fields: ["комментарий", "спринт"],
      custom_fields: [commentField],
    };

    await this.request(
      `${this.apiV1}/project/${this.currentProjectGuid}/issue/${taskGuid}`,
      { method: "PUT", body: JSON.stringify(body) },
    );

    return this.getTaskComments(taskIdentifier);
  }

  // ── Task mutations ────────────────────────────────────────────

  async createTask(
    fields: Record<string, string>,
    parentGuid?: string,
  ): Promise<unknown> {
    this.ensureAuth();
    this.ensureProject();

    if (this.fieldMap.size === 0) {
      await this.loadFieldMap();
    }
    if (this.cachedParticipants.length === 0) {
      await this.loadParticipants();
    }

    const customFields = this.buildCustomFieldsV1(fields);

    const body: Record<string, unknown> = {
      custom_fields: customFields,
    };

    if (parentGuid) {
      body.parent = parentGuid;
    }

    return this.request<{ guid: string; [key: string]: unknown }>(
      `${this.apiV1}/project/${this.currentProjectGuid}/issue`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async updateTask(
    taskIdentifier: string,
    fields: Record<string, string>,
  ): Promise<unknown> {
    this.ensureAuth();
    this.ensureProject();

    if (this.fieldMap.size === 0) {
      await this.loadFieldMap();
    }
    if (this.cachedParticipants.length === 0) {
      await this.loadParticipants();
    }

    const taskGuid = await this.resolveTaskGuid(taskIdentifier);
    const customFields = this.buildCustomFieldsV1(fields);

    return this.request(
      `${this.apiV1}/project/${this.currentProjectGuid}/issue/${taskGuid}`,
      {
        method: "PUT",
        body: JSON.stringify({ custom_fields: customFields }),
      },
    );
  }

  // ── Images ────────────────────────────────────────────────────

  async fetchImage(url: string): Promise<{ base64: string; mimeType: string }> {
    this.ensureAuth();

    const headers: Record<string, string> = {
      Accept: "image/*",
    };
    if (this._token) {
      headers["Cookie"] = `access_token=${this._token}`;
    }

    let currentUrl = this.assertHubTheUrl(url);

    for (let redirectCount = 0; redirectCount < 5; redirectCount++) {
      const response = await fetch(currentUrl.toString(), {
        headers,
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(
            `Failed to fetch image: redirect (${response.status}) without location header.`,
          );
        }
        currentUrl = this.assertHubTheUrl(
          new URL(location, currentUrl).toString(),
        );
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const contentType =
        response.headers.get("content-type") || "image/jpeg";
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      return { base64, mimeType: contentType };
    }

    throw new Error("Failed to fetch image: too many redirects.");
  }

  // ── Resolve task GUID ─────────────────────────────────────────

  async resolveTaskGuid(taskIdentifier: string): Promise<string> {
    const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(taskIdentifier);
    if (isGuid) return taskIdentifier;

    this.ensureAuth();
    this.ensureProject();

    if (this.fieldMap.size === 0) {
      await this.loadFieldMap();
    }

    const exactNumberMatches = await this.queryTasks([
      {
        custom_field_slug: "нумерация-задач",
        mode: "include",
        values: [taskIdentifier],
      },
    ]);

    const exactMatch = exactNumberMatches.find((task) =>
      taskMatchesIdentifier(task.number, taskIdentifier),
    );
    if (exactMatch) return exactMatch.guid;

    const freeSearchMatches = await this.queryTasks([
      {
        custom_field_slug: "values",
        mode: "free",
        values: [taskIdentifier],
      },
    ]);

    const freeExactMatch = freeSearchMatches.find((task) =>
      taskMatchesIdentifier(task.number, taskIdentifier),
    );
    if (freeExactMatch) return freeExactMatch.guid;

    throw new Error(
      `Task "${taskIdentifier}" not found in the active project.`,
    );
  }

  // ── Private helpers ───────────────────────────────────────────

  private getDefaultTaskFields(additionalFields?: string[]): string[] {
    const defaultFields = [
      "нумерация-задач",
      "название",
      "описание",
      "статус",
      "приоритет",
      "исполнители",
      "спринт",
    ];

    return additionalFields
      ? [...new Set([...defaultFields, ...additionalFields])]
      : defaultFields;
  }

  private async queryTasks(
    query: QueryFilter[],
    options?: { additionalFields?: string[]; topLevelOnly?: boolean },
  ): Promise<FormattedTask[]> {
    this.ensureAuth();
    this.ensureProject();

    if (this.fieldMap.size === 0) {
      await this.loadFieldMap();
    }

    const filterFields = this.getDefaultTaskFields(options?.additionalFields);

    const body: FilterRequest = {
      filter_custom_fields: filterFields,
      filter_custom_fields_recursion: filterFields,
      query,
      toplvl: options?.topLevelOnly ?? false,
      entity_type: "issue",
    };

    const rawIssues = await this.request<RawIssue[]>(
      `${this.apiV3}/project/${this.currentProjectGuid}/filters`,
      { method: "POST", body: JSON.stringify(body) },
    );

    return formatIssues(
      Array.isArray(rawIssues) ? rawIssues : [],
      this.fieldMap,
      options?.additionalFields,
    );
  }

  private async getTaskDetail(
    taskGuid: string,
    fields: string[],
  ): Promise<IssueDetailResponse> {
    this.ensureAuth();
    this.ensureProject();

    return this.request<IssueDetailResponse>(
      `${this.apiV1}/project/${this.currentProjectGuid}/issue/${taskGuid}/info`,
      {
        method: "POST",
        body: JSON.stringify({
          filter_custom_fields: fields,
          filter_custom_fields_recursion: fields,
        }),
      },
    );
  }

  private get reverseFieldMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const [guid, slug] of this.fieldMap) {
      map.set(slug, guid);
    }
    return map;
  }

  private findFieldDef(slug: string): FieldDefFull | undefined {
    return this.cachedFieldsFull.find((f) => f.slug === slug);
  }

  private assertHubTheUrl(url: string): URL {
    const parsed = new URL(url);
    if (parsed.origin !== this.baseOrigin) {
      throw new Error(
        `Only HubThe URLs from ${this.baseOrigin} are allowed for authenticated image fetches.`,
      );
    }
    return parsed;
  }

  private resolveSelectValue(
    fieldDef: FieldDefFull,
    userValue: string,
  ): string {
    const options = fieldDef.settings?.values_set;
    if (!options || !Array.isArray(options)) return userValue;

    const lower = userValue.toLowerCase();
    const match = options.find((o) => {
      const label = o.value ?? o.title ?? o.name;
      return typeof label === "string" && label.toLowerCase() === lower;
    });
    if (match) return match.guid;

    const isGuid = /^[0-9a-f]{8}-/.test(userValue);
    if (isGuid) return userValue;

    const available = options
      .map((o) => o.value ?? o.title ?? o.name ?? "")
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Unknown value "${userValue}" for field "${fieldDef.slug}". Available: ${available}`,
    );
  }

  private resolveUserValue(userValue: string): string[] {
    const names = userValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const result: string[] = [];

    for (const name of names) {
      const isGuid = /^[0-9a-f]{8}-/.test(name);
      if (isGuid) {
        result.push(name);
        continue;
      }

      const lower = name.toLowerCase();
      const match = this.cachedParticipants.find(
        (p) =>
          p.name.toLowerCase() === lower || p.email.toLowerCase() === lower,
      );
      if (match) {
        result.push(match.guid);
      } else {
        const available = this.cachedParticipants
          .map((p) => p.name)
          .join(", ");
        throw new Error(
          `User "${name}" not found in project. Available: ${available}`,
        );
      }
    }

    return result;
  }

  private resolveSearchFilter(filter: QueryFilter): QueryFilter {
    const fieldDef = this.findFieldDef(filter.custom_field_slug);
    const fieldType = fieldDef?.type_fields;

    if (fieldType === "users") {
      const resolvedValues = filter.values.flatMap((v) =>
        this.resolveUserValue(v),
      );
      return { ...filter, type: "identifier", values: resolvedValues };
    }

    if (fieldType === "select" && fieldDef) {
      const resolvedValues = filter.values.map((v) =>
        this.resolveSelectValue(fieldDef, v),
      );
      return { ...filter, values: resolvedValues };
    }

    if (fieldType === "rotation") {
      const resolvedValues = filter.values.map((v) =>
        this.resolveSprintValue(v),
      );
      const allGuids = resolvedValues.every((v) => /^[0-9a-f]{8}-/.test(v));
      return {
        ...filter,
        ...(allGuids ? { type: "identifier" } : {}),
        values: resolvedValues,
      };
    }

    return filter;
  }

  private resolveSprintValue(userValue: string): string {
    const isGuid = /^[0-9a-f]{8}-/.test(userValue);
    if (isGuid) return userValue;

    const sprintField = this.cachedFieldsFull.find(
      (f) => f.slug === "спринт",
    );
    const options = sprintField?.settings?.values_set;
    if (options && Array.isArray(options)) {
      const lower = userValue.toLowerCase();
      const match = options.find((o) => {
        const label = o.value ?? o.title ?? o.name;
        return typeof label === "string" && label.toLowerCase() === lower;
      });
      if (match) return match.guid;
    }

    return userValue;
  }

  private buildCustomFieldsV1(
    fields: Record<string, string>,
  ): { guid_field: string; value: unknown }[] {
    const reverse = this.reverseFieldMap;
    const result: { guid_field: string; value: unknown }[] = [];

    for (const [slug, value] of Object.entries(fields)) {
      const fieldGuid = reverse.get(slug);
      if (!fieldGuid) {
        throw new Error(
          `Unknown field "${slug}". Use hubthe_list_custom_fields to see available fields.`,
        );
      }

      const fieldDef = this.findFieldDef(slug);
      const fieldType = fieldDef?.type_fields;

      let resolvedValue: unknown = value;

      if (fieldType === "select" && fieldDef) {
        resolvedValue = this.resolveSelectValue(fieldDef, value);
      } else if (fieldType === "users") {
        resolvedValue = this.resolveUserValue(value);
      } else if (fieldType === "rotation") {
        resolvedValue = this.resolveSprintValue(value);
      } else if (fieldType === "datetime") {
        resolvedValue = this.normalizeDatetime(value);
      }

      result.push({ guid_field: fieldGuid, value: resolvedValue });
    }

    return result;
  }

  private normalizeDatetime(value: string): string {
    if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value;

    const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
    if (dateOnly) {
      return `${dateOnly[1]}T12:00:00.000000+03:00`;
    }

    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return value;

    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}T12:00:00.000000+03:00`;
  }

  private ensureAuth(): void {
    if (!this._token) {
      throw new Error(
        "Not authenticated. Configure HubThe credentials and retry the tool call.",
      );
    }
  }

  private ensureProject(): void {
    if (!this.currentProjectGuid) {
      throw new Error("No project selected. Call hubthe_set_project first.");
    }
  }
}
