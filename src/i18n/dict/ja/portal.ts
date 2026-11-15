import type { Dict } from '../../types';

// 2 つのポータル（カスタマーポータル／管理コンソール）専用の文言：ブランド、メニューグループ、ポータル別のガイドステップ
const dict: Dict = {
  'shell.brand.admin': 'MaaS 管理コンソール',
  'shell.docTitle.admin': 'MaaS 管理コンソール（デモ）',
  'nav.group.tenantTools': 'テナントサポート',

  // カスタマーポータルのウェルカムツアー
  'guides.welcome-customer.title': 'MaaS カスタマーポータルへようこそ',
  'guides.welcome-customer.summary': '2 分でカスタマーポータルを一巡します。モデルハブ、Playground、API キー、使用量と請求、トライアルとプランを紹介します。',
  'guides.welcome-customer.pages.0.label': 'モデルハブ',
  'guides.welcome-customer.step.welcome.title': 'ようこそ：1 つのキーで主要モデルをすべて',
  'guides.welcome-customer.step.welcome.body': 'sk-maas- キー 1 つと OpenAI 互換の base URL 1 つで、ここにあるすべてのモデルを呼び出せます。オープンウェイトのモデルは当社の台湾データセンターの GPU で動きます。GPT、Claude、Gemini などのクローズドモデルは当社がプロキシし、同じ請求書にまとめます。\nデータはすべて架空のデモデータです。いつでも「スキップ」できます。',
  'guides.welcome-customer.step.persona.title': 'デモ用ペルソナの切り替え',
  'guides.welcome-customer.step.persona.body': 'このポータルでは、さまざまなお客様の役割を試せます。たとえば顧客管理者、オペレーター、閲覧者、監査、経理、公共部門の管理者、トライアル顧客です。役割ごとに使える機能と権限が異なります。',
  'guides.welcome-customer.step.nav-hub.title': 'モデルハブから始める',
  'guides.welcome-customer.step.nav-hub.body': 'モデルハブには、利用できるすべてのモデルと価格、提供元が並びます。モダリティや提供元で絞り込めます。トライアルの申請もここから行えます。',
  'guides.welcome-customer.step.nav-playground.title': 'Playground',
  'guides.welcome-customer.step.nav-playground.body': 'コードを書かずにモデルを試せます。応答の横に、使用したトークン数、料金、同等の curl コマンドが表示されます。',
  'guides.welcome-customer.step.nav-keys.title': 'API キー',
  'guides.welcome-customer.step.nav-keys.body': 'アプリケーション用のキーを作成します。キーの表示は一度だけです。有効期限、利用可能なモデル、予算上限を設定できます。',
  'guides.welcome-customer.step.nav-usage.title': '使用量と請求',
  'guides.welcome-customer.step.nav-usage.body': '日ごとの使用量、モデル別の利用額、今月の明細を確認できます。CSV でのエクスポートも可能です。',
  'guides.welcome-customer.step.nav-plan.title': 'トライアルとプラン',
  'guides.welcome-customer.step.nav-plan.body': 'プリペイド残高、レート制限のティア、プランの内容を確認し、ここでチャージできます。',
  'guides.welcome-customer.step.nav-guides.title': '操作ガイド',
  'guides.welcome-customer.step.nav-guides.body': '各ガイドは実際の操作を 1 ステップずつ案内します。たとえばモデルハブから最初の API 呼び出しまで、キーの作成とテストなどです。',
  'guides.welcome-customer.step.help.title': 'いつでも再生できます',
  'guides.welcome-customer.step.help.body': '右上の「ヘルプ」または「操作ガイド」ページから、どのガイドも開き直せます。',
  'guides.welcome-customer.step.done.title': 'ツアー完了',
  'guides.welcome-customer.step.done.body': '次は「モデルハブから最初の API 呼び出しまで」のガイドをおすすめします。',

  // 管理コンソール版のウェルカムツアーのステップ
  'guides.welcome.step.persona-admin.title': 'デモ用ペルソナの切り替え',
  'guides.welcome.step.persona-admin.body': '管理コンソールでは当社の 3 つの役割に切り替えられます。プラットフォームオーナー（トライアル審査、テナント、価格、アクセス承認）、プラットフォーム運用（データセンターとデプロイ）、プラットフォーム財務（価格と請求）です。お客様に見える画面は別のサイト、つまりカスタマーポータルにあります。',
  'guides.welcome.step.nav-guides-admin.title': '操作ガイド',
  'guides.welcome.step.nav-guides-admin.body': 'ここにあるガイドはすべてプラットフォーム運用の業務です。自社 GPU の接続、クラスター登録、モデルのデプロイ、テナントの開設、プロバイダー接続、ルーティングとスピルオーバー、請求、トライアル審査を扱います。',
  'guides.welcome.step.done-admin.title': 'ツアー完了',
  'guides.welcome.step.done-admin.body': '次は「自社 GPU の接続」と「クラスター登録」のガイドをおすすめします。お客様の体験を確認するには、カスタマーポータルを開いてください。',

  // トライアル申請：ポータルごとに担当部分だけを案内
  'guides.trial-request.step.intro-admin.title': 'トライアル申請の審査',
  'guides.trial-request.step.intro-admin.body': 'お客様がカスタマーポータルでテスト用の質問票を送信すると、申請がこのキューに届きます。このガイドでは申請を 1 件審査し、トライアルテナントを開設します。',
  'guides.trial-request.step.queue-admin.hint': '審査待ちの行を選んでください。',
  'guides.trial-request.step.queue-admin.title': 'トライアル申請のキュー',
  'guides.trial-request.step.queue-admin.body': '各行はお客様が送信したテスト用の質問票 1 件です。会社とテストアカウント、連絡先、テストするモデル、国内要件、ステータスが並びます。審査待ちの申請を開いてください。',
  'guides.trial-request.step.done-admin.title': '完了',
  'guides.trial-request.step.done-admin.body': 'トライアル申請を 1 件審査し、プリペイドのトライアルテナントが作成されました。お客様側の申請手順は、カスタマーポータルの「トライアル申請」にあります。',
  'guides.trial-request.step.done-dialog-customer.title': '申請を受け付けました',
  'guides.trial-request.step.done-dialog-customer.body': '返ってくるのは申請番号だけです。この時点ではアカウントもキーも作成されません。数秒後にモデルハブへ戻ります。',
  'guides.trial-request.step.done-customer.title': '完了',
  'guides.trial-request.step.done-customer.body': '申請を送信しました。当社のチームが承認すると、トライアルアカウントを開設してお知らせします。トライアル中の残高と有効期限は「トライアルとプラン」で確認できます。',
};

export default dict;
