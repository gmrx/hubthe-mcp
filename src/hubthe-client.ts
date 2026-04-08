interface AuthResult {
  token: string;
  user: WhoAmIResponse;
}

interface WhoAmIResponse {
  guid: string;
  email: string;
  first_name: string;
  last_name: string;
  [key: string]: unknown;
}

interface Project {
  guid: string;
  name: string;
  description: string | null;
  slug: string | null;
  creator: boolean;
  hidden: boolean;
  archive: boolean;
  [key: string]: unknown;
}

interface RawCustomField {
  guid: string;
  value: unknown;
}

interface RawIssue {
  guid: string;
  parent_guid: string | null;
  children_count: number | null;
  sort: number;
  custom_fields: RawCustomField[];
}

interface FieldDef {
  guid: string;
  slug: string;
}

interface FormattedTask {
  guid: string;
  number: string | null;
  title: string | null;
  description: string | null;
  status: string | null;
  priority: string | null;
  sprint: string | null;
  assignees: string[];
  parent_guid: string | null;
  children_count: number | null;
  [key: string]: unknown;
}

interface SprintInfo {
  guid: string;
  title: string;
  task_count: number;
}

interface FilterRequest {
  filter_custom_fields: string[];
  filter_custom_fields_recursion: string[];
  query: QueryFilter[];
  toplvl?: boolean;
  parent?: string;
  entity_type?: string;
  sort_field?: string;
  field_columns?: string;
}

interface QueryFilter {
  custom_field_slug: string;
  mode: string;
  type?: string;
  values: string[];
}

import { execSync } from "child_process";
import { platform } from "os";

const KEYCHAIN_SERVICE = "hubthe-mcp";

function readKeychain(account: string): string | null {
  if (platform() !== "darwin") return null;
  try {
    return execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  } catch {
    return null;
  }
}

export function getCredentials(): {
  email: string;
  password: string;
} | null {
  const kcEmail = readKeychain("email");
  const kcPassword = readKeychain("password");
  if (kcEmail && kcPassword) return { email: kcEmail, password: kcPassword };

  const envEmail = process.env.HUBTHE_EMAIL;
  const envPassword = process.env.HUBTHE_PASSWORD;
  if (envEmail && envPassword) return { email: envEmail, password: envPassword };

  return null;
}

function parseCookieToken(setCookieHeaders: string[]): string | null {
  for (const header of setCookieHeaders) {
    const match = header.match(/access_token=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

function extractLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (obj.title ?? obj.value ?? obj.name ?? null) as string | null;
  }
  return null;
}

export class HubTheClient {
  private baseUrl: string;
  private _token: string | null = null;
  private userGuid: string | null = null;
  private currentProjectGuid: string | null = null;
  private fieldMap: Map<string, string> = new Map();

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

  private get apiV1(): string {
    return `${this.baseUrl}/api/v1`;
  }

  private get apiV3(): string {
    return `${this.baseUrl}/api/v3`;
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
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

  async auth(email: string, password: string): Promise<AuthResult> {
    await this.request(`${this.apiV1}/auth`, {
      method: "POST",
      body: JSON.stringify({ email: email.toLowerCase(), password }),
    });

    if (!this._token) {
      throw new Error(
        "Authentication failed: no token received in response cookies"
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

  async listProjects(): Promise<Project[]> {
    this.ensureAuth();
    return this.request<Project[]>(`${this.apiV1}/project`);
  }

  setProject(projectGuid: string): void {
    this.currentProjectGuid = projectGuid;
  }

  async getProjectDetails(projectGuid: string): Promise<Project> {
    this.ensureAuth();
    return this.request<Project>(`${this.apiV1}/project/${projectGuid}`);
  }

  private async loadFieldMap(): Promise<void> {
    this.ensureAuth();
    this.ensureProject();

    const fields = await this.request<FieldDef[]>(
      `${this.apiV3}/project/${this.currentProjectGuid}/customfields`
    );

    this.fieldMap.clear();
    if (Array.isArray(fields)) {
      for (const f of fields) {
        this.fieldMap.set(f.guid, f.slug);
      }
    }
  }

  private formatIssues(rawIssues: RawIssue[], extraSlugs?: string[]): FormattedTask[] {
    const items = Array.isArray(rawIssues) ? rawIssues : [];

    return items.map((issue) => {
      const bySlug = new Map<string, unknown>();
      if (Array.isArray(issue.custom_fields)) {
        for (const cf of issue.custom_fields) {
          const slug = this.fieldMap.get(cf.guid);
          if (slug) bySlug.set(slug, cf.value);
        }
      }

      const assigneesRaw = bySlug.get("исполнители");
      const assignees: string[] = [];
      if (Array.isArray(assigneesRaw)) {
        for (const a of assigneesRaw) {
          if (a && typeof a === "object" && "name" in a) {
            assignees.push(a.name as string);
          }
        }
      }

      const numberVal = bySlug.get("нумерация-задач");
      let numberStr: string | null = null;
      if (numberVal && typeof numberVal === "object") {
        const obj = numberVal as Record<string, unknown>;
        numberStr = (obj.value as string) ?? null;
      }

      const task: FormattedTask = {
        guid: issue.guid,
        number: numberStr,
        title: extractLabel(bySlug.get("название")),
        description: extractLabel(bySlug.get("описание")),
        status: extractLabel(bySlug.get("статус")),
        priority: extractLabel(bySlug.get("приоритет")),
        sprint: extractLabel(bySlug.get("спринт")),
        assignees,
        parent_guid: issue.parent_guid,
        children_count: issue.children_count,
      };

      if (extraSlugs) {
        for (const slug of extraSlugs) {
          if (!(slug in task)) {
            task[slug] = extractLabel(bySlug.get(slug));
          }
        }
      }

      return task;
    });
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

    const defaultFields = [
      "нумерация-задач",
      "название",
      "описание",
      "статус",
      "приоритет",
      "исполнители",
      "спринт",
    ];

    const filterFields = options?.additionalFields
      ? [...new Set([...defaultFields, ...options.additionalFields])]
      : defaultFields;

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

    return this.formatIssues(
      Array.isArray(rawIssues) ? rawIssues : [],
      options?.additionalFields,
    );
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
    const sprintCounts = new Map<string, { guid: string; title: string; count: number }>();

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
    const allTasks = await this.queryTasks([], options);
    return allTasks.filter((t) => t.sprint === sprintName);
  }

  private ensureAuth(): void {
    if (!this._token) {
      throw new Error("Not authenticated. Call hubthe_auth first.");
    }
  }

  private ensureProject(): void {
    if (!this.currentProjectGuid) {
      throw new Error("No project selected. Call hubthe_set_project first.");
    }
  }
}
