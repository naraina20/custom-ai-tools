import {
  CustomTool,
  FormSchema,
  UserToolDeployment,
  AgentRunResponse,
  TaxChatMessage,
  TaxChatSession,
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

  async generateSchema(description: string): Promise<{
    title: string;
    description: string;
    requires_oauth: boolean;
    oauth_provider: 'none' | 'google' | 'github';
    requires_hitl: boolean;
    form_schema: FormSchema;
  }> {
    return fetchFromProxy('tools/generate-schema/', {
      method: 'POST',
      body: JSON.stringify({ description }),
    });
  },

  async createTool(payload: {
    title: string;
    description: string;
    form_schema: FormSchema;
    requires_oauth?: boolean;
    oauth_provider?: string;
    requires_hitl?: boolean;
    is_public?: boolean;
    author_id?: string;
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
  }): Promise<UserToolDeployment> {
    return fetchFromProxy<UserToolDeployment>('tools/deploy/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // --- Agent & Execution API ---
  async runAgent(payload: {
    tool_id: number;
    input_data: Record<string, any>;
    user_id?: string;
    thread_id?: string;
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
};
