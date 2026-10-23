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
  form_schema: FormSchema;
  webhook_secret?: string;
  created_at: string;
  updated_at?: string;
}

export interface UserToolDeployment {
  id: number;
  tool: number | CustomTool;
  user_id: string;
  user_webhook_secret: string;
  config_data: Record<string, any>;
  is_active: boolean;
  created_at: string;
  webhook_url?: string;
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
