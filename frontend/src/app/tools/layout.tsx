import { auth } from '@clerk/nextjs/server';

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
