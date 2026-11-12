import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody, MessageBarTitle, Spinner, Text } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { useNotify } from '../../components/Notify';
import { PermissionDenied } from '../../components/States';
import { useSession } from '../../app/SessionContext';
import { server, type ApiError, type DeploymentView } from '../../server/api';
import { apiMessage, useT } from '../../i18n';

export function ScaleDeploymentDialog({ deployment, onClose, onScaled }: { deployment: DeploymentView | null; onClose: () => void; onScaled: () => void }) {
  const t = useT();
  const { session, bump } = useSession();
  const notify = useNotify();
  const [replicas, setReplicas] = useState('1');
  const [busy, setBusy] = useState(false);
  // 伺服器錯誤（例如 400 INSUFFICIENT_GPUS）直接顯示在對話框內，而不只靠 toast
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => {
    if (deployment) {
      setReplicas(String(deployment.replicas));
      setError(null);
    }
  }, [deployment]);
  if (!deployment) return null;
  const n = Number(replicas);
  const valid = Number.isInteger(n) && n >= 0 && n <= deployment.autoscaling.maxReplicas && (n > 0 || deployment.autoscaling.scaleToZero);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await server.scaleDeployment(session, deployment.id, n);
      if (res.ok) {
        notify.success(t('ops.scale.toast', { name: deployment.name, n }), `requestId: ${res.requestId}`);
        bump();
        onScaled();
        onClose();
      } else {
        setError(res);
        notify.apiError(res, t('ops.scale.action'));
      }
    } catch (e) {
      notify.apiError(e as Error, t('ops.scale.action'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && !busy && onClose()}>
      <DialogSurface aria-describedby="scale-body">
        <DialogBody>
          <DialogTitle>{t('ops.scale.title', { name: deployment.name })}</DialogTitle>
          <DialogContent id="scale-body">
            <Text as="p" size={200}>
              {t(deployment.autoscaling.scaleToZero ? 'ops.scale.bodyZero' : 'ops.scale.bodyNoZero', { replicas: deployment.replicas, gpus: deployment.gpusPerReplica, min: deployment.autoscaling.minReplicas, max: deployment.autoscaling.maxReplicas })}
            </Text>
            {error && error.status === 403 && <PermissionDenied inline error={error} />}
            {error && error.status !== 403 && (
              <MessageBar intent="error" role="alert" style={{ marginBottom: 8 }} data-tour="scale-error">
                <MessageBarBody>
                  <MessageBarTitle>
                    {t('ops.scale.rejected', { status: error.status, code: error.code })}
                  </MessageBarTitle>
                  {apiMessage(t, error)} requestId: {error.requestId}
                </MessageBarBody>
              </MessageBar>
            )}
            <Field label={t('ops.scale.replicas')} validationState={valid ? 'none' : 'error'} validationMessage={valid ? undefined : n === 0 ? t('ops.scale.noZero') : t('ops.scale.range', { min: deployment.autoscaling.scaleToZero ? 0 : 1, max: deployment.autoscaling.maxReplicas })}>
              <Input
                type="number"
                min={0}
                max={deployment.autoscaling.maxReplicas}
                value={replicas}
                onChange={(_, d) => {
                  setReplicas(d.value);
                  setError(null);
                }}
              />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button appearance="primary" onClick={submit} disabled={busy || !valid} icon={busy ? <Spinner size="tiny" /> : undefined}>
              {busy ? t('common.processing') : t('common.apply')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
