import { Breadcrumb, BreadcrumbButton, BreadcrumbDivider, BreadcrumbItem, Text, Title2, makeStyles, tokens } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalL,
  },
  titleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalS,
  },
  titleBlock: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXXS },
  actions: { display: 'flex', columnGap: tokens.spacingHorizontalS, alignItems: 'center', flexWrap: 'wrap' },
  subtitle: { color: tokens.colorNeutralForeground2 },
});

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({ title, subtitle, crumbs, actions, children }: { title: string; subtitle?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode; children?: ReactNode }) {
  const s = useStyles();
  const navigate = useNavigate();
  const t = useT();
  const allCrumbs: Crumb[] = [{ label: t('shell.brand'), to: '/' }, ...(crumbs ?? [])];
  return (
    <header className={s.root}>
      <Breadcrumb aria-label={t('shell.breadcrumb.aria')} size="small">
        {allCrumbs.map((c, i) => (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <BreadcrumbDivider />}
            <BreadcrumbItem>
              {c.to && i < allCrumbs.length - 1 ? (
                <BreadcrumbButton onClick={() => navigate(c.to!)}>{c.label}</BreadcrumbButton>
              ) : (
                <BreadcrumbButton current>{c.label}</BreadcrumbButton>
              )}
            </BreadcrumbItem>
          </span>
        ))}
      </Breadcrumb>
      <div className={s.titleRow}>
        <div className={s.titleBlock}>
          <Title2 as="h1">{title}</Title2>
          {subtitle && (
            <Text size={300} className={s.subtitle}>
              {subtitle}
            </Text>
          )}
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
      {children}
    </header>
  );
}
