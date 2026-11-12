import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody, MessageBarTitle, Text, makeStyles, tokens } from '@fluentui/react-components';
import { DismissRegular, WalletCreditCardRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { useSession } from '../app/SessionContext';
import { useNotify } from './Notify';
import { server, type ApiError, type TenantAccount } from '../server/api';
import { TOPUP_MAX_USD, TOPUP_MIN_USD, TOPUP_PRESETS_USD } from '../data/commercial';
import { formatUsd } from '../theme/chartPalette';
import { apiMessage, useLocale, useT } from '../i18n';

const useStyles = makeStyles({
  presets: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  body: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

/**
 * 儲值對話框（預付租戶）：US$10–10,000（示意）。伺服器端檢查 billing.topup、計費模式與金額範圍並寫入稽核（前後餘額）。
 * 成功訊息只在伺服器回應後顯示；關閉後由呼叫端重新載入帳戶。
 */
export function TopUpDialog({ open, tenantId, tenantName, onClose, onDone }: { open: boolean; tenantId: string; tenantName?: string; onClose: () => void; onDone?: (account: TenantAccount) => void }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, bump } = useSession();
  const notify = useNotify();
  const [amount, setAmount] = useState('100');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  useEffect(() => {
    if (open) {
      setAmount('100');
      setErr(null);
    }
  }, [open]);
  const n = Number(amount);
  const valid = Number.isFinite(n) && n >= TOPUP_MIN_USD && n <= TOPUP_MAX_USD;
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await server.topUpCredits(session, tenantId, n);
      if (!res.ok) {
        setErr(res);
        return;
      }
      notify.success(t('billing.topup.successTitle', { amount: formatUsd(res.data.record.amountUsd, 0) }), t('billing.topup.successBody', { available: formatUsd(res.data.account.credits?.availableUsd ?? 0), requestId: res.requestId }));
      bump();
      onDone?.(res.data.account);
      onClose();
    } catch (e) {
      notify.apiError(e as Error, t('billing.topup.errContext'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} modalType="modal" onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface aria-describedby="topup-desc" data-tour="topup-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>
            <WalletCreditCardRegular style={{ verticalAlign: '-3px', marginRight: 6 }} />
            {tenantName ? t('billing.topup.titleFor', { tenant: tenantName }) : t('billing.topup.title')}
          </DialogTitle>
          <DialogContent id="topup-desc" className={s.body}>
            <Text size={300}>{t('billing.topup.intro', { min: TOPUP_MIN_USD, max: L.fmtNumber(TOPUP_MAX_USD) })}</Text>
            <div className={s.presets} role="group" aria-label={t('billing.topup.presetsAria')}>
              {TOPUP_PRESETS_USD.map((p) => (
                <Button key={p} size="small" appearance={String(p) === amount ? 'primary' : 'secondary'} onClick={() => setAmount(String(p))}>
                  US${L.fmtNumber(p)}
                </Button>
              ))}
            </div>
            <Field label={t('billing.topup.amountLabel')} validationState={amount && !valid ? 'error' : 'none'} validationMessage={amount && !valid ? t('billing.topup.rangeError', { min: TOPUP_MIN_USD, max: L.fmtNumber(TOPUP_MAX_USD) }) : undefined}>
              <Input type="number" min={TOPUP_MIN_USD} max={TOPUP_MAX_USD} step={10} value={amount} onChange={(_, d) => setAmount(d.value)} data-tour="topup-amount" />
            </Field>
            {err && (
              <MessageBar intent="error" role="alert">
                <MessageBarBody>
                  <MessageBarTitle>
                    {err.status} {err.code}
                  </MessageBarTitle>
                  {apiMessage(t, err)} <span className={s.mono}>requestId: {err.requestId}</span>
                </MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button appearance="primary" onClick={submit} disabled={busy || !valid} data-tour="topup-submit">
              {busy ? t('common.processing') : t('billing.topup.submit', { amount: valid ? formatUsd(n, 0) : '' })}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
