import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Action, Principal } from '../auth/types';
import { server, type Session } from '../server/api';
import { PERSONAS } from '../server/seed';

interface SessionCtx {
  session: Session;
  personaId: string;
  setPersona: (id: string) => void;
  principal: Principal | null;
  /** 可用性判斷（非安全邊界）：UI 用來隱藏／停用按鈕 */
  canUi: (action: Action, scope: string) => boolean;
  canUiAnywhere: (action: Action) => boolean;
  /** 每次切換角色、或資料異動後遞增，用來觸發重新載入 */
  version: number;
  bump: () => void;
  /** 目前選取的租戶（租戶選擇器） */
  tenantId: string | null;
  setTenantId: (id: string | null) => void;
  simulateError: boolean;
  setSimulateError: (v: boolean) => void;
  /** 示範開關：模擬自建容量耗盡（溢出／429） */
  simulateLocalExhausted: boolean;
  setSimulateLocalExhausted: (v: boolean) => void;
  /** 示範開關：模擬叢集中斷 */
  simulateClusterOutage: boolean;
  setSimulateClusterOutage: (v: boolean) => void;
}

const Ctx = createContext<SessionCtx | null>(null);

const STORAGE_KEY = 'maas-demo-persona';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [personaId, setPersonaId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? 'owner';
    } catch {
      return 'owner';
    }
  });
  const [version, setVersion] = useState(0);
  const [simulateError, setSimulateErrorState] = useState(false);
  const [simulateLocalExhausted, setSimulateLocalExhaustedState] = useState(server.options.simulateLocalExhausted);
  const [simulateClusterOutage, setSimulateClusterOutageState] = useState(server.options.simulateClusterOutage);
  const persona = PERSONAS.find((p) => p.id === personaId) ?? PERSONAS[0];
  const session = useMemo<Session>(() => ({ userId: persona.userId }), [persona.userId]);
  const principal = useMemo(() => server.authenticate(session), [session]);
  const [tenantId, setTenantId] = useState<string | null>(principal?.tenantId ?? null);

  useEffect(() => {
    setTenantId(principal?.tenantId ?? null);
  }, [principal?.tenantId]);

  const setPersona = useCallback((id: string) => {
    setPersonaId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    setVersion((v) => v + 1);
  }, []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const setSimulateError = useCallback((v: boolean) => {
    server.options.forceError = v;
    setSimulateErrorState(v);
  }, []);
  const setSimulateLocalExhausted = useCallback((v: boolean) => {
    server.options.simulateLocalExhausted = v;
    setSimulateLocalExhaustedState(v);
  }, []);
  const setSimulateClusterOutage = useCallback((v: boolean) => {
    server.options.simulateClusterOutage = v;
    setSimulateClusterOutageState(v);
  }, []);

  // 穩定的函式參考：只在主體或資料版本改變時重建，避免下游 useMemo／useEffect 每次 render 都重算
  // （例如建立金鑰後 bump() 讓抽屜的重設 effect 把一次性明文清掉）
  const canUi = useCallback((action: Action, scope: string) => server.canUi(session, action, scope), [session, principal, version]);
  const canUiAnywhere = useCallback((action: Action) => server.canUiAnywhere(session, action), [session, principal, version]);

  const value = useMemo<SessionCtx>(
    () => ({
      session,
      personaId: persona.id,
      setPersona,
      principal,
      canUi,
      canUiAnywhere,
      version,
      bump,
      tenantId,
      setTenantId,
      simulateError,
      setSimulateError,
      simulateLocalExhausted,
      setSimulateLocalExhausted,
      simulateClusterOutage,
      setSimulateClusterOutage,
    }),
    [session, persona.id, setPersona, principal, canUi, canUiAnywhere, version, bump, tenantId, simulateError, setSimulateError, simulateLocalExhausted, setSimulateLocalExhausted, simulateClusterOutage, setSimulateClusterOutage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within SessionProvider');
  return v;
}
