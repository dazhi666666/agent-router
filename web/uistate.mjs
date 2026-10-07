// 浏览器侧 UI 状态的持久化：会话改名、归档/置顶、工作区标题。
// dsh 客户端把这些都当 Host 状态（session/rename、workspace/* 直接落盘），会话本体在 sessions.json，
// 这里只存「装饰层」，与运行数据解耦。
import path from 'node:path';
import { readJson, writeJson } from './sessions.mjs';

export class UiState {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'ui-state.json');
    this.data = { titles: {}, archived: [], pinned: [], workspaceTitle: 'Agent Router', workspaceDeleted: false, ...readJson(this.file, {}) };
  }
  save() { writeJson(this.file, this.data); }
  title(id) { return this.data.titles[id] ?? null; }
  rename(id, title) { this.data.titles[id] = String(title); this.save(); }
  get archived() { return this.data.archived; }
  get pinned() { return this.data.pinned; }
  get workspaceTitle() { return this.data.workspaceTitle; }
  archive(id) { if (!this.data.archived.includes(id)) this.data.archived.push(id); this.save(); }
  unarchive(id) { this.data.archived = this.data.archived.filter(x => x !== id); this.save(); }
  pin(id) { if (!this.data.pinned.includes(id)) this.data.pinned.push(id); this.save(); }
  unpin(id) { this.data.pinned = this.data.pinned.filter(x => x !== id); this.save(); }
  renameWorkspace(title) { this.data.workspaceTitle = String(title); this.data.workspaceDeleted = false; this.save(); }
  deleteWorkspace() { this.data.workspaceDeleted = true; this.save(); }
  restoreWorkspace() { this.data.workspaceDeleted = false; this.save(); }
}
