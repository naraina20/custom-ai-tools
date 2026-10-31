import {
  CustomTool,
  FormSchema,
  UserToolDeployment,
  AgentRunResponse,
  TaxChatMessage,
  TaxChatSession,
  GeneratedSchemaResponse,
  ExtractTasksResponse,
  GoogleCapability,
  SharedUserAsset,
  GoogleOAuthStatusResponse,
  GooglePickerConfigResponse,
  FailedWebhookInfoResponse,
  FailedWebhookFileCheckResponse,
  FailedWebhookFileSelectResponse,
  AgentHITLInfoResponse,
} from './types';

export class ApiError extends Error {
  status?: number;
  code?: string;
  details?: any;

  constructor(message: string, status?: number, code?: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function fetchFromProxy<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `/api/proxy/${path.replace(/^\//, '')}`;
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  let data: any;

  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const message = (data && data.message) || (data && data.error) || response.statusText || 'Request failed';
    throw new ApiError(message, response.status, data?.code, data?.details || data);
  }

  return data as T;
}

export const apiClient = {
  // --- Tools API ---
  async getMarketplaceTools(query?: string): Promise<CustomTool[]> {
    const qParam = query ? `?q=${encodeURIComponent(query)}` : '';
    return fetchFromProxy<CustomTool[]>(`tools/marketplace/${qParam}`);
  },

  async getMyTools(authorId?: string, query?: string): Promise<CustomTool[]> {
    const params = new URLSearchParams();
    if (authorId) params.append('author_id', authorId);
    if (query) params.append('q', query);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchFromProxy<CustomTool[]>(`tools/my-tools/${qs}`);
  },

  async improveDescription(description: string): Promise<{ original: string; improved_description: string }> {
    return fetchFromProxy<{ original: string; improved_description: string }>('tools/improve-description/', {
      method: 'POST',
      body: JSON.stringify({ description }),
    });
  },

  async extractTasks(payload: {
    description: string;
    feedback?: string;
    current_tasks?: string[];
  }): Promise<ExtractTasksResponse> {
    return fetchFromProxy<ExtractTasksResponse>('tools/extract-tasks/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async generateSchema(description: string, tasks?: string): Promise<GeneratedSchemaResponse> {
    return fetchFromProxy<GeneratedSchemaResponse>('tools/generate-schema/', {
      method: 'POST',
      body: JSON.stringify({ description, tasks }),
    });
  },

  async getGoogleCapabilities(): Promise<{
    service_account_email: string;
    capabilities: GoogleCapability[];
    supported_products: string[];
    gmail_permission_limit: string;
  }> {
    return fetchFromProxy('tools/google-capabilities/', {
      method: 'GET',
    });
  },

  async getGoogleAssets(userId: string): Promise<SharedUserAsset[]> {
    return fetchFromProxy<SharedUserAsset[]>(`tools/google-assets/?user_id=${encodeURIComponent(userId)}`, {
      method: 'GET',
    });
  },

  async registerGoogleAsset(payload: {
    user_id: string;
    google_file_or_folder_id: string;
    asset_name?: string;
    mime_type?: string;
    product_name?: string;
    delegation_type?: string;
    metadata?: Record<string, any>;
  }): Promise<{
    asset: SharedUserAsset;
    is_verified: boolean;
    verification_error?: string | null;
    service_account_email: string;
    message: string;
  }> {
    return fetchFromProxy('tools/google-assets/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async createTool(payload: {
    title: string;
    description: string;
    tasks?: string;
    form_schema: FormSchema;
    requires_oauth?: boolean;
    oauth_provider?: string;
    is_public?: boolean;
    author_id?: string;
    add_gmail_oauth_flag?: boolean;
    google_products?: string[];
    google_auth_mode?: string;
  }): Promise<CustomTool> {
    return fetchFromProxy<CustomTool>('tools/create/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deployTool(payload: {
    tool_id: number;
    user_id: string;
    config_data?: Record<string, any>;
    requires_hitl?: boolean;
    email_service?: string;
    google_email?: string;
    google_app_password?: string;
  }): Promise<UserToolDeployment> {
    return fetchFromProxy<UserToolDeployment>('tools/deploy/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getUserDeployments(userId: string, toolId?: number): Promise<UserToolDeployment[]> {
    const params = new URLSearchParams();
    if (userId) params.append('user_id', userId);
    if (toolId) params.append('tool_id', toolId.toString());
    const qs = params.toString() ? `?${params.toString()}` : '';
    return fetchFromProxy<UserToolDeployment[]>(`tools/deploy/${qs}`);
  },

  // --- Agent & Execution API ---
  async runAgent(payload: {
    tool_id: number;
    input_data: Record<string, any>;
    user_id?: string;
    thread_id?: string;
    deploy_tool_data?: Record<string, any>;
    webhook_data?: Record<string, any>;
  }): Promise<AgentRunResponse> {
    return fetchFromProxy<AgentRunResponse>('agent/run/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async submitDecision(payload: {
    thread_id: string;
    decision: 'approve' | 'reject';
  }): Promise<AgentRunResponse> {
    return fetchFromProxy<AgentRunResponse>('agent/decision/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // --- Indian Tax & GST Chat API ---
  async sendTaxMessage(payload: {
    message: string;
    session_id?: string;
    user_id?: string;
    history?: { role: string; content: string }[];
  }): Promise<{
    session_id: string;
    reply: string;
    provider: string;
    messages: TaxChatMessage[];
    timestamp: string;
  }> {
    return fetchFromProxy('tax/chat/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getTaxChatHistory(sessionId: string): Promise<{
    session_id: string;
    user_id: string;
    title: string;
    messages: TaxChatMessage[];
    updated_at: string;
  }> {
    return fetchFromProxy(`tax/chat/?session_id=${encodeURIComponent(sessionId)}`);
  },

  async getTaxSessions(userId?: string): Promise<TaxChatSession[]> {
    const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
    return fetchFromProxy<TaxChatSession[]>(`tax/sessions/${qs}`);
  },

  // --- Google OAuth Consent & Token API ---
  async initGoogleOAuth(userId: string, scope?: string): Promise<{
    auth_url: string;
    client_id_configured: boolean;
    redirect_uri: string;
    error?: string;
    details?: string;
  }> {
    const params = new URLSearchParams({ user_id: userId });
    if (scope) params.append('scope', scope);
    return fetchFromProxy(`oauth/google/init/?${params.toString()}`);
  },

  async getGoogleOAuthStatus(userId: string): Promise<GoogleOAuthStatusResponse> {
    return fetchFromProxy<GoogleOAuthStatusResponse>(`oauth/google/status/?user_id=${encodeURIComponent(userId)}`);
  },

  async revokeGoogleOAuth(userId: string): Promise<{
    connected: boolean;
    success: boolean;
    message: string;
  }> {
    return fetchFromProxy('oauth/google/revoke/', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },

  async exchangeGoogleAuthCode(userId: string, code: string, redirectUri = 'postmessage'): Promise<{
    success: boolean;
    connected: boolean;
    provider?: string;
    email?: string;
    granted_scopes?: string[];
    granted_products?: string[];
    error?: string;
  }> {
    return fetchFromProxy('oauth/google/exchange-code/', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, code, redirect_uri: redirectUri }),
    });
  },

  async getGooglePickerConfig(userId: string): Promise<GooglePickerConfigResponse> {
    return fetchFromProxy<GooglePickerConfigResponse>(`oauth/google/picker-config/?user_id=${encodeURIComponent(userId)}`);
  },

  // --- Failed Webhook Recovery & OAuth Re-auth API ---
  async getFailedWebhookInfo(jobId: number | string): Promise<FailedWebhookInfoResponse> {
    return fetchFromProxy<FailedWebhookInfoResponse>(`tools/failed-webhook/${jobId}/`);
  },

  async checkFailedWebhookFileAccess(jobId: number | string): Promise<FailedWebhookFileCheckResponse> {
    return fetchFromProxy<FailedWebhookFileCheckResponse>(`tools/failed-webhook/${jobId}/check-file-access/`, {
      method: 'POST',
    });
  },

  async selectFailedWebhookFile(
    jobId: number | string,
    fileData: { google_file_id: string; asset_name?: string; mime_type?: string; description?: string }
  ): Promise<FailedWebhookFileSelectResponse> {
    return fetchFromProxy<FailedWebhookFileSelectResponse>(`tools/failed-webhook/${jobId}/select-file/`, {
      method: 'POST',
      body: JSON.stringify(fileData),
    });
  },

  async retryFailedWebhook(
    jobId: number | string,
    assetData?: { google_file_id?: string; asset_name?: string; mime_type?: string; description?: string }
  ): Promise<{ success: boolean; message: string; job_id?: number }> {
    return fetchFromProxy(`tools/failed-webhook/${jobId}/retry/`, {
      method: 'POST',
      body: JSON.stringify(assetData || {}),
    });
  },

  // --- Human-In-The-Loop (HITL) Review & Decision API ---
  async getAgentHITLInfo(threadId: string, toolId?: number | string): Promise<AgentHITLInfoResponse> {
    const params = new URLSearchParams({ thread_id: threadId });
    if (toolId) params.append('tool_id', String(toolId));
    return fetchFromProxy<AgentHITLInfoResponse>(`agent/hitl-info/?${params.toString()}`);
  },

  async submitHITLDecision(payload: {
    tool_id?: number | string;
    deployment_id?: number | string;
    thread_id: string;
    approved: boolean;
    feedback?: string;
    user_id?: string;
  }): Promise<AgentRunResponse> {
    return fetchFromProxy<AgentRunResponse>('agent/run/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // --- Custom Tool Update API ---
  async updateCustomTool(
    toolId: number | string,
    payload: {
      title?: string;
      new_fields?: Array<{ name: string; type?: string; title?: string; description?: string }>;
    }
  ): Promise<CustomTool> {
    return fetchFromProxy<CustomTool>(`tools/${toolId}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};


