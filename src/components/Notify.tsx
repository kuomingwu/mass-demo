import { Toast, ToastBody, ToastTitle, Toaster, useId, useToastController } from '@fluentui/react-components';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ApiError } from '../server/api';
import { apiMessage, useT } from '../i18n';

interface Notifier {
  success: (title: string, body?: ReactNode) => void;
  pending: (title: string, body?: ReactNode) => void;
  error: (title: string, body?: ReactNode) => void;
  /** context：已翻譯的動作名稱（例如 t('customer.keys.create')），標題會成為「{context}失敗」 */
  apiError: (err: ApiError | Error, context?: string) => void;
}

const Ctx = createContext<Notifier | null>(null);

export function NotifyProvider({ children }: { children: ReactNode }) {
  const toasterId = useId('toaster');
  const { dispatchToast } = useToastController(toasterId);
  const t = useT();
  const value = useMemo<Notifier>(() => {
    const show = (intent: 'success' | 'warning' | 'error' | 'info', title: string, body?: ReactNode) =>
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
          {body && <ToastBody>{body}</ToastBody>}
        </Toast>,
        { intent, timeout: intent === 'error' ? 8000 : 5000 },
      );
    const failed = (context?: string) => (context ? t('shell.notify.failedWith', { context }) : t('shell.notify.failed'));
    return {
      success: (title, b) => show('success', title, b),
      pending: (title, b) => show('warning', title, b),
      error: (title, b) => show('error', title, b),
      apiError: (err, context) => {
        if (err instanceof Error) show('error', failed(context), err.message);
        else show('error', t('shell.notify.failedStatus', { title: failed(context), status: err.status, code: err.code }), `${apiMessage(t, err as Parameters<typeof apiMessage>[1])} requestId: ${err.requestId}`);
      },
    };
  }, [dispatchToast, t]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Toaster toasterId={toasterId} position="top-end" pauseOnHover />
    </Ctx.Provider>
  );
}

export function useNotify(): Notifier {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNotify must be used within NotifyProvider');
  return v;
}
