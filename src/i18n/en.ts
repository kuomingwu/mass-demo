// en 字典入口：合併各區域字典（src/i18n/dict/en/*.ts）。鍵集合必須與其他語言完全一致（見 src/i18n/__tests__/i18n.test.ts）。
import type { Dict } from './types';
import common from './dict/en/common';
import shell from './dict/en/shell';
import data from './dict/en/data';
import server from './dict/en/server';
import guides from './dict/en/guides';
import flows from './dict/en/flows';
import hub from './dict/en/hub';
import customer from './dict/en/customer';
import billing from './dict/en/billing';
import overview from './dict/en/overview';
import ops from './dict/en/ops';
import admin from './dict/en/admin';

const dict: Dict = { ...common, ...shell, ...data, ...server, ...guides, ...flows, ...hub, ...customer, ...billing, ...overview, ...ops, ...admin };

export default dict;
