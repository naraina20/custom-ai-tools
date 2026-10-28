export interface FormSchemaProperty {
  type: 'string' | 'number' | 'boolean';
  title: string;
  description: string;
  default?: any;
}

export interface FormSchema {
  type: string;
  properties: Record<string, FormSchemaProperty>;
  required?: string[];
}

export interface CustomTool {
  id: number;
  title: string;
  description: string;
  slug: string;
  author_id: string;
  is_public: boolean;
  requires_oauth: boolean;
  oauth_provider: 'none' | 'google' | 'github';
  requires_hitl: boolean;
  tasks?: string;
  add_gmail_oauth_flag?: boolean;
  google_products?: string[];
  google_products_detected?: string[];
  specification_summary?: string;
  google_auth_mode?: string;
  form_schema: FormSchema;
  webhook_secret?: string;
  created_at: string;
  updated_at?: string;
}

export interface ExtractTasksResponse {
  title: string;
  original_prompt: string;
  description?: string;
  tasks: string[];
  tasks_text: string;
  tasks_paragraph?: string;
  notes?: string;
  admin_rules?: string[];
}

export interface GeneratedSchemaResponse {
  fallback_triggered: boolean;
  fallback_reason?: string | null;
  fallback_alternatives?: string[];
  add_gmail_oauth_flag: boolean;
  google_products_detected?: string[];
  google_auth_flow_required?: 'both' | 'gmail' | 'drive_workspace' | 'none';
  title?: string;
  description?: string;
  tasks?: string;
  requires_oauth: boolean;
  oauth_provider: 'none' | 'google' | 'github';
  requires_hitl: boolean;
  form_schema?: FormSchema;
  api_config?: Record<string, any>;
}

export interface GoogleCapability {
  id: number;
  product_display_name: string;
  package_product_name: string;
  api_version: string;
  permission_scope_text: string;
  target_resource_path: string;
  description: string;
}

export interface SharedUserAsset {
  id?: number;
  user_id: string;
  google_file_or_folder_id: string;
  asset_name: string;
  mime_type?: string;
  product_name: string;
  delegation_type: 'manual_service_account' | 'granular_picker' | 'oauth_full';
  service_account_email: string;
  is_verified: boolean;
  verified_at?: string;
  last_error?: string;
}

export interface UserToolDeployment {
  id: number;
  tool: number | CustomTool;
  tool_title?: string;
  tool_slug?: string;
  user_id: string;
  user_webhook_secret: string;
  config_data: Record<string, any>;
  is_active: boolean;
  created_at: string;
  webhook_url?: string;
}

export interface AppNotification {
  id: string;
  type: 'STEP_PROGRESS' | 'HITL_REQUEST' | 'WEBHOOK_EXECUTION_COMPLETED' | 'TOOL_EXECUTION_PARTIAL_FAILURE' | 'INFO';
  tool_title?: string;
  step_name?: string;
  details?: string;
  status?: string;
  timestamp: string;
  read: boolean;
  step_index?: number;
  total_steps?: number;
  thread_id?: string;
  data?: any;
}

export interface AgentRunResponse {
  status: 'completed' | 'pending_human_approval' | 'error' | 'rejected';
  thread_id?: string;
  tool_id?: number;
  message?: string;
  result?: {
    status?: string;
    summary?: string;
    executed_plans?: any[];
    failed_items?: any[];
    executed_at?: string;
  };
  plans?: any[];
  decision?: string;
  error?: string;
}

export interface TaxChatMessage {
  id?: number | string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

export interface TaxChatSession {
  session_id: string;
  title: string;
  message_count?: number;
  messages?: TaxChatMessage[];
  created_at?: string;
  updated_at?: string;
}

export interface ApiProxyResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
  details?: any;
  requestId?: string;
}

export interface GoogleOAuthStatusResponse {
  connected: boolean;
  provider: string;
  client_id_configured: boolean;
  email?: string;
  is_expired?: boolean;
  has_refresh_token?: boolean;
  revoked?: boolean;
  granted_scopes?: string[];
  granted_products?: string[];
  message?: string;
  created_at?: string;
  updated_at?: string;
}

export interface GooglePickerConfigPayload {
  developerKey: string;
  clientId: string;
  token?: string | null;
  viewMimeTypes?: string;
  showUploadView?: boolean;
  supportDrives?: boolean;
  appId?: string;
}

export interface GooglePickerConfigResponse {
  developerKey: string;
  clientId: string;
  appId?: string;
  token?: string | null;
  email?: string | null;
  configured: boolean;
  has_token: boolean;
  has_drive_file?: boolean;
  needs_oauth?: boolean;
  granted_products?: string[];
  granted_scopes?: string[];
}

export interface GooglePickerDoc {
  id: string;
  name: string;
  mimeType: string;
  type: string;
  url: string;
  lastEditedUtc?: number;
  iconUrl?: string;
  sizeBytes?: number;
  parentId?: string;
  serviceId?: string;
}

export interface GooglePickerResponse {
  action: 'picked' | 'cancel';
  docs?: GooglePickerDoc[];
}

