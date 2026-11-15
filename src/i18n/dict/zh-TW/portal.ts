import type { Dict } from '../../types';

// 兩個入口（客戶入口／管理後台）專用的文案：品牌、選單群組，以及各入口版本的指引步驟
const dict: Dict = {
  'shell.brand.admin': 'MaaS 管理後台',
  'shell.docTitle.admin': 'MaaS 管理後台（示範）',
  'nav.group.tenantTools': '租戶支援工具',

  // 客戶入口的歡迎導覽
  'guides.welcome-customer.title': '歡迎使用 MaaS 客戶入口',
  'guides.welcome-customer.summary': '兩分鐘認識客戶入口：模型中心、Playground、API 金鑰、用量與帳單、試用與方案。',
  'guides.welcome-customer.pages.0.label': '模型中心',
  'guides.welcome-customer.step.welcome.title': '歡迎：一把金鑰，所有主流模型',
  'guides.welcome-customer.step.welcome.body': '您用一把 sk-maas- 金鑰與一個 OpenAI 相容的 base URL，就能呼叫這裡所有的模型。開源模型跑在我們台灣機房的 GPU 上。GPT、Claude、Gemini 等閉源模型由我們代理，費用合併在同一張帳單。\n所有資料都是虛構的示範資料。隨時可以按「略過」。',
  'guides.welcome-customer.step.persona.title': '示範用角色切換',
  'guides.welcome-customer.step.persona.body': '這個入口可以切換成不同的客戶角色來體驗，例如客戶管理員、操作員、檢視者、稽核、帳務、公部門管理員與試用客戶。不同角色看到的功能與權限不同。',
  'guides.welcome-customer.step.nav-hub.title': '從模型中心開始',
  'guides.welcome-customer.step.nav-hub.body': '模型中心列出所有可用的模型、價格與來源。可以依模態與來源篩選，也可以從這裡申請測試。',
  'guides.welcome-customer.step.nav-playground.title': 'Playground',
  'guides.welcome-customer.step.nav-playground.body': '不用寫程式就能試模型。回覆旁邊會顯示這次用了多少 token、花了多少錢，以及等效的 curl 指令。',
  'guides.welcome-customer.step.nav-keys.title': 'API 金鑰',
  'guides.welcome-customer.step.nav-keys.body': '建立給程式用的金鑰。金鑰只顯示一次，可以設定到期日、可用模型與預算上限。',
  'guides.welcome-customer.step.nav-usage.title': '用量與帳單',
  'guides.welcome-customer.step.nav-usage.body': '查看每天的用量、各模型的花費與當月對帳單，也可以匯出 CSV。',
  'guides.welcome-customer.step.nav-plan.title': '試用與方案',
  'guides.welcome-customer.step.nav-plan.body': '查看預付餘額、限流等級與方案內容，並在這裡儲值。',
  'guides.welcome-customer.step.nav-guides.title': '操作指引',
  'guides.welcome-customer.step.nav-guides.body': '每一則指引都會一步一步帶您實際操作，例如從模型中心到第一次 API 呼叫、建立金鑰並測試。',
  'guides.welcome-customer.step.help.title': '隨時重新播放',
  'guides.welcome-customer.step.help.body': '按右上角「說明」或到「操作指引」頁，就能重新開啟任何一則指引。',
  'guides.welcome-customer.step.done.title': '導覽完成',
  'guides.welcome-customer.step.done.body': '建議接著做「從模型中心到第一次 API 呼叫」這則指引。',

  // 管理後台版本的歡迎導覽步驟
  'guides.welcome.step.persona-admin.title': '示範用角色切換',
  'guides.welcome.step.persona-admin.body': '管理後台可以切換成我們自己的三種角色：平台擁有者（審核試用、租戶、定價、存取核准）、平台營運（機房與部署）、平台財務（定價與帳務）。客戶看到的畫面在另一個網站，也就是客戶入口。',
  'guides.welcome.step.nav-guides-admin.title': '操作指引',
  'guides.welcome.step.nav-guides-admin.body': '這裡的指引都是平台營運的工作：接上自建 GPU、註冊叢集、部署模型、開通租戶、連接供應商、路由與溢出、帳務、審核試用申請。',
  'guides.welcome.step.done-admin.title': '導覽完成',
  'guides.welcome.step.done-admin.body': '建議接著做「接上自建 GPU」與「註冊叢集」兩則指引。要看客戶的體驗，請開啟客戶入口。',

  // 試用申請：兩個入口各自的那一半
  'guides.trial-request.step.intro-admin.title': '審核試用申請',
  'guides.trial-request.step.intro-admin.body': '客戶在客戶入口填完測試問卷後，申請會進到這裡的佇列。這則指引帶您審核一筆申請並開通試用租戶。',
  'guides.trial-request.step.queue-admin.hint': '點選狀態為「待審」的那一列。',
  'guides.trial-request.step.queue-admin.title': '試用申請佇列',
  'guides.trial-request.step.queue-admin.body': '每一列是一筆客戶送出的測試問卷：公司與測試帳號、聯絡人、要測的模型、在地需求與狀態。請打開待審的那一筆。',
  'guides.trial-request.step.done-admin.title': '完成',
  'guides.trial-request.step.done-admin.body': '您審核了一筆試用申請，系統已建立預付的試用租戶。客戶端的申請流程在客戶入口的「申請測試」。',
  'guides.trial-request.step.done-dialog-customer.title': '已收到申請',
  'guides.trial-request.step.done-dialog-customer.body': '系統只回覆申請編號，不會立刻建立帳號或金鑰。幾秒後會自動回到模型中心。',
  'guides.trial-request.step.done-customer.title': '完成',
  'guides.trial-request.step.done-customer.body': '申請已送出。我們的團隊審核通過後，會開通試用帳號並通知您。試用期間的餘額與到期日可以在「試用與方案」查看。',
};

export default dict;
