import { useLocation } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { NotFoundState, PermissionDenied } from '../components/States';
import { useT } from '../i18n';

export function ForbiddenPage() {
  const t = useT();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const action = params.get('action') ?? undefined;
  return (
    <>
      <PageHeader title={t('shell.error.forbiddenTitle')} crumbs={[{ label: '403' }]} />
      <div data-tour="forbidden-request">
        <PermissionDenied actionLabel={action} />
      </div>
    </>
  );
}

export function NotFoundPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('shell.error.notFoundTitle')} crumbs={[{ label: '404' }]} />
      <NotFoundState />
    </>
  );
}
