import type { Dict } from '../../types';

/** AppShell（頁首、導覽、頁尾、語言切換）、導覽引擎外框、錯誤頁與共用元件 */
const dict: Dict = {
  // 導覽
  'nav.group.customer': '客戶入口',
  'nav.group.vendor': '平台營運',
  'nav.group.account': '帳戶與團隊',
  'nav.group.help': '說明',
  'nav.hub': '模型中心',
  'nav.playground': 'Playground',
  'nav.keys': 'API 金鑰',
  'nav.usage': '用量與帳單',
  'nav.plan': '試用與方案',
  'nav.overview': '總覽',
  'nav.trials': '試用申請',
  'nav.tenants': '租戶與專案',
  'nav.models': '模型與部署',
  'nav.clusters': '推論叢集',
  'nav.providers': '雲端與夥伴供應商',
  'nav.routing': '路由與溢出',
  'nav.pricing': '定價與帳務',
  'nav.iam': '存取控制 (IAM)',
  'nav.audit': '稽核紀錄',
  'nav.settings': '設定',
  'nav.guides': '操作指引',
  'shell.nav.aria': '主導覽',
  'shell.nav.expand': '展開導覽',
  'shell.nav.collapse': '收合導覽',
  'shell.nav.deniedTooltip': '{label}（無權限）',

  // 頁首
  'shell.brand': 'MaaS 控制台',
  'shell.docTitle': 'MaaS 控制台（示範）',
  'shell.tenant.aria': '租戶選擇器',
  'shell.tenant.all': '所有租戶',
  'shell.search.placeholder': '搜尋模型、金鑰、主體…（Enter）',
  'shell.search.aria': '全域搜尋',
  'shell.notifications.tooltip': '通知（示範：無新通知）',
  'shell.notifications.aria': '通知',
  'shell.help': '說明：重新播放新手指引',
  'shell.theme.tooltip': '主題：{mode}',
  'shell.theme.aria': '切換主題',
  'shell.theme.light': '淺色',
  'shell.theme.dark': '深色',
  'shell.theme.hc': '高對比',
  'shell.lang.label': '語言：{lang}',
  'shell.lang.menu': '介面語言',
  'shell.persona.label': '示範用角色切換',
  'shell.persona.current': '示範用角色切換（目前：{name}）',
  'shell.persona.menu': '示範用角色',
  'shell.user.tooltip': '{name}（{email}）',
  'shell.user.aria': '目前使用者：{name}',
  'shell.user.notSignedIn': '未登入',
  'shell.balance.prepaid': '餘額 {amount}',
  'shell.balance.postpaid': '月結 · {tier}',
  'shell.balance.prepaidTip': '{tenant}：預付可用餘額（總帳 − 本月扣抵）{low}；點擊前往「試用與方案」儲值',
  'shell.balance.lowSuffix': '，餘額偏低',
  'shell.balance.postpaidTip': '{tenant}：月結合約，依對帳單付款；點擊前往「試用與方案」',
  'shell.footer':
    '本系統為自訂示範應用程式，借用 Azure RBAC 概念與 Microsoft Fluent 2 設計語言；並非官方 Azure Portal，亦不管理任何真實 Azure 資源。所有租戶、機房、GPU 指標、價格、成本、餘額與用量皆為虛構示範資料；「推論叢集」是我們（平台供應商）自有的 GPU 機房，客戶以一把金鑰、一個 API 使用自建與代理的模型並由我們收費，與 GMI Cloud、Inferel、阿里雲百煉或任何模型供應商無關。',

  // 頁面標頭
  'shell.breadcrumb.aria': '路徑導覽',

  // 導覽引擎
  'shell.tour.stepOf': '第 {n} / {total} 步',
  'shell.tour.start': '開始導覽',
  'shell.tour.skipStep': '跳過此步',
  'shell.tour.hintDefault': '請直接在畫面上操作，完成後會自動前進。',

  // 狀態元件
  'shell.state.loadError.title': '無法載入資料',
  'shell.state.loadError.body': '{msg}。請確認網路連線後重試；若問題持續，請聯絡平台維運並附上發生時間。',
  'shell.denied.title': '權限不足（403）',
  'shell.denied.cannotAction': '您目前的角色無法執行「{action}」。',
  'shell.denied.cannot': '您目前的角色無法執行此操作。',
  'shell.denied.body': '伺服器已拒絕此請求並寫入稽核紀錄。若您需要此權限，請',
  'shell.denied.request': '向存取管理員申請',
  'shell.denied.end': '。',
  'shell.notFound.title': '找不到{what}（404）',
  'shell.notFound.body': '您要求的{what}不存在，或您沒有檢視它的權限。',
  'shell.notFound.page': '頁面',
  'shell.notFound.resource': '資源',

  // 通知
  'shell.notify.failed': '操作失敗',
  'shell.notify.failedWith': '{context}失敗',
  'shell.notify.failedStatus': '{title}（{status} {code}）',

  // 錯誤頁
  'shell.error.forbiddenTitle': '權限不足',
  'shell.error.notFoundTitle': '找不到頁面',
};

export default dict;
