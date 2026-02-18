import { useState, useCallback } from 'react';
import { CopilotKit } from '@copilotkit/react-core';
import { ChatPanel } from './components/ChatPanel';
import { EventLog } from './components/EventLog';
import type { AgUiEvent } from './lib/ag-ui-adapter';

/**
 * CopilotKit + LumenFlow AG-UI Demo
 *
 * This app demonstrates how CopilotKit connects to the LumenFlow kernel
 * via the AG-UI protocol. The left panel shows a chat interface (backed
 * by CopilotKit's runtime), and the right panel displays the raw AG-UI
 * event stream as events flow through the kernel.
 *
 * Architecture:
 *
 *   [CopilotKit React UI]
 *        |
 *        v
 *   [AG-UI Adapter] --> POST /ag-ui/v1/run
 *        |
 *        v
 *   [LumenFlow Kernel Runtime]
 *     - TaskEngine.createTask()
 *     - PolicyEngine.evaluate()
 *     - ToolHost.execute() (sandboxed)
 *     - EvidenceStore.append()
 *        |
 *        v
 *   [AG-UI Event Stream] <-- newline-delimited JSON
 *        |
 *        v
 *   [EventLog component] -- real-time visualization
 */
export function App() {
  const [events, setEvents] = useState<AgUiEvent[]>([]);

  const handleEvent = useCallback((event: AgUiEvent) => {
    setEvents((prev) => [...prev, event]);
  }, []);

  return (
    <CopilotKit runtimeUrl="/ag-ui/v1/run">
      <div className="app-layout">
        <header className="app-header">
          <h1>LumenFlow + CopilotKit</h1>
          <span className="badge">AG-UI Protocol</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
            }}
          >
            Connected to mock AG-UI server
          </span>
        </header>

        <ChatPanel onEvent={handleEvent} />
        <EventLog events={events} />
      </div>
    </CopilotKit>
  );
}
