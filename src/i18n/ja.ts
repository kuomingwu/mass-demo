// ja 字典入口：合併各區域字典（src/i18n/dict/ja/*.ts）。鍵集合必須與其他語言完全一致（見 src/i18n/__tests__/i18n.test.ts）。
import type { Dict } from './types';
import common from './dict/ja/common';
import shell from './dict/ja/shell';
import data from './dict/ja/data';
import server from './dict/ja/server';
import guides from './dict/ja/guides';
import flows from './dict/ja/flows';
import hub from './dict/ja/hub';
import customer from './dict/ja/customer';
import billing from './dict/ja/billing';
import overview from './dict/ja/overview';
import ops from './dict/ja/ops';
import admin from './dict/ja/admin';

const dict: Dict = { ...common, ...shell, ...data, ...server, ...guides, ...flows, ...hub, ...customer, ...billing, ...overview, ...ops, ...admin };

export default dict;
