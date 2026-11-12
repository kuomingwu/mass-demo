import { Button, Tooltip } from '@fluentui/react-components';
import { ArrowDownloadRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, EmptyState } from '../components/States';
import { AuditFilterBar, AuditTable, type AuditFilters } from '../components/AuditTable';
import { useNotify } from '../components/Notify';
import { useApi, downloadText } from '../hooks/useApi';
import { server } from '../server/api';
import { useSession } from '../app/SessionContext';
import { tenantScope, PLATFORM_SCOPE } from '../auth/scope';
import { useT } from '../i18n';

export function AuditPage() {
  const t = useT();
  const { session, canUi, principal, tenantId } = useSession();
  const notify = useNotify();
  const [filters, setFilters] = useState<AuditFilters>({ decision: '', action: '', text: '' });
  const scope = tenantId ? tenantScope(tenantId) : principal?.tenantId ? tenantScope(principal.tenantId) : PLATFORM_SCOPE;
  const st = useApi(() => server.listAuditLogs(session, { scope, decision: filters.decision || undefined, action: filters.action || undefined, text: filters.text || undefined }), [session, scope, filters]);
  const canExport = canUi('audit.export', scope);
  const [exporting, setExporting] = useState(false);

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await server.exportAudit(session, scope);
      if (res.ok) {
        downloadText(`maas-audit-${scope.replace(/\//g, '_') || 'platform'}.csv`, res.data);
        notify.success(t('admin.audit.exported'), `requestId: ${res.requestId}`);
      } else notify.apiError(res, t('admin.audit.exportContext'));
    } catch (e) {
      notify.apiError(e as Error, t('admin.audit.exportContext'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('admin.audit.title')}
        subtitle={t('admin.audit.subtitle', { scope })}
        crumbs={[{ label: t('admin.audit.title') }]}
        actions={
          <Tooltip content={canExport ? t('common.exportCsv') : t('admin.audit.needExport')} relationship="description">
            <Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={doExport} disabled={exporting}>
              {exporting ? t('admin.audit.exporting') : t('common.export')}
            </Button>
          </Tooltip>
        }
      />
      <AuditFilterBar value={filters} onChange={setFilters} />
      <AsyncView {...st} actionLabel={t('admin.audit.viewAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('admin.audit.emptyTitle')} description={t('admin.audit.emptyDesc')} />}>
        {(events) => <AuditTable events={events} />}
      </AsyncView>
    </>
  );
}
