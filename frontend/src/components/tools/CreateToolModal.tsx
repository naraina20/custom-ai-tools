'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '@clerk/nextjs';
import { apiClient } from '@/lib/api-client';
import { CustomTool, FormSchema, FormSchemaProperty } from '@/lib/types';
import {
  X,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Copy,
  Check,
  Rocket,
  ShieldAlert,
  KeyRound,
  FileText,
  Loader2,
} from 'lucide-react';

interface CreateToolModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (tool: CustomTool) => void;
}

interface EditableField {
  key: string;
  title: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
  defaultValue?: any;
}

const SAMPLE_PROMPTS = [
  'A tool that receives a customer support email webhook, analyzes sentiment, and auto-drafts a response for human approval before sending.',
  'An invoice parsing agent that extracts line items, validates tax calculations against GST slabs, and generates a structured reconciliation report.',
  'A GitHub PR security analyzer that reads code diffs, scans for hardcoded secrets, and creates review comments if issues are found.',
];

export function CreateToolModal({ isOpen, onClose, onSuccess }: CreateToolModalProps) {
  const { user } = useUser();
  const currentUserId = user?.id || 'user_dev';

  // Step management (1, 2, 3)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 State: Natural Language Description
  const [description, setDescription] = useState('');
  const [isImproving, setIsImproving] = useState(false);
  const [isGeneratingSchema, setIsGeneratingSchema] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Step 2 State: Schema Customization
  const [toolTitle, setToolTitle] = useState('');
  const [toolDescription, setToolDescription] = useState('');
  const [requiresOAuth, setRequiresOAuth] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<'none' | 'google' | 'github'>('none');
  const [requiresHitl, setRequiresHitl] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Step 3 State: Deployment & Webhook
  const [isDeploying, setIsDeploying] = useState(false);
  const [createdTool, setCreatedTool] = useState<CustomTool | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [step3Error, setStep3Error] = useState<string | null>(null);

  if (!isOpen) return null;

  // Handle AI Improvement of Description
  const handleImproveDescription = async () => {
    if (!description.trim() || description.trim().length < 10) {
      setStep1Error('Please enter at least 10 characters before asking AI to improve it.');
      return;
    }
    setStep1Error(null);
    setIsImproving(true);
    try {
      const res = await apiClient.improveDescription(description);
      if (res.improved_description) {
        setDescription(res.improved_description);
      }
    } catch (err: any) {
      setStep1Error(err.message || 'Failed to refine description with AI.');
    } finally {
      setIsImproving(false);
    }
  };

  // Step 1 -> Step 2: Call real backend schema generator
  const handleProceedToStep2 = async () => {
    if (!description.trim() || description.trim().length < 15) {
      setStep1Error('Please enter a descriptive tool concept (at least 15 characters).');
      return;
    }
    setStep1Error(null);
    setIsGeneratingSchema(true);

    try {
      const generated = await apiClient.generateSchema(description);

      setToolTitle(generated.title || 'Untitled AI Tool');
      setToolDescription(generated.description || description);
      setRequiresOAuth(!!generated.requires_oauth);
      setOauthProvider(generated.oauth_provider || 'none');
      setRequiresHitl(!!generated.requires_hitl);

      // Convert generated schema properties to editable array
      const rawProps = generated.form_schema?.properties || {};
      const requiredList = generated.form_schema?.required || [];
      const parsedFields: EditableField[] = Object.entries(rawProps).map(([key, prop]) => ({
        key,
        title: prop.title || key,
        type: prop.type || 'string',
        description: prop.description || '',
        required: requiredList.includes(key),
        defaultValue: prop.default,
      }));

      // Ensure at least 1 field exists
      if (parsedFields.length === 0) {
        parsedFields.push({
          key: 'payload',
          title: 'Payload Input',
          type: 'string',
          description: 'Primary raw input content for tool processing.',
          required: true,
        });
      }

      setFields(parsedFields);
      setStep(2);
    } catch (err: any) {
      setStep1Error(err.message || 'Failed to generate schema. Please verify backend connection.');
    } finally {
      setIsGeneratingSchema(false);
    }
  };

  // Step 2 Schema Operations
  const handleAddField = () => {
    const newIndex = fields.length + 1;
    setFields([
      ...fields,
      {
        key: `field_${newIndex}`,
        title: `Field ${newIndex}`,
        type: 'string',
        description: 'Specify the purpose of this field for the AI agent.',
        required: false,
      },
    ]);
  };

  const handleUpdateField = (index: number, patch: Partial<EditableField>) => {
    setFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleRemoveField = (index: number) => {
    if (fields.length <= 1) {
      setStep2Error('A tool must have at least one input field.');
      return;
    }
    setFields((prev) => prev.filter((_, i) => i !== index));
    setStep2Error(null);
  };

  // Step 2 Validation: Check every field description (min 5, max 200 chars)
  const validateStep2 = (): boolean => {
    if (!toolTitle.trim()) {
      setStep2Error('Tool title is required.');
      return false;
    }
    if (!toolDescription.trim()) {
      setStep2Error('Tool description is required.');
      return false;
    }

    const keySet = new Set<string>();
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const trimmedKey = f.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (!trimmedKey) {
        setStep2Error(`Field #${i + 1} must have a valid identifier.`);
        return false;
      }
      if (keySet.has(trimmedKey)) {
        setStep2Error(`Field identifier "${trimmedKey}" is duplicated. Each field key must be unique.`);
        return false;
      }
      keySet.add(trimmedKey);

      // Mandatory field description rule with min/max length
      const desc = f.description ? f.description.trim() : '';
      if (!desc) {
        setStep2Error(`Field "${f.title || f.key}" requires a description.`);
        return false;
      }
      if (desc.length < 5) {
        setStep2Error(`Field "${f.title || f.key}" description must be at least 5 characters long.`);
        return false;
      }
      if (desc.length > 200) {
        setStep2Error(`Field "${f.title || f.key}" description cannot exceed 200 characters.`);
        return false;
      }
    }

    setStep2Error(null);
    return true;
  };

  // Step 2 -> Step 3: Create Tool & Deploy Instance
  const handleCreateAndDeploy = async () => {
    if (!validateStep2()) return;

    setIsDeploying(true);
    setStep3Error(null);

    // Build backend FormSchema object
    const properties: Record<string, FormSchemaProperty> = {};
    const required: string[] = [];

    fields.forEach((f) => {
      const cleanKey = f.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      properties[cleanKey] = {
        type: f.type,
        title: f.title.trim() || cleanKey,
        description: f.description.trim(),
        ...(f.defaultValue !== undefined && f.defaultValue !== '' ? { default: f.defaultValue } : {}),
      };
      if (f.required) {
        required.push(cleanKey);
      }
    });

    const formSchema: FormSchema = {
      type: 'object',
      properties,
      required,
    };

    try {
      // 1. Create Tool in database
      const tool = await apiClient.createTool({
        title: toolTitle.trim(),
        description: toolDescription.trim(),
        form_schema: formSchema,
        requires_oauth: requiresOAuth,
        oauth_provider: requiresOAuth ? oauthProvider : 'none',
        requires_hitl: requiresHitl,
        is_public: isPublic,
        author_id: currentUserId,
      });

      setCreatedTool(tool);

      // 2. Deploy personal tool instance to generate unique webhook secret
      const deployment = await apiClient.deployTool({
        tool_id: tool.id,
        user_id: currentUserId,
        config_data: { user_email: user?.primaryEmailAddress?.emailAddress || '' },
      });

      // Construct live webhook URL
      const host = window.location.origin;
      const secret = deployment.user_webhook_secret || tool.webhook_secret;
      const generatedUrl = `${host}/api/proxy/webhooks/${secret}/`;

      setWebhookUrl(generatedUrl);
      setWebhookSecret(secret || null);
      setStep(3);
      onSuccess(tool);
    } catch (err: any) {
      setStep2Error(err.message || 'Failed to create and deploy tool.');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleCopyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleResetAndClose = () => {
    setStep(1);
    setDescription('');
    setCreatedTool(null);
    setWebhookUrl(null);
    setStep1Error(null);
    setStep2Error(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-3xl my-8 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-indigo-950/50 flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Create Autonomous AI Tool
              </h2>
              <p className="text-xs text-slate-400">
                Three-step AI-assisted tool definition & deployment
              </p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator Progress Bar */}
        <div className="px-6 py-3 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${
                step >= 1
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              1
            </div>
            <span className={step === 1 ? 'font-semibold text-white' : 'text-slate-400'}>
              Describe Concept
            </span>
          </div>

          <div className="w-8 h-px bg-slate-800" />

          <div className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${
                step >= 2
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              2
            </div>
            <span className={step === 2 ? 'font-semibold text-white' : 'text-slate-400'}>
              Customize Schema
            </span>
          </div>

          <div className="w-8 h-px bg-slate-800" />

          <div className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${
                step >= 3
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              3
            </div>
            <span className={step === 3 ? 'font-semibold text-white' : 'text-slate-400'}>
              Deploy & Webhook
            </span>
          </div>
        </div>

        {/* Scrollable Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* STEP 1: Describe Concept */}
          {step === 1 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-5"
            >
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-1">
                  Describe what your AI tool does
                </label>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Provide a natural language explanation of expected inputs, logic, and actions.
                  Use the &quot;Improve with AI&quot; button to refine your concept into an optimal specification.
                </p>
              </div>

              <div className="relative">
                <textarea
                  rows={5}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    if (step1Error) setStep1Error(null);
                  }}
                  placeholder="e.g., A tool that listens for an invoice payload, validates the supplier GSTIN and ITC eligibility under Section 16, and drafts an approval notification..."
                  className="w-full rounded-xl bg-slate-950/80 border border-slate-800 p-4 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
                />
                <div className="flex items-center justify-between mt-2 text-xs">
                  <span
                    className={
                      description.length < 15
                        ? 'text-amber-400/80'
                        : 'text-slate-400'
                    }
                  >
                    {description.length} characters (min 15)
                  </span>

                  <button
                    type="button"
                    onClick={handleImproveDescription}
                    disabled={isImproving || !description.trim()}
                    className="inline-flex items-center gap-1.5 py-1 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {isImproving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                    <span>{isImproving ? 'Refining...' : 'Improve with AI'}</span>
                  </button>
                </div>
              </div>

              {/* Sample Suggestions */}
              <div className="pt-2">
                <p className="text-xs font-medium text-slate-400 mb-2">
                  Or select a pre-designed pattern:
                </p>
                <div className="space-y-2">
                  {SAMPLE_PROMPTS.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setDescription(sample)}
                      className="w-full text-left p-3 rounded-xl bg-slate-950/40 hover:bg-slate-800/40 border border-slate-800/80 text-xs text-slate-300 transition-colors line-clamp-2"
                    >
                      &quot;{sample}&quot;
                    </button>
                  ))}
                </div>
              </div>

              {step1Error && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{step1Error}</span>
                </div>
              )}
            </motion.div>
          )}

          {/* STEP 2: Customize Form Schema */}
          {step === 2 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Tool Metadata Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tool Title *
                  </label>
                  <input
                    type="text"
                    value={toolTitle}
                    onChange={(e) => setToolTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Visibility
                  </label>
                  <select
                    value={isPublic ? 'true' : 'false'}
                    onChange={(e) => setIsPublic(e.target.value === 'true')}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="true">Marketplace (Public)</option>
                    <option value="false">Private (Only You)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Specification Summary *
                </label>
                <textarea
                  rows={2}
                  value={toolDescription}
                  onChange={(e) => setToolDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              {/* Advanced Flags (HITL & OAuth) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800/80">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresHitl}
                    onChange={(e) => setRequiresHitl(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                  />
                  <div>
                    <span className="text-xs font-semibold text-slate-200 block">
                      Human-in-the-Loop (HITL)
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Pauses LangGraph workflow before destructive actions for manual approval.
                    </span>
                  </div>
                </label>

                <div className="space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requiresOAuth}
                      onChange={(e) => {
                        setRequiresOAuth(e.target.checked);
                        if (!e.target.checked) setOauthProvider('none');
                        else if (oauthProvider === 'none') setOauthProvider('google');
                      }}
                      className="mt-0.5 w-4 h-4 rounded text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">
                        Requires OAuth Authentication
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Demands 3rd-party user token (e.g. Gmail/Sheets).
                      </span>
                    </div>
                  </label>

                  {requiresOAuth && (
                    <div className="pl-7">
                      <select
                        value={oauthProvider}
                        onChange={(e) => setOauthProvider(e.target.value as any)}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200"
                      >
                        <option value="google">Google OAuth (Gmail / Sheets)</option>
                        <option value="github">GitHub OAuth (Repos / PRs)</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Dynamic Input Schema Properties */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">
                      Input Schema Fields
                    </h3>
                    <p className="text-xs text-slate-400">
                      Every field description is mandatory (5-200 chars).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddField}
                    className="inline-flex items-center gap-1.5 py-1 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Custom Field</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {fields.map((field, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3 relative group"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                        <div className="md:col-span-4">
                          <label className="block text-[11px] font-medium text-slate-400 mb-1">
                            Field Key
                          </label>
                          <input
                            type="text"
                            value={field.key}
                            onChange={(e) => handleUpdateField(idx, { key: e.target.value })}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                            placeholder="e.g. gstin_number"
                          />
                        </div>

                        <div className="md:col-span-4">
                          <label className="block text-[11px] font-medium text-slate-400 mb-1">
                            Display Label
                          </label>
                          <input
                            type="text"
                            value={field.title}
                            onChange={(e) => handleUpdateField(idx, { title: e.target.value })}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200"
                            placeholder="e.g. GSTIN Number"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="block text-[11px] font-medium text-slate-400 mb-1">
                            Type
                          </label>
                          <select
                            value={field.type}
                            onChange={(e) => handleUpdateField(idx, { type: e.target.value as any })}
                            className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200"
                          >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Boolean</option>
                          </select>
                        </div>

                        <div className="md:col-span-2 flex items-center justify-between pt-4">
                          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) => handleUpdateField(idx, { required: e.target.checked })}
                              className="w-3.5 h-3.5 rounded text-indigo-600 bg-slate-900 border-slate-700"
                            />
                            <span>Required</span>
                          </label>

                          <button
                            type="button"
                            onClick={() => handleRemoveField(idx)}
                            disabled={fields.length <= 1}
                            className="text-slate-400 hover:text-rose-400 transition-colors p-1 disabled:opacity-30"
                            title="Delete field"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Required Field Description with Live Char Count */}
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                          <label>Field Description * (Required for LLM context)</label>
                          <span
                            className={
                              (field.description || '').length < 5 || (field.description || '').length > 200
                                ? 'text-amber-400 font-mono'
                                : 'text-slate-400 font-mono'
                            }
                          >
                            {(field.description || '').length}/200
                          </span>
                        </div>
                        <input
                          type="text"
                          value={field.description}
                          onChange={(e) => handleUpdateField(idx, { description: e.target.value })}
                          placeholder="e.g. 15-character Goods and Services Tax Identification Number."
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {step2Error && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{step2Error}</span>
                </div>
              )}
            </motion.div>
          )}

          {/* STEP 3: Deploy & Webhook Access */}
          {step === 3 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-3">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-white">
                  Tool Successfully Created & Deployed!
                </h3>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  Your autonomous agent tool &apos;{createdTool?.title}&apos; is active and ready to process webhook events or direct executions.
                </p>
              </div>

              {/* Webhook Endpoint Box */}
              {webhookUrl && (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">
                      Your Unique Inbound Webhook Endpoint
                    </span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      Rate Limited &amp; Queue Backed
                    </span>
                  </div>

                  <div className="flex items-center gap-2 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                    <code className="text-xs font-mono text-indigo-300 flex-1 truncate select-all">
                      {webhookUrl}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyWebhook}
                      className="inline-flex items-center gap-1 py-1 px-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shrink-0"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="text-[11px] text-slate-400 space-y-1">
                    <p>• Method: <span className="text-slate-200 font-mono">POST</span></p>
                    <p>• Headers: <span className="text-slate-200 font-mono">Content-Type: application/json</span></p>
                    <p>• Optional Header: <span className="text-slate-200 font-mono">X-Idempotency-Key: &lt;uuid&gt;</span></p>
                  </div>
                </div>
              )}

              {/* Summary of Configuration */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-2">
                <div className="font-semibold text-slate-300 pb-1 border-b border-slate-800">
                  Tool Overview
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Slug:</span>
                  <span className="text-slate-200 font-mono">{createdTool?.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Human-In-The-Loop:</span>
                  <span className="text-slate-200">{createdTool?.requires_hitl ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">OAuth Requirement:</span>
                  <span className="text-slate-200 capitalize">{createdTool?.oauth_provider || 'None'}</span>
                </div>
              </div>

              {step3Error && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{step3Error}</span>
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between shrink-0">
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={handleResetAndClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProceedToStep2}
                disabled={isGeneratingSchema || description.length < 15}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
              >
                {isGeneratingSchema ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Analyzing &amp; Generating Schema...</span>
                  </>
                ) : (
                  <>
                    <span>Next: Customize Schema</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={handleCreateAndDeploy}
                disabled={isDeploying}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Deploying Tool Instance...</span>
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" />
                    <span>Deploy &amp; Get Webhook</span>
                  </>
                )}
              </button>
            </>
          )}

          {step === 3 && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={handleResetAndClose}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
              >
                <Check className="w-4 h-4" />
                <span>Done &amp; Return to Dashboard</span>
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
