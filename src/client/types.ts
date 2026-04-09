export interface AuthResult {
  token: string;
  user: WhoAmIResponse;
}

export interface WhoAmIResponse {
  guid: string;
  email: string;
  first_name: string;
  last_name: string;
  [key: string]: unknown;
}

export interface Project {
  guid: string;
  name: string;
  description: string | null;
  slug: string | null;
  creator: boolean;
  hidden: boolean;
  archive: boolean;
  [key: string]: unknown;
}

export interface RawCustomField {
  guid: string;
  value: unknown;
}

export interface RawIssue {
  guid: string;
  parent_guid: string | null;
  children_count: number | null;
  sort: number;
  custom_fields: RawCustomField[];
}

export interface IssueDetailCustomField {
  guid: string;
  slug: string;
  type_fields?: string;
  value: unknown;
  [key: string]: unknown;
}

export interface IssueDetailResponse {
  guid: string;
  parent?: {
    guid?: string;
    [key: string]: unknown;
  } | null;
  custom_fields?: IssueDetailCustomField[];
  [key: string]: unknown;
}

export interface FieldValueOption {
  guid: string;
  value?: string;
  title?: string;
  name?: string;
  [key: string]: unknown;
}

export interface FieldDefFull {
  guid: string;
  slug: string;
  title?: string;
  type_fields?: string;
  system_field?: boolean;
  many?: boolean;
  settings?: {
    values_set?: FieldValueOption[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface FieldDef {
  guid: string;
  slug: string;
  name?: string;
  type?: string;
  system?: boolean;
  [key: string]: unknown;
}

export interface Participant {
  guid: string;
  name: string;
  email: string;
  [key: string]: unknown;
}

export interface ProjectDetailsFull extends Project {
  participants?: Participant[];
  [key: string]: unknown;
}

export interface FormattedTask {
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

export interface SprintInfo {
  guid: string;
  title: string;
  task_count: number;
}

export interface TaskComment {
  guid: string;
  author: string;
  text: string;
  images: string[];
  created: string | null;
}

export interface FilterRequest {
  filter_custom_fields: string[];
  filter_custom_fields_recursion: string[];
  query: QueryFilter[];
  toplvl?: boolean;
  parent?: string;
  entity_type?: string;
  sort_field?: string;
  field_columns?: string;
}

export interface QueryFilter {
  custom_field_slug: string;
  mode: string;
  type?: string;
  values: string[];
}
