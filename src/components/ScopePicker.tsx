import { Dropdown, Field, Option, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useMemo } from 'react';
import { isAncestorOrSelf, projectScope, tenantScope, PLATFORM_SCOPE } from '../auth/scope';
import { PROJECTS, TENANTS } from '../server/seed';
import { getLocale, makeT, tenantLabel, useT, type TFunction } from '../i18n';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXS },
  path: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

export interface ScopeOption {
  value: string;
  label: string;
  level: 'platform' | 'tenant' | 'project';
}

/** 未傳入 t 時以目前語言翻譯（非 React 呼叫端） */
function resolveT(t?: TFunction): TFunction {
  return t ?? makeT(getLocale());
}

export function allScopeOptions(t?: TFunction): ScopeOption[] {
  const tt = resolveT(t);
  const out: ScopeOption[] = [{ value: PLATFORM_SCOPE, label: tt('admin.scope.platformAll'), level: 'platform' }];
  for (const tn of TENANTS) {
    out.push({ value: tenantScope(tn.id), label: tt('admin.scope.tenant', { name: tenantLabel(tt, tn.id, tn.name) }), level: 'tenant' });
    for (const p of PROJECTS.filter((x) => x.tenantId === tn.id)) {
      out.push({ value: projectScope(tn.id, p.id), label: `　${tt('admin.scope.project', { name: p.name, tenant: tenantLabel(tt, tn.id, tn.name) })}`, level: 'project' });
    }
  }
  return out;
}

export function scopeDisplayName(scope: string, t?: TFunction): string {
  const o = allScopeOptions(t).find((x) => x.value === scope);
  return o ? o.label.trim() : scope;
}

/**
 * 範圍的短名稱（不含所屬租戶）：平台 → 「平台」、租戶 → 「租戶：名稱」、專案 → 「專案：名稱」。
 * withPrefix=false 時只回傳名稱（麵包屑用）。
 */
export function scopeShortName(scope: string, t?: TFunction, withPrefix = true): string {
  const tt = resolveT(t);
  if (scope === PLATFORM_SCOPE) return tt('admin.scope.platform');
  for (const tn of TENANTS) {
    if (scope === tenantScope(tn.id)) return withPrefix ? tt('admin.scope.tenant', { name: tenantLabel(tt, tn.id, tn.name) }) : tenantLabel(tt, tn.id, tn.name);
    for (const p of PROJECTS.filter((x) => x.tenantId === tn.id)) {
      if (scope === projectScope(tn.id, p.id)) return withPrefix ? tt('admin.scope.projectShort', { name: p.name }) : p.name;
    }
  }
  return scope;
}

interface Props {
  value: string;
  onChange: (scope: string) => void;
  /** 僅允許位於這些委派範圍（含子範圍）內的選項 */
  allowedRoots?: string[];
  label?: string;
  disabled?: boolean;
}

export function ScopePicker({ value, onChange, allowedRoots, label, disabled }: Props) {
  const s = useStyles();
  const t = useT();
  const fieldLabel = label ?? t('common.scope');
  const options = useMemo(() => {
    const all = allScopeOptions(t);
    if (!allowedRoots) return all;
    return all.filter((o) => allowedRoots.some((r) => isAncestorOrSelf(r, o.value)));
  }, [allowedRoots, t]);
  const selected = options.find((o) => o.value === value);
  return (
    <div className={s.root}>
      <Field label={fieldLabel} hint={allowedRoots ? t('admin.scope.delegableOnly') : undefined}>
        <Dropdown
          value={selected?.label.trim() ?? value}
          selectedOptions={[value]}
          onOptionSelect={(_, d) => d.optionValue && onChange(d.optionValue)}
          disabled={disabled}
          aria-label={fieldLabel}
        >
          {options.map((o) => (
            <Option key={o.value} value={o.value} text={o.label.trim()}>
              {o.label}
            </Option>
          ))}
        </Dropdown>
      </Field>
      <Text className={s.path}>{value}</Text>
    </div>
  );
}
