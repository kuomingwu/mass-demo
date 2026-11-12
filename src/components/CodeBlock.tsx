import { Button, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { CheckmarkRegular, CopyRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useT } from '../i18n';

const useStyles = makeStyles({
  root: { position: 'relative' },
  pre: {
    margin: 0,
    padding: tokens.spacingVerticalM,
    paddingRight: '48px',
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    overflowX: 'auto',
    whiteSpace: 'pre',
    color: tokens.colorNeutralForeground1,
  },
  copy: { position: 'absolute', top: '6px', right: '6px' },
});

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const s = useStyles();
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: ignore */
    }
  };
  return (
    <div className={s.root}>
      <pre className={s.pre} tabIndex={0} aria-label={label}>
        <code>{code}</code>
      </pre>
      <Tooltip content={copied ? t('common.copied') : t('common.copy')} relationship="label">
        <Button className={s.copy} size="small" appearance="subtle" icon={copied ? <CheckmarkRegular /> : <CopyRegular />} onClick={copy} aria-label={t('common.copyLabel', { label })} />
      </Tooltip>
    </div>
  );
}
