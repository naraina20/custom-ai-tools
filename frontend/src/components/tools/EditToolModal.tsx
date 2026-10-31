'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiClient } from '@/lib/api-client';
import { CustomTool } from '@/lib/types';
import {
  X,
  Edit2,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  Save,
  Info,
} from 'lucide-react';

interface EditToolModalProps {
  tool: CustomTool | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedTool: CustomTool) => void;
}

interface NewFieldItem {
  name: string;
  title: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
}

export function EditToolModal({ tool, isOpen, onClose, onSuccess }: EditToolModalProps) {
  const [title, setTitle] = useState('');
  const [newFields, setNewFields] = useState<NewFieldItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New field input draft
  const [draftName, setDraftName] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftType, setDraftType] = useState<'string' | 'number' | 'boolean'>('string');
  const [draftDescription, setDraftDescription] = useState('');

  useEffect(() => {
    if (tool && isOpen) {
      setTitle(tool.title || '');
      setNewFields([]);
      setDraftName('');
      setDraftTitle('');
      setDraftType('string');
      setDraftDescription('');
      setError(null);
    }
  }, [tool, isOpen]);

  if (!isOpen || !tool) return null;

  const existingProperties = Object.entries(tool.form_schema?.properties || {});
  const requiredKeys = tool.form_schema?.required || [];

  const handleAddField = () => {
    const rawName = draftName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!rawName) {
      setError('Field identifier/name is required.');
      return;
    }
    // Check collision with existing fields or pending new fields
    if (tool.form_schema?.properties && tool.form_schema.properties[rawName]) {
      setError(`Field "${rawName}" already exists on this tool.`);
      return;
    }
    if (newFields.some((f) => f.name === rawName)) {
      setError(`Field "${rawName}" is already added.`);
      return;
    }

    const item: NewFieldItem = {
      name: rawName,
      title: draftTitle.trim() || rawName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      type: draftType,
      description: draftDescription.trim(),
    };

    setNewFields((prev) => [...prev, item]);
    setDraftName('');
    setDraftTitle('');
    setDraftType('string');
    setDraftDescription('');
    setError(null);
  };

  const handleRemoveNewField = (index: number) => {
    setNewFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Tool name/title cannot be empty.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload: {
        title: string;
        new_fields?: Array<{ name: string; type: string; title: string; description: string }>;
      } = {
        title: title.trim(),
      };

      if (newFields.length > 0) {
        payload.new_fields = newFields;
      }

      const updated = await apiClient.updateCustomTool(tool.id, payload);
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update tool.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-xl my-8 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Edit2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Edit Tool: {tool.title}</h2>
              <p className="text-xs text-slate-400">
                Update the tool name and add optional input schema fields.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto">
          {/* Tool Name / Title Field */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300">
              Tool Name / Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>

          {/* Existing Fields (Read-Only) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span>Existing Input Fields ({existingProperties.length})</span>
              </label>
              <span className="text-[10px] text-slate-500 font-mono">Existing schema locked</span>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 rounded-xl bg-slate-950/50 border border-slate-800/80">
              {existingProperties.map(([key, prop]) => (
                <div
                  key={key}
                  className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800/60 text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-indigo-300">{key}</span>
                    <span className="text-slate-500">({prop.type})</span>
                  </div>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                      requiredKeys.includes(key)
                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {requiredKeys.includes(key) ? 'Required' : 'Optional'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Add New Input Fields Section (Strictly Optional) */}
          <div className="space-y-3 p-4 rounded-xl bg-slate-950/70 border border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-indigo-400" />
                <span>Add New Input Field</span>
              </label>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Strictly Non-Required</span>
              </span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              New fields are automatically non-required to ensure existing deployments and webhook workflows remain 100% backward-compatible.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-2">
                <input
                  type="text"
                  placeholder="field_key (e.g. tracking_id)"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <select
                  value={draftType}
                  onChange={(e) => setDraftType(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Label / Title (optional)"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                placeholder="Description / hint (optional)"
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              type="button"
              onClick={handleAddField}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add to Schema</span>
            </button>

            {/* List of pending new fields */}
            {newFields.length > 0 && (
              <div className="mt-3 space-y-1.5 pt-2 border-t border-slate-800">
                <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider block">
                  New Fields to Add ({newFields.length})
                </span>
                {newFields.map((field, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-indigo-500/20 text-xs"
                  >
                    <div>
                      <span className="font-mono text-white font-medium">{field.name}</span>
                      <span className="text-slate-400 text-[11px] ml-2 font-mono">({field.type})</span>
                      {field.title && field.title !== field.name && (
                        <span className="text-slate-400 text-[11px] ml-2">- {field.title}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveNewField(idx)}
                      className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                      title="Remove field"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-center gap-2 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 py-2.5 px-5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-indigo-600/25 transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Tool Updates</span>
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
