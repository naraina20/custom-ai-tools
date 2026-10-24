'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '@clerk/nextjs';
import { apiClient } from '@/lib/api-client';
import { CustomTool, FormSchema, FormSchemaProperty, UserToolDeployment } from '@/lib/types';
import { GoogleOAuthConsentButton } from './GoogleOAuthConsentButton';
import { COMPANY_NAME } from '@/config/site';
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
  Mail,
  Database,
  Lock,
  FolderCheck,
  ExternalLink,
  HelpCircle,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Globe,
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
  'A tool that reads rows from a Google Sheet, summarizes quarterly sales, and prepares an outbound summary report.',
  'An invoice parsing agent that extracts line items, validates tax calculations against GST slabs, and generates a structured reconciliation report.',
  'A tool that checks newly uploaded documents in a Google Drive folder and sends an alert email to the shipping team about the inventory update.',
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

  // Specification 3: Fallback Interface State
  const [isFallbackActive, setIsFallbackActive] = useState(false);
  const [fallbackData, setFallbackData] = useState<{
    reason?: string | null;
    alternatives: string[];
  } | null>(null);
  const [customAlternativeInput, setCustomAlternativeInput] = useState('');

  // Specification 1 & 3: Google Capability & Product Detection State
  const [addGmailOauthFlag, setAddGmailOauthFlag] = useState(false);
  const [googleProductsDetected, setGoogleProductsDetected] = useState<string[]>([]);
  const [googleAuthFlowRequired, setGoogleAuthFlowRequired] = useState<'both' | 'gmail' | 'drive_workspace' | 'none'>('none');

  // Specification 3: Drive/Sheets/Docs/Forms Authorization (3 Choices)
  // 1. Full Access (OAuth)
  // 2. Granular Asset Picker
  // 3. Manual Delegation (Service account narainad308@gmail.com)
  const [driveAuthChoice, setDriveAuthChoice] = useState<'oauth_full' | 'granular_picker' | 'manual_delegation'>('manual_delegation');
  const [manualFileId, setManualFileId] = useState('');
  const [manualAssetName, setManualAssetName] = useState('');
  const [isVerifyingAsset, setIsVerifyingAsset] = useState(false);
  const [assetVerificationResult, setAssetVerificationResult] = useState<{
    verified: boolean;
    message: string;
  } | null>(null);

  // Specification 3: Gmail Outgoing Authorization (3 Choices)
  // 1. Direct OAuth (gmail.send only)
  // 2. Supply Own Email + App Password (with tutorial modal)
  // 3. Dispatch completely via internal platform system email
  const [gmailAuthChoice, setGmailAuthChoice] = useState<'oauth_send' | 'app_password' | 'platform_dispatch'>('oauth_send');
  const [gmailAppEmail, setGmailAppEmail] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [showAppPasswordTutorial, setShowAppPasswordTutorial] = useState(false);

  // Step 2 State: Schema Customization
  const [toolTitle, setToolTitle] = useState('');
  const [toolDescription, setToolDescription] = useState('');
  const [requiresOAuth, setRequiresOAuth] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<'none' | 'google' | 'github'>('none');
  const [requiresHitl, setRequiresHitl] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  // Step 3 State: Manual Deployment & Webhook
  const [isDeploying, setIsDeploying] = useState(false);
  const [createdTool, setCreatedTool] = useState<CustomTool | null>(null);
  const [deployment, setDeployment] = useState<UserToolDeployment | null>(null);
  const [deployConfigValues, setDeployConfigValues] = useState<Record<string, any>>({});
  const [deployEmailChannel, setDeployEmailChannel] = useState<'oauth' | 'app_password' | 'platform_default'>('platform_default');
  const [deployAppEmail, setDeployAppEmail] = useState('');
  const [deployAppPassword, setDeployAppPassword] = useState('');
  const [isStep3OAuthGranted, setIsStep3OAuthGranted] = useState(false);
  const [step3OAuthEmail, setStep3OAuthEmail] = useState('');
  const [isManualDeploying, setIsManualDeploying] = useState(false);
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

  // Step 1 -> Step 2: Call backend schema generator with capability injection
  const handleProceedToStep2 = async () => {
    if (!description.trim() || description.trim().length < 15) {
      setStep1Error('Please enter a descriptive tool concept (at least 15 characters).');
      return;
    }
    setStep1Error(null);
    setIsGeneratingSchema(true);

    try {
      const generated = await apiClient.generateSchema(description);

      // Check if Fallback Interface was triggered due to unsupported capabilities
      if (generated.fallback_triggered) {
        setFallbackData({
          reason: generated.fallback_reason || 'The requested capability or permission is not currently supported.',
          alternatives: generated.fallback_alternatives && generated.fallback_alternatives.length > 0
            ? generated.fallback_alternatives.slice(0, 3)
            : [
                'Switch to Inbound Webhook: receive structured event data directly instead of scanning inboxes.',
                'Outbound Status Notifications: dispatch notifications or alerts when target records are modified.',
                'Shared Google Sheet or Drive asset: read data from a specific shared spreadsheet or file.',
              ],
        });
        setIsFallbackActive(true);
        return;
      }

      // Successful supported generation
      setIsFallbackActive(false);
      setFallbackData(null);
      setToolTitle(generated.title || 'Untitled AI Tool');
      setToolDescription(generated.description || description);
      setRequiresOAuth(!!generated.requires_oauth);
      setOauthProvider(generated.oauth_provider || (generated.google_products_detected?.length ? 'google' : 'none'));
      setRequiresHitl(!!generated.requires_hitl);
      setAddGmailOauthFlag(!!generated.add_gmail_oauth_flag);
      setGoogleProductsDetected(generated.google_products_detected || []);
      setGoogleAuthFlowRequired(generated.google_auth_flow_required || 'none');
      setIsPublic(true);

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

  // Fallback Action 1: User selects one of the 3 alternative options
  const handleSelectAlternative = (altText: string) => {
    setDescription(altText);
    setIsFallbackActive(false);
    setFallbackData(null);
    setStep1Error(null);
  };

  // Fallback Action 2: User provides custom refinement input
  const handleApplyCustomAlternative = () => {
    if (!customAlternativeInput.trim()) return;
    setDescription(customAlternativeInput.trim());
    setCustomAlternativeInput('');
    setIsFallbackActive(false);
    setFallbackData(null);
    setStep1Error(null);
  };

  // Fallback Action 3: Functional Cancel button that clears states and resets
  const handleCancelFallback = () => {
    setIsFallbackActive(false);
    setFallbackData(null);
    setDescription('');
    setCustomAlternativeInput('');
    setStep1Error(null);
  };

  // Shared Service Account Asset Quarantine Verification
  const handleVerifySharedAsset = async () => {
    if (!manualFileId.trim()) {
      setAssetVerificationResult({ verified: false, message: 'Please enter a valid Google File or Folder ID.' });
      return;
    }
    setIsVerifyingAsset(true);
    setAssetVerificationResult(null);
    try {
      const res = await apiClient.registerGoogleAsset({
        user_id: currentUserId,
        google_file_or_folder_id: manualFileId.trim(),
        asset_name: manualAssetName.trim() || 'Shared Google Asset',
        product_name: 'drive',
        delegation_type: 'manual_service_account',
      });
      setAssetVerificationResult({
        verified: res.is_verified,
        message: res.is_verified
          ? `Verified! Asset "${res.asset?.asset_name || manualFileId}" is accessible by narainad308@gmail.com and securely quarantined to your profile.`
          : res.verification_error || 'Asset registered, but service account verification failed. Please ensure Editor access is granted to narainad308@gmail.com.',
      });
    } catch (err: any) {
      setAssetVerificationResult({
        verified: false,
        message: err.message || 'Failed connecting to asset quarantine verification service.',
      });
    } finally {
      setIsVerifyingAsset(false);
    }
  };

  // Complete Cancel & Reset modal
  const handleResetAndClose = () => {
    setStep(1);
    setDescription('');
    setIsFallbackActive(false);
    setFallbackData(null);
    setCustomAlternativeInput('');
    setToolTitle('');
    setToolDescription('');
    setRequiresOAuth(false);
    setOauthProvider('none');
    setRequiresHitl(false);
    setAddGmailOauthFlag(false);
    setGoogleProductsDetected([]);
    setGoogleAuthFlowRequired('none');
    setFields([]);
    setCreatedTool(null);
    setWebhookUrl(null);
    setWebhookSecret(null);
    setStep1Error(null);
    setStep2Error(null);
    setStep3Error(null);
    setManualFileId('');
    setAssetVerificationResult(null);
    onClose();
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

  // Step 2 -> Step 3: Create Tool Definition (Without Auto-Deploying)
  const handleCreateTool = async () => {
    if (!validateStep2()) return;

    setIsDeploying(true);
    setStep2Error(null);
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
      const effectiveAuthMode = addGmailOauthFlag
        ? gmailAuthChoice
        : (googleProductsDetected.length > 0 ? driveAuthChoice : 'none');

      const tool = await apiClient.createTool({
        title: toolTitle.trim(),
        description: toolDescription.trim(),
        form_schema: formSchema,
        requires_oauth: requiresOAuth || (googleProductsDetected.length > 0 && driveAuthChoice === 'oauth_full') || (addGmailOauthFlag && gmailAuthChoice === 'oauth_send'),
        oauth_provider: requiresOAuth ? oauthProvider : (googleProductsDetected.length > 0 || addGmailOauthFlag ? 'google' : 'none'),
        requires_hitl: requiresHitl,
        is_public: isPublic,
        author_id: currentUserId,
        add_gmail_oauth_flag: addGmailOauthFlag,
        google_products: googleProductsDetected,
        google_auth_mode: effectiveAuthMode,
      });

      setCreatedTool(tool);

      // Pre-fill initial deployment inputs with default schema values
      const initialDeployValues: Record<string, any> = {};
      Object.entries(properties).forEach(([k, prop]) => {
        initialDeployValues[k] = prop.default !== undefined ? prop.default : (prop.type === 'boolean' ? false : '');
      });
      setDeployConfigValues(initialDeployValues);
      setDeployment(null);
      setWebhookUrl(null);
      setWebhookSecret(null);

      // Advance to manual deployment step
      setStep(3);
      onSuccess(tool);
    } catch (err: any) {
      setStep2Error(err.message || 'Failed to create tool.');
    } finally {
      setIsDeploying(false);
    }
  };

  // Step 3 Manual Deployment execution
  const handleManualDeploy = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!createdTool) return;

    setIsManualDeploying(true);
    setStep3Error(null);

    try {
      const effectiveAuthMode = addGmailOauthFlag
        ? gmailAuthChoice
        : (googleProductsDetected.length > 0 ? driveAuthChoice : 'none');

      const effectiveEmail = deployEmailChannel === 'app_password'
        ? deployAppEmail.trim()
        : (deployEmailChannel === 'oauth' ? (step3OAuthEmail || user?.primaryEmailAddress?.emailAddress || '') : (user?.primaryEmailAddress?.emailAddress || ''));

      const configData: Record<string, any> = {
        ...deployConfigValues,
        email_channel_choice: deployEmailChannel,
        user_email: effectiveEmail,
        personal_email: effectiveEmail,
        gmail_app_email: deployAppEmail.trim(),
        gmail_app_password: deployAppPassword.trim(),
        oauth_granted: deployEmailChannel === 'oauth',
        oauth_provider: deployEmailChannel === 'oauth' ? 'google' : 'none',
        oauth_email: deployEmailChannel === 'oauth' ? effectiveEmail : '',
        google_auth_mode: effectiveAuthMode,
        drive_auth_choice: driveAuthChoice,
        manual_file_id: manualFileId.trim(),
        manual_asset_name: manualAssetName.trim(),
        gmail_auth_choice: gmailAuthChoice,
      };

      const dep = await apiClient.deployTool({
        tool_id: createdTool.id,
        user_id: currentUserId,
        config_data: configData,
      });

      setDeployment(dep);
      const host = typeof window !== 'undefined' ? window.location.origin : '';
      const secret = dep.user_webhook_secret || createdTool.webhook_secret;
      const generatedUrl = `${host}/api/proxy/webhooks/${secret}/`;

      setWebhookUrl(generatedUrl);
      setWebhookSecret(secret || null);
    } catch (err: any) {
      setStep3Error(err.message || 'Failed to deploy tool instance.');
    } finally {
      setIsManualDeploying(false);
    }
  };

  const handleCopyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
              {/* Specification 3: Fallback Interface Rendering */}
              {isFallbackActive && fallbackData ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-5"
                >
                  {/* Warning Header */}
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                      <ShieldAlert className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded-md">
                          Fallback Interface Triggered
                        </span>
                        <span className="text-xs text-amber-200/80">Capability Boundary Policy</span>
                      </div>
                      <p className="text-xs text-amber-100/90 mt-1.5 leading-relaxed font-medium">
                        {fallbackData.reason}
                      </p>
                    </div>
                  </div>

                  {/* Specification 3: Exactly 3 Clear Alternative Options */}
                  <div>
                    <p className="text-xs font-semibold text-slate-200 mb-2.5 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Choose from these 3 recommended alternatives:</span>
                    </p>
                    <div className="space-y-2.5">
                      {fallbackData.alternatives.slice(0, 3).map((alt, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/90 border border-slate-700/80 hover:border-indigo-500/60 transition-all group"
                        >
                          <div className="flex items-start gap-3 mr-3">
                            <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <p className="text-xs text-slate-200 leading-snug">
                              {alt}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSelectAlternative(alt)}
                            className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shadow-sm"
                          >
                            Select Alternative
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Specification 3: 4th Element: Custom Message Text Input */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      4. Or enter a custom requirement / message:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customAlternativeInput}
                        onChange={(e) => setCustomAlternativeInput(e.target.value)}
                        placeholder="e.g. Ingest spreadsheet rows and alert users via outgoing email instead..."
                        className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleApplyCustomAlternative();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleApplyCustomAlternative}
                        disabled={!customAlternativeInput.trim()}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium disabled:opacity-40 transition-colors shrink-0"
                      >
                        Apply Custom Refinement
                      </button>
                    </div>
                  </div>

                  {/* Specification 3: Functional Cancel Button */}
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-[11px] text-slate-400">
                      Clicking cancel resets all states and allows you to submit a fresh prompt.
                    </span>
                    <button
                      type="button"
                      onClick={handleCancelFallback}
                      className="px-4 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium transition-colors"
                    >
                      Cancel &amp; Reset Prompt
                    </button>
                  </div>
                </motion.div>
              ) : (
                /* Standard Step 1 Concept Prompt Area */
                <>
                  <div>
                    <label className="block text-sm font-semibold text-slate-200 mb-1">
                      Describe what your AI tool does
                    </label>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Provide a natural language explanation of expected inputs, logic, and actions.
                      Connects directly to 7 Google products (Gmail, Calendar, Docs, Drive, Forms, Meet, Sheets).
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
                      placeholder="e.g., A tool that reads newly added customer rows from a Google Sheet and sends an alert email to the shipping team about the inventory update..."
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
                </>
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
                <div className="flex items-start justify-between gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">
                        Human-in-the-Loop (HITL)
                      </span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.2 rounded border transition-colors ${
                          requiresHitl
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                            : 'bg-slate-800 text-slate-400 border-slate-700 font-medium'
                        }`}
                      >
                        {requiresHitl ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      Pauses LangGraph workflow before destructive actions for manual approval.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={requiresHitl}
                    onClick={() => setRequiresHitl((prev) => !prev)}
                    className={`relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      requiresHitl ? 'bg-indigo-600' : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        requiresHitl ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

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

                {/* Tool Marketplace Visibility (Public vs Private) */}
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">
                        Marketplace Visibility
                      </span>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                          isPublic
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-semibold'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30 font-semibold'
                        }`}
                      >
                        {isPublic ? 'Public (Marketplace)' : 'Private (Only Me)'}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    Tools are public on the marketplace by default. Choose Private if this tool contains confidential internal logic.
                  </p>

                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsPublic(true)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        isPublic
                          ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-600/10 ring-1 ring-indigo-500/50'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <Globe className={`w-3.5 h-3.5 ${isPublic ? 'text-indigo-400' : 'text-slate-500'}`} />
                          <span>Public</span>
                        </span>
                        {isPublic && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[10px] text-slate-400 leading-snug">
                        Discoverable and deployable by any user on the public marketplace.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsPublic(false)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        !isPublic
                          ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-600/10 ring-1 ring-indigo-500/50'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <Lock className={`w-3.5 h-3.5 ${!isPublic ? 'text-amber-400' : 'text-slate-500'}`} />
                          <span>Private</span>
                        </span>
                        {!isPublic && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                      </div>
                      <p className="text-[10px] text-slate-400 leading-snug">
                        Strictly confidential. Visible and executable only by your user account.
                      </p>
                    </button>
                  </div>
                </div>
              </div>

              {/* Specification 3 & 4: Google Products Authorization & Asset Quarantine Configuration */}
              {(googleProductsDetected.length > 0 || addGmailOauthFlag) && (
                <div className="p-5 rounded-2xl bg-slate-950/80 border border-indigo-500/30 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
                        <Database className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                          Google Products Authorization Channels
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          Detected Google products:{' '}
                          <span className="text-indigo-300 font-semibold">
                            {[...googleProductsDetected, ...(addGmailOauthFlag && !googleProductsDetected.includes('Gmail') ? ['Gmail'] : [])].join(', ') || 'Google Cloud'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Zero Cross-Tenant Leakage
                    </span>
                  </div>

                  {/* Section A: Drive/Sheets/Docs/Forms Authorization (if detected) */}
                  {googleProductsDetected.some((p) => ['drive', 'sheets', 'docs', 'documents', 'forms'].includes(p.toLowerCase())) && (
                    <div className="space-y-3">
                      <label className="block text-xs font-semibold text-slate-200">
                        Drive / Sheets / Docs / Forms Authorization Method (Choose 1 of 3):
                      </label>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Choice 1: Full Access OAuth */}
                        <button
                          type="button"
                          onClick={() => setDriveAuthChoice('oauth_full')}
                          className={`p-3.5 rounded-xl border text-left transition-all relative ${
                            driveAuthChoice === 'oauth_full'
                              ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-500/10'
                              : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold">1. Full Access</span>
                            <Lock className={`w-3.5 h-3.5 ${driveAuthChoice === 'oauth_full' ? 'text-indigo-400' : 'text-slate-500'}`} />
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            Standard Google OAuth consent screen granting full Drive file access to the user.
                          </p>
                        </button>

                        {/* Choice 2: Granular Asset Picker */}
                        <button
                          type="button"
                          onClick={() => setDriveAuthChoice('granular_picker')}
                          className={`p-3.5 rounded-xl border text-left transition-all relative ${
                            driveAuthChoice === 'granular_picker'
                              ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-500/10'
                              : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold">2. Granular Asset Picker</span>
                            <FolderCheck className={`w-3.5 h-3.5 ${driveAuthChoice === 'granular_picker' ? 'text-indigo-400' : 'text-slate-500'}`} />
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            Google Picker API dialog to select only specific individual files or folders.
                          </p>
                        </button>

                        {/* Choice 3: Manual Delegation */}
                        <button
                          type="button"
                          onClick={() => setDriveAuthChoice('manual_delegation')}
                          className={`p-3.5 rounded-xl border text-left transition-all relative ${
                            driveAuthChoice === 'manual_delegation'
                              ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-500/10'
                              : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold">3. Manual Delegation</span>
                            <ShieldCheck className={`w-3.5 h-3.5 ${driveAuthChoice === 'manual_delegation' ? 'text-indigo-400' : 'text-slate-500'}`} />
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            Share asset with platform service account: <code className="text-amber-300 font-mono">narainad308@gmail.com</code>.
                          </p>
                        </button>
                      </div>

                      {/* Details Panel for Choice 3: Manual Delegation */}
                      {driveAuthChoice === 'manual_delegation' && (
                        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                          <div className="flex items-start gap-2.5 text-xs text-slate-300">
                            <HelpCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold text-slate-200">How to share your asset with Platform Service Account:</p>
                              <ol className="list-decimal ml-4 mt-1 space-y-1 text-slate-400 text-[11px]">
                                <li>Open Google Drive / Docs / Sheets and locate your target file or folder.</li>
                                <li>Click <span className="text-white font-medium">&quot;Share&quot;</span> and invite our service account: <code className="text-indigo-300 font-mono bg-slate-950 px-1.5 py-0.5 rounded">narainad308@gmail.com</code> with Editor or Viewer permissions.</li>
                                <li>Copy the File ID from the share link (the long alphanumeric string) and enter it below.</li>
                              </ol>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-1">
                            <div className="md:col-span-5">
                              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                                Google File or Folder ID *
                              </label>
                              <input
                                type="text"
                                value={manualFileId}
                                onChange={(e) => setManualFileId(e.target.value)}
                                placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                              />
                            </div>

                            <div className="md:col-span-4">
                              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                                Asset Display Label (Optional)
                              </label>
                              <input
                                type="text"
                                value={manualAssetName}
                                onChange={(e) => setManualAssetName(e.target.value)}
                                placeholder="e.g. Q4 Sales Sheet"
                                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                              />
                            </div>

                            <div className="md:col-span-3">
                              <button
                                type="button"
                                onClick={handleVerifySharedAsset}
                                disabled={isVerifyingAsset || !manualFileId.trim()}
                                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors shadow-sm"
                              >
                                {isVerifyingAsset ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                )}
                                <span>{isVerifyingAsset ? 'Verifying...' : 'Verify Access'}</span>
                              </button>
                            </div>
                          </div>

                          {assetVerificationResult && (
                            <div
                              className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                                assetVerificationResult.verified
                                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                              }`}
                            >
                              {assetVerificationResult.verified ? (
                                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                              ) : (
                                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                              )}
                              <span>{assetVerificationResult.message}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Details Panel for Choice 2: Granular Asset Picker */}
                      {driveAuthChoice === 'granular_picker' && (
                        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-200">Google Picker API Framework</span>
                            <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">Granular Consent</span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Users can selectively authenticate and choose individual spreadsheets or docs at runtime using the interactive Google Picker dialog without granting broad Drive permissions.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Section B: Gmail Outgoing Dispatch (Triggered if add_gmail_oauth_flag is true) */}
                  {addGmailOauthFlag && (
                    <div className="space-y-3 pt-3 border-t border-slate-800/80">
                      <div className="flex items-center justify-between">
                        <label className="block text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Gmail Outbound Authorization Flow (Choose 1 of 3):</span>
                        </label>
                        <span className="text-[10px] font-mono text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          Scope: gmail.send only
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Option 1: Direct OAuth */}
                        <button
                          type="button"
                          onClick={() => setGmailAuthChoice('oauth_send')}
                          className={`p-3.5 rounded-xl border text-left transition-all ${
                            gmailAuthChoice === 'oauth_send'
                              ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-500/10'
                              : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span className="text-xs font-bold block mb-1">1. Direct OAuth</span>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            Authenticate directly via Google OAuth for <code className="text-indigo-300 font-mono">gmail.send</code> capability only.
                          </p>
                        </button>

                        {/* Option 2: App Password */}
                        <button
                          type="button"
                          onClick={() => setGmailAuthChoice('app_password')}
                          className={`p-3.5 rounded-xl border text-left transition-all ${
                            gmailAuthChoice === 'app_password'
                              ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-500/10'
                              : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span className="text-xs font-bold block mb-1">2. Custom App Password</span>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            Supply your Gmail address + App Password generated in Google Account Security.
                          </p>
                        </button>

                        {/* Option 3: Internal Platform System Dispatch */}
                        <button
                          type="button"
                          onClick={() => setGmailAuthChoice('platform_dispatch')}
                          className={`p-3.5 rounded-xl border text-left transition-all ${
                            gmailAuthChoice === 'platform_dispatch'
                              ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-md shadow-indigo-500/10'
                              : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span className="text-xs font-bold block mb-1">3. Platform Dispatch</span>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            Dispatch outgoing messages via internal platform email (<code className="text-amber-300 font-mono">narainad308@gmail.com</code>).
                          </p>
                        </button>
                      </div>

                      {/* Option 2 Details & Tutorial Form */}
                      {gmailAuthChoice === 'app_password' && (
                        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                                Your Gmail Address *
                              </label>
                              <input
                                type="email"
                                value={gmailAppEmail}
                                onChange={(e) => setGmailAppEmail(e.target.value)}
                                placeholder="you@gmail.com"
                                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                                16-Character App Password (App ID) *
                              </label>
                              <input
                                type="password"
                                value={gmailAppPassword}
                                onChange={(e) => setGmailAppPassword(e.target.value)}
                                placeholder="xxxx xxxx xxxx xxxx"
                                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                              />
                            </div>
                          </div>

                          {/* Collapsible Step-by-Step Tutorial Form */}
                          <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/50">
                            <button
                              type="button"
                              onClick={() => setShowAppPasswordTutorial(!showAppPasswordTutorial)}
                              className="w-full px-3 py-2 flex items-center justify-between text-left text-xs font-medium text-indigo-300 hover:bg-slate-900/50 transition-colors"
                            >
                              <span className="flex items-center gap-1.5">
                                <HelpCircle className="w-3.5 h-3.5" />
                                <span>How to generate a Google App Password (Step-by-Step Tutorial)</span>
                              </span>
                              {showAppPasswordTutorial ? (
                                <ChevronUp className="w-4 h-4 text-slate-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-400" />
                              )}
                            </button>

                            {showAppPasswordTutorial && (
                              <div className="p-3 text-[11px] text-slate-300 space-y-2 border-t border-slate-800 bg-slate-950">
                                <p className="font-semibold text-slate-200">Follow these 5 steps in your Google Account:</p>
                                <ol className="list-decimal ml-4 space-y-1 text-slate-400">
                                  <li>Go to your Google Account Security Portal: <a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer" className="text-indigo-400 underline inline-flex items-center gap-1">myaccount.google.com/security <ExternalLink className="w-2.5 h-2.5 inline" /></a></li>
                                  <li>Ensure <span className="text-white font-medium">&quot;2-Step Verification&quot;</span> is turned ON.</li>
                                  <li>In the search box, search for <span className="text-white font-medium">&quot;App Passwords&quot;</span> or navigate to Security &rarr; App Passwords.</li>
                                  <li>Enter <code className="text-indigo-300 bg-slate-900 px-1 py-0.5 rounded">{COMPANY_NAME} Agent</code> as the App Name and click <span className="text-white font-medium">&quot;Create&quot;</span>.</li>
                                  <li>Copy the 16-character generated code (without spaces) and paste it into the field above.</li>
                                </ol>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

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

          {/* STEP 3: Manual Deployment & Webhook Access */}
          {step === 3 && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {!deployment ? (
                /* Manual Deployment Form */
                <form onSubmit={handleManualDeploy} className="space-y-6">
                  <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400 shrink-0">
                      <Rocket className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Configure &amp; Deploy Tool
                      </h3>
                      <p className="text-xs text-slate-300/90 mt-0.5 leading-relaxed">
                        Your tool definition for <span className="font-semibold text-indigo-300">{createdTool?.title}</span> has been created. Fill in the deployment parameters and choose your email delivery method to deploy your first instance.
                      </p>
                    </div>
                  </div>

                  {/* Schema Inputs Configuration */}
                  {createdTool?.form_schema?.properties && Object.keys(createdTool.form_schema.properties).length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                        <span>Deployment Configuration Inputs</span>
                      </h4>
                      <div className="grid grid-cols-1 gap-3.5 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                        {Object.entries(createdTool.form_schema.properties).map(([key, prop]) => (
                          <div key={key}>
                            <label className="block text-xs font-semibold text-slate-300 mb-1">
                              {prop.title || key}
                              {createdTool.form_schema.required?.includes(key) && (
                                <span className="text-indigo-400 ml-1">*</span>
                              )}
                            </label>
                            {prop.type === 'boolean' ? (
                              <label className="flex items-center gap-2 cursor-pointer mt-1">
                                <input
                                  type="checkbox"
                                  checked={!!deployConfigValues[key]}
                                  onChange={(e) =>
                                    setDeployConfigValues((prev) => ({
                                      ...prev,
                                      [key]: e.target.checked,
                                    }))
                                  }
                                  className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700"
                                />
                                <span className="text-xs text-slate-300">Enable</span>
                              </label>
                            ) : (
                              <input
                                type={prop.type === 'number' ? 'number' : 'text'}
                                value={deployConfigValues[key] !== undefined ? deployConfigValues[key] : ''}
                                onChange={(e) =>
                                  setDeployConfigValues((prev) => ({
                                    ...prev,
                                    [key]: prop.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                                  }))
                                }
                                placeholder={`Enter ${prop.title || key}...`}
                                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                              />
                            )}
                            {prop.description && (
                              <p className="text-[11px] text-slate-400 mt-1">{prop.description}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3 Email Delivery Channel Options */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Outbound Email Delivery Service
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Choose which email identity this tool instance should use to dispatch notifications and reports:
                    </p>

                    <div className="grid grid-cols-1 gap-2.5">
                      {/* Option 1: Personal account with OAuth */}
                      <div
                        className={`p-3.5 rounded-xl border transition-all ${
                          deployEmailChannel === 'oauth'
                            ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                            : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="radio"
                            name="deployEmailChannel"
                            value="oauth"
                            checked={deployEmailChannel === 'oauth'}
                            onChange={() => setDeployEmailChannel('oauth')}
                            className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                          />
                          <div>
                            <span className="text-xs font-semibold text-white block">
                              Personal Google Account (via OAuth Authorization)
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Dispatches emails directly from your personal Gmail address using user delegation token.
                            </span>
                          </div>
                        </label>

                        {deployEmailChannel === 'oauth' && (
                          <div className="pl-7 mt-2 pt-2 border-t border-slate-800/80">
                            <GoogleOAuthConsentButton
                              userId={currentUserId}
                              onStatusChange={(connected, email) => {
                                setIsStep3OAuthGranted(connected);
                                if (email) setStep3OAuthEmail(email);
                              }}
                              onSuccess={(email) => {
                                setIsStep3OAuthGranted(true);
                                if (email) setStep3OAuthEmail(email);
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Option 2: Provide App Password */}
                      <label
                        className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                          deployEmailChannel === 'app_password'
                            ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                            : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="deployEmailChannel"
                          value="app_password"
                          checked={deployEmailChannel === 'app_password'}
                          onChange={() => setDeployEmailChannel('app_password')}
                          className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                        />
                        <div className="w-full">
                          <span className="text-xs font-semibold text-white block">
                            Google Account App Password (Direct SMTP)
                          </span>
                          <span className="text-[11px] text-slate-400 block mb-2">
                            Provide your Google email and generated 16-character Google App Password.
                          </span>

                          {deployEmailChannel === 'app_password' && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800">
                              <div>
                                <label className="block text-[11px] text-slate-300 mb-1">
                                  Google Account Email *
                                </label>
                                <input
                                  type="email"
                                  value={deployAppEmail}
                                  onChange={(e) => setDeployAppEmail(e.target.value)}
                                  placeholder="user@gmail.com"
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-slate-300 mb-1">
                                  16-Character App Password *
                                </label>
                                <input
                                  type="password"
                                  value={deployAppPassword}
                                  onChange={(e) => setDeployAppPassword(e.target.value)}
                                  placeholder="xxxx xxxx xxxx xxxx"
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </label>

                      {/* Option 3: Platform Default Account */}
                      <label
                        className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                          deployEmailChannel === 'platform_default'
                            ? 'bg-indigo-950/40 border-indigo-500 ring-1 ring-indigo-500'
                            : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="deployEmailChannel"
                          value="platform_default"
                          checked={deployEmailChannel === 'platform_default'}
                          onChange={() => setDeployEmailChannel('platform_default')}
                          className="mt-0.5 text-indigo-600 focus:ring-0 bg-slate-900 border-slate-700"
                        />
                        <div>
                          <span className="text-xs font-semibold text-white block">
                            Platform Default Outbound Email (narainad308@gmail.com)
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Uses {COMPANY_NAME} managed infrastructure. No OAuth or credentials configuration needed.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {step3Error && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{step3Error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isManualDeploying || (deployEmailChannel === 'oauth' && !isStep3OAuthGranted)}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all active:scale-[0.99]"
                  >
                    {isManualDeploying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Deploying Tool Instance...</span>
                      </>
                    ) : deployEmailChannel === 'oauth' && !isStep3OAuthGranted ? (
                      <>
                        <Lock className="w-4 h-4 text-amber-300" />
                        <span>Grant Google Consent to Enable Deploy</span>
                      </>
                    ) : (
                      <>
                        <Rocket className="w-4 h-4" />
                        <span>Deploy This Tool Instance</span>
                      </>
                    )}
                  </button>
                </form>
              ) : (
                /* Deployed Confirmation View */
                <div className="space-y-6">
                  <div className="text-center py-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-3">
                      <CheckCircle2 className="w-7 h-7" />
                    </div>
                    <h3 className="text-lg font-bold text-white">
                      Tool Instance Deployed Successfully!
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                      Your instance for &apos;{createdTool?.title}&apos; is live. You can execute it directly on the app or trigger it externally via webhook.
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
                      </div>
                    </div>
                  )}

                  {/* Deployment Summary */}
                  <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-2">
                    <div className="font-semibold text-slate-300 pb-1 border-b border-slate-800">
                      Deployment Instance Summary
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Tool:</span>
                      <span className="text-slate-200">{createdTool?.title}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Email Channel:</span>
                      <span className="text-slate-200 capitalize">{deployEmailChannel.replace('_', ' ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Human-In-The-Loop:</span>
                      <span className="text-slate-200">{createdTool?.requires_hitl ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setDeployment(null)}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
                    >
                      Deploy Another Instance
                    </button>
                    <button
                      type="button"
                      onClick={handleResetAndClose}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
                    >
                      Done &amp; View in Dashboard
                    </button>
                  </div>
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
                onClick={handleCreateTool}
                disabled={isDeploying}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all"
              >
                {isDeploying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving Tool Definition...</span>
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" />
                    <span>Save Tool &amp; Continue to Deploy</span>
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
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all"
              >
                <span>Close</span>
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
