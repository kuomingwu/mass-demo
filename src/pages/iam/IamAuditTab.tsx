import { useState } from 'react';
import { AsyncView, EmptyState } from '../../components/States';
import { AuditFilterBar, AuditTable, type AuditFilters } from '../../components/AuditTable';
import { useApi } from '../../hooks/useApi';
import { server } from '../../server/api';
import { useSession } from '../../app/SessionContext';
import { useT } from '../../i18n';

/** IAM 頁面內嵌的稽核紀錄（限目前範圍、僅 IAM 相關動作預設） */
export function IamAuditTab({ scope, refreshKey }: { scope: string; refreshKey: number }) {
  const t = useT();
  const { session } = useSession();
  const [filters, setFilters] = useState<AuditFilters>({ decision: '', action: '', text: '' });
  const st = useApi(
    () => server.listAuditLogs(session, { scope, decision: filters.decision || undefined, action: filters.action || undefined, text: filters.text || undefined }),
    [session, scope, filters, refreshKey],
  );
  return (
    <>
      <AuditFilterBar value={filters} onChange={setFilters} />
      <AsyncView {...st} actionLabel={t('admin.audit.viewAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('admin.audit.emptyScope')} />}>
        {(events) => <AuditTable events={events} pageSize={10} />}
      </AsyncView>
    </>
  );
}
