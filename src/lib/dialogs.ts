import { create } from 'zustand';

/**
 * In-app replacement for window.prompt / confirm / alert.
 * Promise-based so call sites stay one-liners:
 *   const path = await promptDialog({ title: 'Add workspace' });
 */

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Offer a native OS folder-picker button alongside manual entry. */
  folderPicker?: boolean;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface DialogState {
  prompt: { opts: PromptOptions; resolve: (v: string | null) => void } | null;
  confirm: { opts: ConfirmOptions; resolve: (v: boolean) => void } | null;
  alertMsg: { title: string; message?: string; resolve: () => void } | null;
  openPrompt: (opts: PromptOptions) => Promise<string | null>;
  openConfirm: (opts: ConfirmOptions) => Promise<boolean>;
  openAlert: (title: string, message?: string) => Promise<void>;
  closePrompt: (v: string | null) => void;
  closeConfirm: (v: boolean) => void;
  closeAlert: () => void;
}

export const useDialogs = create<DialogState>((set) => ({
  prompt: null,
  confirm: null,
  alertMsg: null,
  openPrompt: (opts) => new Promise((resolve) => set({ prompt: { opts, resolve } })),
  openConfirm: (opts) => new Promise((resolve) => set({ confirm: { opts, resolve } })),
  openAlert: (title, message) =>
    new Promise((resolve) => set({ alertMsg: { title, message, resolve } })),
  closePrompt: (v) =>
    set((s) => {
      s.prompt?.resolve(v);
      return { prompt: null };
    }),
  closeConfirm: (v) =>
    set((s) => {
      s.confirm?.resolve(v);
      return { confirm: null };
    }),
  closeAlert: () =>
    set((s) => {
      s.alertMsg?.resolve();
      return { alertMsg: null };
    }),
}));

export const promptDialog = (opts: PromptOptions) => useDialogs.getState().openPrompt(opts);
export const confirmDialog = (opts: ConfirmOptions) => useDialogs.getState().openConfirm(opts);
export const alertDialog = (title: string, message?: string) =>
  useDialogs.getState().openAlert(title, message);
