import type { Metadata } from 'next';
import { COMPANY_NAME } from '@/config/site';

export const metadata: Metadata = {
  title: 'Statutory GST & Tax Advisory',
  description: `Access expert statutory Indian tax advisory, GST compliance filing clauses, and Income Tax deductions with ${COMPANY_NAME}.`,
};

export default function GstTaxChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
