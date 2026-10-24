import type { Metadata } from 'next';
import { COMPANY_NAME } from '@/config/site';

export const metadata: Metadata = {
  title: 'Indian GST & Tax Intelligence Copilot',
  description: `Consult the ${COMPANY_NAME} statutory tax advisor powered by Qwen3-1.7B for Indian Income Tax Act 1961, Section 115BAC regime calculations, and GST ITC compliance.`,
};

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
