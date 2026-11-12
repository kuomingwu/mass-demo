import { Badge, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Tab, TabList, Text, makeStyles, tokens } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CodeBlock } from '../../components/CodeBlock';
import { PLATFORM_BASE_URL, UNIT_TYPE_LABELS, type ModelInfo } from '../../data/models';
import { apiSnippets } from './hubContent';
import { tf, tl, useT } from '../../i18n';

const useStyles = makeStyles({
  surface: { maxWidth: '760px', width: 'calc(100vw - 32px)' },
  body: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, minWidth: 0 },
  meta: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalXS, alignItems: 'center' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
});

type Lang = 'curl' | 'python' | 'node';

/** 模型卡「API」對話框：以我們的單一 base URL 與 sk-maas- 金鑰呼叫此模型的 curl／Python／Node 範例 */
export function ModelApiDialog({ model, onClose }: { model: ModelInfo | null; onClose: () => void }) {
  const s = useStyles();
  const t = useT();
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>('curl');
  if (!model) return null;
  const snippets = apiSnippets(model, t);
  const code = lang === 'curl' ? snippets.curl : lang === 'python' ? snippets.python : snippets.node;
  const canTry = model.modality !== 'embedding' && model.modality !== 'rerank';
  return (
    <Dialog open modalType="modal" onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={s.surface} aria-describedby="hub-api-desc" data-tour="hub-api-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>{t('hub.apiDialog.title', { name: tf(t, `data.model.${model.id}.displayName`, model.displayName) })}</DialogTitle>
          <DialogContent id="hub-api-desc" className={s.body}>
            <div className={s.meta}>
              <Badge appearance="outline">
                <span className={s.mono}>model: {model.id}</span>
              </Badge>
              <Badge appearance="outline">
                <span className={s.mono}>POST {PLATFORM_BASE_URL}{snippets.endpoint}</span>
              </Badge>
              <Badge appearance="tint" color="informative">
                {tl(t, 'UNIT_TYPE_LABELS', model.unitType, UNIT_TYPE_LABELS[model.unitType])}
              </Badge>
              {model.toolCalling && (
                <Badge appearance="tint" color="success">
                  {t('hub.apiDialog.toolCalling')}
                </Badge>
              )}
            </div>
            <Text size={200}>
              {t('hub.apiDialog.intro1')}
              <code>{PLATFORM_BASE_URL}</code>
              {t('hub.apiDialog.intro2')}
              <code>Authorization: Bearer sk-maas-…</code>
              {t('hub.apiDialog.intro3')}
              <code>x-maas-tier</code>
              {t('hub.apiDialog.intro4')}
              <code>x-maas-model</code>
              {t('hub.apiDialog.intro5')}
            </Text>
            <TabList selectedValue={lang} onTabSelect={(_, d) => setLang(d.value as Lang)} aria-label={t('hub.apiDialog.langAria')} size="small">
              <Tab value="curl">curl</Tab>
              <Tab value="python">Python</Tab>
              <Tab value="node">Node.js</Tab>
            </TabList>
            <CodeBlock code={code} label={t('hub.apiDialog.codeLabel', { model: model.id, lang })} />
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => navigate('/keys')}>
              {t('hub.apiDialog.createKey')}
            </Button>
            {canTry && (
              <Button appearance="primary" onClick={() => navigate(`/playground?model=${encodeURIComponent(model.id)}`)}>
                {t('hub.apiDialog.tryPlayground')}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
