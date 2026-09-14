import { EventEmitter } from 'node:events';
import type { ActivityItem, AgentQuestion, PermissionRequest, AgentTask, FileChangeEvent, UsageEvent } from '../shared/types.js';

/** Global event bus bridging backend modules to the WebSocket bridge. */
export class Bus extends EventEmitter {}

export const bus = new Bus();

export function emitActivity(item: ActivityItem) {
  bus.emit('activity', item);
}
export function emitTask(task: AgentTask) {
  bus.emit('task', task);
}
export function emitPermission(req: PermissionRequest) {
  bus.emit('permission', req);
}
export function emitQuestion(q: AgentQuestion) {
  bus.emit('question', q);
}
export function emitFsChange(ev: FileChangeEvent) {
  bus.emit('fs:change', ev);
}
export function emitUsage(u: UsageEvent) {
  bus.emit('usage', u);
}
