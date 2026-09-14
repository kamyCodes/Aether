import {
  Check,
  X,
  Loader2,
  Pause,
  Play,
  RotateCw,
  ShieldAlert,
  FileText,
  HelpCircle,
  Circle,
  Ban,
  Square,
} from 'lucide-react';

export {
  Check,
  X,
  Loader2,
  Pause,
  Play,
  RotateCw,
  ShieldAlert,
  FileText,
  HelpCircle,
  Circle,
  Ban,
  Square,
};

/** Icon for an AgentTask status. */
export function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
    case 'planning':
      return <Loader2 size={13} className="icon-run spin" />;
    case 'completed':
      return <Check size={13} strokeWidth={2.5} className="icon-ok" />;
    case 'failed':
      return <X size={13} strokeWidth={2.5} className="icon-err" />;
    case 'cancelled':
      return <Ban size={13} className="icon-dim" />;
    case 'paused':
    case 'awaiting_permission':
    case 'awaiting_question':
      return <Pause size={13} className="icon-warn" />;
    default:
      return <Circle size={11} className="icon-dim" />;
  }
}

/** Icon for an ActivityItem status. */
export function ActivityStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'done':
      return <Check size={13} strokeWidth={2.5} className="icon-ok" />;
    case 'running':
      return <Loader2 size={13} className="icon-run spin" />;
    case 'error':
      return <X size={13} strokeWidth={2.5} className="icon-err" />;
    default:
      return <Circle size={11} className="icon-dim" />;
  }
}
