import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  Square,
  Plus,
  Trash2,
  MessageSquare,
  BookMarked,
  Sparkles,
  ChevronDown,
  X,
  FileText,
  Lightbulb,
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import { providers, buildSystemPrompt } from '../providers/ai-providers';
import type { ChatMessage, AIProvider, HighlightColor } from '../types';
import AnnotationsPanel from './AnnotationsPanel';

export default function AISidebar() {
  const {
    conversations,
    activeConversation,
    isStreaming,
    selectedTextForAI,
    selectedPageForAI,
    selectedRectsForAI,
    pdfText,
    sidebarTab,
    sidebarWidth,
    settings,
    activeHighlightColor,
    newConversation,
    addMessage,
    updateLastAssistantMessage,
    setActiveConversation,
    setIsStreaming,
    deleteConversation,
    clearSelectedTextForAI,
    setSidebarTab,
    setActiveProvider,
    addHighlight,
    setSidebarWidth,
  } = useStore();

  const [input, setInput] = useState('');
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [startWidth, setStartWidth] = useState(0);
  const [startX, setStartX] = useState(0);

  const activeConv = conversations.find((c) => c.id === activeConversation);
  const activeProviderConfig = settings.providers[settings.activeProvider];

  // Resize handler
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    setStartWidth(sidebarWidth);
    setStartX(e.clientX);
    document.body.style.cursor = 'col-resize';
  }, [sidebarWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      e.preventDefault();
      const deltaX = startX - e.clientX;
      const newWidth = startWidth + deltaX;
      const clampedWidth = Math.max(0, newWidth);
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.cursor = '';
      }
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, startWidth, startX, setSidebarWidth]);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages]);

  // When text is selected for AI, focus the input (but don't populate it)
  useEffect(() => {
    if (selectedTextForAI) {
      inputRef.current?.focus();
    }
  }, [selectedTextForAI]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if ((!text && !selectedTextForAI) || isStreaming) return;

    // Ensure we have a conversation
    let convId = activeConversation;
    if (!convId) {
      convId = newConversation();
    }

    const uid = () => Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

    // Build the full message content including context
    let fullContent = text;
    if (selectedTextForAI) {
      if (text) {
        fullContent = `Regarding this passage from page ${selectedPageForAI}:\n\n"${selectedTextForAI}"\n\n${text}`;
      } else {
        fullContent = `Please explain this passage from page ${selectedPageForAI}:\n\n"${selectedTextForAI}"`;
      }
    }

    // Add user message (with context info for display and key points extraction)
    const userMsg: ChatMessage & { rects?: typeof selectedRectsForAI } = {
      id: uid(),
      role: 'user',
      content: fullContent,
      timestamp: Date.now(),
      selectedText: selectedTextForAI || undefined,
      pageNumber: selectedTextForAI ? selectedPageForAI : undefined,
    };
    // Store rects for key points extraction
    if (selectedRectsForAI.length > 0) {
      (userMsg as any).rects = [...selectedRectsForAI];
    }
    addMessage(convId, userMsg);
    setInput('');

    // Clear the selected text context
    clearSelectedTextForAI();

    // Add placeholder assistant message
    const assistantMsg: ChatMessage = {
      id: uid(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    addMessage(convId, assistantMsg);
    setIsStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const conv = useStore.getState().conversations.find((c) => c.id === convId);
      // Get all messages except system messages, then remove the empty assistant placeholder at the end
      const allMessages = conv?.messages.filter((m) => m.role !== 'system') || [];
      // Remove the empty assistant placeholder from messages sent to API
      const apiMessages = allMessages.slice(0, -1).filter((m) => m.content);

      const systemPrompt = buildSystemPrompt(pdfText);
      const provider = providers[settings.activeProvider];

      if (!provider) {
        updateLastAssistantMessage(convId, '⚠️ Provider not found. Check your settings.');
        setIsStreaming(false);
        return;
      }

      let accumulated = '';

      await provider.chat(apiMessages, systemPrompt, activeProviderConfig, abort.signal, {
        onToken: (token) => {
          accumulated += token;
          updateLastAssistantMessage(convId!, accumulated);
        },
        onDone: () => {},
        onError: (err) => {
          updateLastAssistantMessage(convId!, `⚠️ Error: ${err.message}`);
        },
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        updateLastAssistantMessage(convId, `⚠️ Error: ${err.message}`);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [
    input,
    isStreaming,
    activeConversation,
    pdfText,
    settings.activeProvider,
    activeProviderConfig,
    selectedTextForAI,
    selectedPageForAI,
    selectedRectsForAI,
    newConversation,
    addMessage,
    updateLastAssistantMessage,
    setIsStreaming,
    clearSelectedTextForAI,
  ]);

  // Extract key points from the last AI response and add as a comment
  const extractKeyPoints = useCallback(async () => {
    if (!activeConv || isStreaming) return;

    // Find the last assistant message
    const lastAssistantMsg = [...activeConv.messages].reverse().find(m => m.role === 'assistant' && m.content);
    // Find the corresponding user message with context
    const userMsgWithContext = [...activeConv.messages].reverse().find(m => m.role === 'user' && m.selectedText);

    if (!lastAssistantMsg || !userMsgWithContext?.selectedText || !userMsgWithContext.pageNumber) {
      return;
    }

    // We need to get the rects - if we don't have them, we can't create a highlight
    // For now, we'll store rects in the user message
    const storedRects = (userMsgWithContext as any).rects;

    // Ask AI to extract key points
    const uid = () => Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    const convId = activeConv.id;

    // Add a user message asking for key points
    const extractMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: 'Please summarize the above explanation in 2-3 concise bullet points that capture the key insights.',
      timestamp: Date.now(),
    };
    addMessage(convId, extractMsg);

    // Add placeholder assistant message
    const assistantMsg: ChatMessage = {
      id: uid(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    addMessage(convId, assistantMsg);
    setIsStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const conv = useStore.getState().conversations.find((c) => c.id === convId);
      const allMessages = conv?.messages.filter((m) => m.role !== 'system') || [];
      const apiMessages = allMessages.slice(0, -1).filter((m) => m.content);

      const systemPrompt = buildSystemPrompt(pdfText);
      const provider = providers[settings.activeProvider];

      if (!provider) {
        updateLastAssistantMessage(convId, 'Provider not found.');
        setIsStreaming(false);
        return;
      }

      let accumulated = '';

      await provider.chat(apiMessages, systemPrompt, activeProviderConfig, abort.signal, {
        onToken: (token) => {
          accumulated += token;
          updateLastAssistantMessage(convId!, accumulated);
        },
        onDone: () => {
          // Create a highlight with the key points as a comment
          if (accumulated && storedRects && storedRects.length > 0) {
            addHighlight({
              id: Math.random().toString(36).substring(2, 10),
              page: userMsgWithContext.pageNumber!,
              rects: storedRects,
              text: userMsgWithContext.selectedText!,
              color: activeHighlightColor,
              type: 'highlight',
              comment: accumulated,
              createdAt: Date.now(),
            });
          }
        },
        onError: (err) => {
          updateLastAssistantMessage(convId!, `Error: ${err.message}`);
        },
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        updateLastAssistantMessage(convId, `Error: ${err.message}`);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [activeConv, isStreaming, pdfText, settings.activeProvider, activeProviderConfig, activeHighlightColor, addMessage, updateLastAssistantMessage, setIsStreaming, addHighlight]);

  const stopStreaming = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col bg-surface-1 relative">
      {/* Resize handle */}
      <div
        ref={resizeRef}
        onMouseDown={handleMouseDown}
        className={`absolute left-0 top-0 bottom-0 w-2 cursor-col-resize transition-colors ${
          isResizing ? 'bg-accent/20' : 'hover:bg-accent/10 group'
        }`}
        title="Drag to resize"
      >
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 bg-surface-4 rounded group-hover:bg-surface-5" />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-3 flex-shrink-0">
        <TabButton
          active={sidebarTab === 'chat'}
          icon={<Sparkles size={14} />}
          label="AI Chat"
          onClick={() => setSidebarTab('chat')}
        />
        <TabButton
          active={sidebarTab === 'annotations'}
          icon={<BookMarked size={14} />}
          label="Annotations"
          onClick={() => setSidebarTab('annotations')}
        />
      </div>

      {sidebarTab === 'chat' ? (
        <>
          {/* Provider selector + conversation list */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-3 flex-shrink-0">
            {/* Provider dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowProviderMenu(!showProviderMenu)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-surface-2 text-text-secondary hover:bg-surface-3 transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${activeProviderConfig.enabled || activeProviderConfig.id === 'ollama' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                {activeProviderConfig.name}
                <ChevronDown size={12} />
              </button>

              {showProviderMenu && (
                <div className="absolute top-full left-0 mt-1 bg-surface-3 border border-surface-4 rounded-lg shadow-xl z-50 min-w-[180px] py-1 animate-fade-in">
                  {(Object.keys(settings.providers) as AIProvider[]).map((id) => {
                    const p = settings.providers[id];
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          setActiveProvider(id);
                          setShowProviderMenu(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-surface-4 transition-colors ${
                          id === settings.activeProvider ? 'text-accent-light' : 'text-text-secondary'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${p.enabled || p.id === 'ollama' ? 'bg-emerald-400' : 'bg-surface-4'}`} />
                        {p.name}
                        <span className="text-text-muted ml-auto">{p.model}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex-1" />

            <button
              onClick={() => {
                const id = newConversation();
                setActiveConversation(id);
              }}
              className="p-1 rounded-md text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors"
              title="New chat"
            >
              <Plus size={15} />
            </button>
          </div>

          {/* Conversation tabs */}
          {conversations.length > 1 && (
            <div className="flex gap-1 px-3 py-1.5 border-b border-surface-3 overflow-x-auto flex-shrink-0">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setActiveConversation(conv.id)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors ${
                    conv.id === activeConversation
                      ? 'bg-accent/20 text-accent-light'
                      : 'text-text-muted hover:bg-surface-3 hover:text-text-secondary'
                  }`}
                >
                  <MessageSquare size={11} />
                  <span className="max-w-[120px] truncate">{conv.title}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="ml-1 opacity-0 group-hover:opacity-100 hover:text-red-400"
                  >
                    <X size={10} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {!activeConv || activeConv.messages.length === 0 ? (
              <EmptyChat />
            ) : (
              activeConv.messages.map((msg) => <ChatBubble key={msg.id} message={msg} />)
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="flex-shrink-0 p-3 border-t border-surface-3">
            {/* Selected text context card */}
            {selectedTextForAI && (
              <div className="mb-2 p-2 bg-accent/10 border border-accent/20 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-accent-light">
                    <FileText size={12} />
                    <span className="text-[10px] uppercase tracking-wider">Page {selectedPageForAI}</span>
                  </div>
                  <button
                    onClick={clearSelectedTextForAI}
                    className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
                <p className="text-xs text-text-secondary line-clamp-2">"{selectedTextForAI}"</p>
              </div>
            )}

            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedTextForAI ? "Ask about this passage…" : "Ask about the document…"}
                rows={Math.min(6, Math.max(1, input.split('\n').length))}
                className="w-full bg-surface-2 text-text-primary text-sm rounded-xl px-4 py-3 pr-12 resize-none outline-none border border-surface-3 focus:border-accent/40 transition-colors placeholder-text-muted"
              />
              <button
                onClick={isStreaming ? stopStreaming : sendMessage}
                disabled={!input.trim() && !isStreaming}
                className={`absolute right-2 bottom-2 p-2 rounded-lg transition-colors ${
                  isStreaming
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : input.trim() || selectedTextForAI
                      ? 'bg-accent/20 text-accent-light hover:bg-accent/30'
                      : 'text-text-muted cursor-not-allowed'
                }`}
              >
                {isStreaming ? <Square size={16} /> : <Send size={16} />}
              </button>
            </div>

            {/* Key Points button - show when there's a conversation with context */}
            {activeConv && activeConv.messages.some(m => m.selectedText) && !isStreaming && (
              <button
                onClick={extractKeyPoints}
                className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 text-xs bg-surface-2 text-text-secondary hover:text-accent-light hover:bg-surface-3 rounded-lg transition-colors"
              >
                <Lightbulb size={14} />
                Extract key points as comment
              </button>
            )}
          </div>
        </>
      ) : (
        <AnnotationsPanel />
      )}
    </div>
  );
}

// ─── Sub-components ───

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
        active
          ? 'text-accent-light border-b-2 border-accent'
          : 'text-text-muted hover:text-text-secondary'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`chat-message flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-accent/20 text-text-primary rounded-br-md'
            : 'bg-surface-2 text-text-primary rounded-bl-md'
        }`}
      >
        {message.content ? (
          <div
            className="whitespace-pre-wrap break-words"
            dangerouslySetInnerHTML={{
              __html: formatMarkdown(message.content),
            }}
          />
        ) : (
          <div className="loading-dots flex gap-1.5 py-1">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 opacity-60">
      <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <Sparkles size={22} className="text-accent-light" />
      </div>
      <p className="text-sm text-text-secondary font-medium mb-1">Ask about your document</p>
      <p className="text-xs text-text-muted leading-relaxed">
        Select text in the PDF and click "Ask AI", or type a question below. The AI has access to
        the full document for context.
      </p>
    </div>
  );
}

// ─── Simple markdown formatting ───

function formatMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-surface-3 px-1 py-0.5 rounded text-accent-light text-[0.85em]">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<strong class="text-base">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong class="text-lg">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong class="text-xl">$1</strong>')
    .replace(/^- (.+)$/gm, '• $1');
}
