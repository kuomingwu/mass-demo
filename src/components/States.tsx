import { Button, Link, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle, Skeleton, SkeletonItem, Text, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowClockwiseRegular, DocumentSearchRegular, LockClosedRegular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import type { ApiError } from '../server/api';
import { apiMessage, useT } from '../i18n';

const useStyles = makeStyles({
  skeletonList: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, paddingTop: tokens.spacingVerticalS },
  row: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', columnGap: tokens.spacingHorizontalM },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    rowGap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalXXXL} ${tokens.spacingHorizontalL}`,
    color: tokens.colorNeutralForeground2,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  icon: { fontSize: '32px', color: tokens.colorNeutralForeground3 },
  denied: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalXXL,
    maxWidth: '640px',
  },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

export function LoadingSkeleton({ rows = 6, label }: { rows?: number; label?: string }) {
  const s = useStyles();
  const t = useT();
  return (
    <Skeleton aria-label={label ?? t('common.loading')} className={s.skeletonList}>
      {Array.from({ length: rows }).map((_, i) => (
        <div className={s.row} key={i}>
          <SkeletonItem size={24} />
          <SkeletonItem size={24} />
          <SkeletonItem size={24} />
          <SkeletonItem size={24} />
        </div>
      ))}
    </Skeleton>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  const s = useStyles();
  return (
    <div className={s.empty} role="status">
      <DocumentSearchRegular className={s.icon} aria-hidden />
      <Text weight="semibold">{title}</Text>
      {description && <Text size={200}>{description}</Text>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error | string; onRetry?: () => void }) {
  const t = useT();
  const msg = typeof error === 'string' ? error : error.message;
  return (
    <MessageBar intent="error" role="alert">
      <MessageBarBody>
        <MessageBarTitle>{t('shell.state.loadError.title')}</MessageBarTitle>
        {t('shell.state.loadError.body', { msg })}
      </MessageBarBody>
      {onRetry && (
        <MessageBarActions>
          <Button icon={<ArrowClockwiseRegular />} onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </MessageBarActions>
      )}
    </MessageBar>
  );
}

/** 403 權限不足狀態（頁面級或區塊級） */
export function PermissionDenied({ error, inline = false, actionLabel }: { error?: ApiError | null; inline?: boolean; actionLabel?: string }) {
  const s = useStyles();
  const t = useT();
  const body = (
    <>
      <MessageBar intent="warning" role="alert" icon={<LockClosedRegular />}>
        <MessageBarBody>
          <MessageBarTitle>{t('shell.denied.title')}</MessageBarTitle>
          {error ? apiMessage(t, error as Parameters<typeof apiMessage>[1]) : actionLabel ? t('shell.denied.cannotAction', { action: actionLabel }) : t('shell.denied.cannot')}
          {' '}
          {t('shell.denied.body')}
          <Link as="a" href="#/iam?tab=requests">
            {t('shell.denied.request')}
          </Link>
          {t('shell.denied.end')}
        </MessageBarBody>
      </MessageBar>
      {error?.requestId && <Text className={s.mono}>requestId: {error.requestId}</Text>}
    </>
  );
  if (inline) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{body}</div>;
  return (
    <div className={s.denied}>
      {body}
      <div>
        <Button as="a" href="#/" appearance="secondary">
          {t('common.backToOverview')}
        </Button>
      </div>
    </div>
  );
}

/** what：已翻譯的名詞（例如 t('shell.notFound.resource')）；省略時為「頁面」 */
export function NotFoundState({ what }: { what?: string }) {
  const s = useStyles();
  const t = useT();
  const w = what ?? t('shell.notFound.page');
  return (
    <div className={s.denied}>
      <MessageBar intent="info">
        <MessageBarBody>
          <MessageBarTitle>{t('shell.notFound.title', { what: w })}</MessageBarTitle>
          {t('shell.notFound.body', { what: w })}
        </MessageBarBody>
      </MessageBar>
      <div>
        <Button as="a" href="#/">
          {t('common.backToOverview')}
        </Button>
      </div>
    </div>
  );
}

interface AsyncViewProps<T> {
  loading: boolean;
  data: T | null;
  apiError: { status: number; message: string; requestId: string; code: string } | null;
  networkError: Error | null;
  reload: () => void;
  isEmpty?: (d: T) => boolean;
  empty?: ReactNode;
  skeletonRows?: number;
  children: (data: T) => ReactNode;
  actionLabel?: string;
}

/** 統一處理載入 / 錯誤 / 403 / 404 / 空狀態 */
export function AsyncView<T>({ loading, data, apiError, networkError, reload, isEmpty, empty, skeletonRows, children, actionLabel }: AsyncViewProps<T>) {
  const t = useT();
  if (loading && data === null) return <LoadingSkeleton rows={skeletonRows} />;
  if (networkError) return <ErrorState error={networkError} onRetry={reload} />;
  if (apiError) {
    if (apiError.status === 403 || apiError.status === 401) return <PermissionDenied error={apiError as ApiError} inline actionLabel={actionLabel} />;
    if (apiError.status === 404) return <NotFoundState what={t('shell.notFound.resource')} />;
    return <ErrorState error={`${apiError.code}: ${apiMessage(t, apiError as Parameters<typeof apiMessage>[1])}`} onRetry={reload} />;
  }
  if (data === null) return null;
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState title={t('common.noData')} />}</>;
  return <>{children(data)}</>;
}

export function RouterLinkText({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link as="a" href={`#${to}`}>
      {children}
    </Link>
  );
}

export { RouterLink };
