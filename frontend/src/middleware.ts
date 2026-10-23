import { clerkMiddleware } from "@clerk/nextjs/server";

// Standard Clerk middleware without deprecated path-matching.
// Protected routes (like /tools) enforce authentication via server-side resource checks.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
