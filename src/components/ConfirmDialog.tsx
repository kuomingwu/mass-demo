import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { useT } from '../i18n';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 破壞性操作確認對話框；關閉後焦點由 Fluent Dialog 自動還原至觸發元素 */
export function ConfirmDialog({ open, title, children, confirmLabel, destructive, busy, onConfirm, onCancel }: Props) {
  const t = useT();
  return (
    <Dialog open={open} modalType="alert" onOpenChange={(_, d) => !d.open && !busy && onCancel()}>
      <DialogSurface aria-describedby="confirm-dialog-body">
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent id="confirm-dialog-body">{children}</DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              appearance="primary"
              onClick={onConfirm}
              disabled={busy}
              icon={busy ? <Spinner size="tiny" /> : undefined}
              style={destructive ? { backgroundColor: 'var(--colorStatusDangerBackground3)', color: 'var(--colorNeutralForegroundOnBrand)' } : undefined}
            >
              {busy ? t('common.processing') : (confirmLabel ?? t('common.confirm'))}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
