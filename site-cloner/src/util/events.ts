export type Stage = 'setup' | 'analyze' | 'plan' | 'generate' | 'validate' | 'preview' | 'modify' | 'done' | 'error';

export interface AgentEvent {
  stage: Stage;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: Record<string, unknown>;
}

export type Emit = (e: AgentEvent) => void;

export const consoleEmit: Emit = (e) => {
  const icon = { info: '·', warn: '!', error: '✗', success: '✓' }[e.level];
  console.log(`${icon} [${e.stage}] ${e.message}`);
};

export function emitter(emit: Emit, stage: Stage) {
  return {
    info: (message: string, data?: AgentEvent['data']) => emit({ stage, level: 'info', message, data }),
    warn: (message: string, data?: AgentEvent['data']) => emit({ stage, level: 'warn', message, data }),
    error: (message: string, data?: AgentEvent['data']) => emit({ stage, level: 'error', message, data }),
    ok: (message: string, data?: AgentEvent['data']) => emit({ stage, level: 'success', message, data }),
  };
}
