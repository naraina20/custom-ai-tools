import type { Metadata } from 'next';
import { auth } from '@clerk/nextjs/server';
import { COMPANY_NAME } from '@/config/site';

export const metadata: Metadata = {
  title: 'AI Tools Platform & Agent Gateway',
  description: `Build, govern, and deploy autonomous custom AI tools and agent workflows with schema generation and webhook ingestion on ${COMPANY_NAME}.`,
};

export default async function ToolsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Enforce server-side resource-based authentication check
  // Automatically redirects unauthenticated visitors to /sign-in
  await auth.protect();

  return <>{children}</>;
}
