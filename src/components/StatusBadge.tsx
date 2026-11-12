import { Badge, type BadgeProps } from '@fluentui/react-components';
import {
  CheckmarkCircleRegular,
  ClockRegular,
  DismissCircleRegular,
  ErrorCircleRegular,
  InfoRegular,
  PauseCircleRegular,
  QuestionCircleRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import type { ReactElement } from 'react';
import { useT } from '../i18n';

type Kind = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'pending' | 'unknown';

const MAP: Record<Kind, { color: BadgeProps['color']; icon: ReactElement }> = {
  success: { color: 'success', icon: <CheckmarkCircleRegular /> },
  warning: { color: 'warning', icon: <WarningRegular /> },
  danger: { color: 'danger', icon: <DismissCircleRegular /> },
  info: { color: 'informative', icon: <InfoRegular /> },
  neutral: { color: 'subtle', icon: <PauseCircleRegular /> },
  pending: { color: 'warning', icon: <ClockRegular /> },
  unknown: { color: 'subtle', icon: <QuestionCircleRegular /> },
};

/** 狀態一律以「圖示 + 文字」呈現，不以顏色單獨表意 */
export function StatusBadge({ kind, label, size = 'medium' }: { kind: Kind; label: string; size?: BadgeProps['size'] }) {
  const m = MAP[kind];
  return (
    <Badge appearance="tint" color={m.color} icon={m.icon} size={size} role="status" aria-label={label}>
      {label}
    </Badge>
  );
}

export function healthKind(h: string): Kind {
  if (h === 'healthy') return 'success';
  if (h === 'degraded') return 'warning';
  if (h === 'down') return 'danger';
  return 'unknown';
}

export function DecisionBadge({ decision }: { decision: 'allow' | 'deny' }) {
  const t = useT();
  return decision === 'allow' ? <StatusBadge kind="success" label={t('data.ui.decision.allow')} /> : <StatusBadge kind="danger" label={t('data.ui.decision.deny')} />;
}

export function AssignmentStatusBadge({ status }: { status: 'active' | 'pending' | 'expired' | 'rejected' }) {
  const t = useT();
  switch (status) {
    case 'active':
      return <StatusBadge kind="success" label={t('data.ui.assignment.active')} />;
    case 'pending':
      return <StatusBadge kind="pending" label={t('data.ui.assignment.pending')} />;
    case 'expired':
      return <StatusBadge kind="neutral" label={t('data.ui.assignment.expired')} />;
    case 'rejected':
      return <StatusBadge kind="danger" label={t('data.ui.assignment.rejected')} />;
  }
}

export { ErrorCircleRegular };
