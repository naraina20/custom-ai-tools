/**
 * Site configuration and branding metadata.
 * Dynamically resolves the company name from the NEXT_PUBLIC_COMPANY_NAME
 * environment variable with a robust fallback.
 */

export const COMPANY_NAME = (process.env.NEXT_PUBLIC_COMPANY_NAME || 'NexusAI').trim();
export const APP_NAME = COMPANY_NAME;

export const APP_TITLE = `${COMPANY_NAME} | Autonomous Tool Engineering & Tax Intelligence`;
export const APP_DESCRIPTION = `Enterprise AI Tool Creation, LangGraph Human-in-the-Loop Orchestration, and Indian GST/Tax Intelligence Assistant powered by ${COMPANY_NAME}.`;

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
