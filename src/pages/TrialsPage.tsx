import { Button } from '@fluentui/react-components';
import { RocketRegular } from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { TrialRequestsTab } from './tenants/TrialRequestsTab';
import { TRIAL_TERMS } from '../server/api';
import { useT } from '../i18n';

/** 試用申請（平台營運）：問卷佇列與審核；核准即建立預付試用租戶（免費額度入帳、Tier 0、僅自建） */
export function TrialsPage() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title={t('hub.trials.title')}
        subtitle={t('hub.trials.subtitle', { usd: TRIAL_TERMS.freeCreditUsd, days: TRIAL_TERMS.periodBusinessDays })}
        crumbs={[{ label: t('hub.trials.title') }]}
        actions={
          <Button icon={<RocketRegular />} onClick={() => navigate('/hub/trial')} data-tour="trials-open-form">
            {t('hub.trials.openForm')}
          </Button>
        }
      />
      <TrialRequestsTab />
    </>
  );
}
