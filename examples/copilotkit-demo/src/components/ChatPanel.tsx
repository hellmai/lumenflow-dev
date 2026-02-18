import { useState, useRef, type FormEvent } from 'react';
import type { AgUiEvent } from '../lib/ag-ui-adapter';
import { sendToAgUi } from '../lib/ag-ui-adapter';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  onEvent: (event: AgUiEvent) => void;
}

const THREAD_ID = `thread-${Date.now()}`;

export function ChatPanel({ onEvent }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const agUiMessages = updatedMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }));

      const assistantText = await sendToAgUi(agUiMessages, onEvent, {
        threadId: THREAD_ID,
      });

      const assistantMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: assistantText || 'Task processed successfully.',
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setTimeout(scrollToBottom, 50);
    } catch (error) {
      const errorMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Error connecting to AG-UI endpoint: ${error instanceof Error ? error.message : 'Unknown error'}. Make sure the mock server is running (npm run dev:server).`,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-panel">
      <div className="panel-header">LumenFlow Chat (via AG-UI)</div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
            }}
          >
            <p style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              Welcome to LumenFlow
            </p>
            <p style={{ fontSize: '0.875rem' }}>
              This chat connects to the LumenFlow kernel via the AG-UI protocol. Every message
              creates a task, evaluates policies, and streams events in real time.
            </p>
            <div
              style={{
                marginTop: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                alignItems: 'center',
              }}
            >
              <p
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Try these:
              </p>
              {[
                'Create a task for adding user authentication',
                'Explain how LumenFlow policies work',
                'Show me how evidence receipts are created',
                'What is scope enforcement?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '0.5rem',
                    padding: '0.5rem 1rem',
                    color: 'var(--color-text)',
                    cursor: 'pointer',
                    fontSize: '0.8125rem',
                    textAlign: 'left',
                    width: '100%',
                    maxWidth: '24rem',
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '0.75rem 1rem',
              borderRadius: '0.75rem',
              background: msg.role === 'user' ? 'var(--color-accent-dim)' : 'var(--color-surface)',
              fontSize: '0.875rem',
              lineHeight: 1.6,
            }}
          >
            {msg.content}
          </div>
        ))}

        {isLoading && (
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '85%',
              padding: '0.75rem 1rem',
              borderRadius: '0.75rem',
              background: 'var(--color-surface)',
              fontSize: '0.875rem',
              color: 'var(--color-text-muted)',
            }}
          >
            Processing via AG-UI...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.75rem 1rem',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask LumenFlow something..."
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '0.625rem 0.875rem',
            borderRadius: '0.5rem',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            fontSize: '0.875rem',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          style={{
            padding: '0.625rem 1.25rem',
            borderRadius: '0.5rem',
            border: 'none',
            background:
              isLoading || !input.trim() ? 'var(--color-surface-alt)' : 'var(--color-accent-dim)',
            color: 'white',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
