// zh-TW 字典入口：合併各區域字典（src/i18n/dict/zh-TW/*.ts）。鍵集合必須與其他語言完全一致（見 src/i18n/__tests__/i18n.test.ts）。
import type { Dict } from './types';
import common from './dict/zh-TW/common';
import shell from './dict/zh-TW/shell';
import data from './dict/zh-TW/data';
import server from './dict/zh-TW/server';
import guides from './dict/zh-TW/guides';
import flows from './dict/zh-TW/flows';
import hub from './dict/zh-TW/hub';
import customer from './dict/zh-TW/customer';
import billing from './dict/zh-TW/billing';
import overview from './dict/zh-TW/overview';
import ops from './dict/zh-TW/ops';
import admin from './dict/zh-TW/admin';

const dict: Dict = { ...common, ...shell, ...data, ...server, ...guides, ...flows, ...hub, ...customer, ...billing, ...overview, ...ops, ...admin };

export default dict;
