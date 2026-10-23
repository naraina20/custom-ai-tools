import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const BACKEND_BASE_URL = process.env.BACKEND_API_URL || 'http://127.0.0.1:8000';

async function handleProxyRequest(req: NextRequest, pathSegments: string[]) {
  const requestId = Math.random().toString(36).substring(2, 9);
  const targetPath = pathSegments.join('/');
  const searchParams = req.nextUrl.search;
  const cleanPath = targetPath.endsWith('/') ? targetPath : `${targetPath}/`;
  const targetUrl = `${BACKEND_BASE_URL}/api/${cleanPath}${searchParams ? searchParams : ''}`;

  let userId: string | null = null;
  let token: string | null = null;

  try {
    const authObj = await auth();
    userId = authObj.userId;
    token = await authObj.getToken();
  } catch (err) {
    // Unauthenticated or non-clerk context
  }

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  const contentType = req.headers.get('content-type');
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  if (userId) {
    headers['X-User-Id'] = userId;
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Pass any custom provider keys if sent from client (BYOK)
  const xApiKey = req.headers.get('x-api-key');
  if (xApiKey) headers['X-Api-Key'] = xApiKey;
  const xProvider = req.headers.get('x-provider');
  if (xProvider) headers['X-Provider'] = xProvider;

  let body: any = undefined;
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    try {
      const text = await req.text();
      if (text) {
        body = text;
      }
    } catch (e) {
      // no body
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Proxy -> Backend] [${req.method}] ${targetUrl} (Req: ${requestId}, User: ${userId || 'anon'})`);
  }

  try {
    const backendRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
    });

    const resContentType = backendRes.headers.get('content-type') || '';
    let responseData: any;

    if (resContentType.includes('application/json')) {
      responseData = await backendRes.json();
    } else {
      responseData = await backendRes.text();
    }

    if (!backendRes.ok) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`[Proxy Backend Error] [${backendRes.status}] on ${targetUrl}:`, responseData);
      }
      return NextResponse.json(
        {
          success: false,
          code: `HTTP_${backendRes.status}`,
          message: typeof responseData === 'object' && responseData.error ? responseData.error : 'Backend request failed',
          details: responseData,
          requestId,
        },
        { status: backendRes.status }
      );
    }

    return NextResponse.json(responseData, { status: backendRes.status });

  } catch (error: any) {
    console.error(`[Proxy Network Failure] Req: ${requestId} to ${targetUrl}:`, error.message);
    return NextResponse.json(
      {
        success: false,
        code: 'PROXY_NETWORK_ERROR',
        message: 'Could not connect to the backend server. Please verify the Django service is running.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        requestId,
      },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleProxyRequest(req, path);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleProxyRequest(req, path);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleProxyRequest(req, path);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleProxyRequest(req, path);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return handleProxyRequest(req, path);
}
