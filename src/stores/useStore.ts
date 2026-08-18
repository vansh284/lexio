import { create } from 'zustand';
import type {
  PdfFileData,
  Highlight,
  Annotation,
  ChatMessage,
  ChatConversation,
  AppSettings,
  AIProvider,
  HighlightColor,
  AnnotationType,
  RelativeRect,
  ProviderConfig,
} from '../types';
import { DEFAULT_PROVIDERS } from '../types';

export type ToolType = 'select' | AnnotationType | 'comment';

// Undo/Redo action types
type UndoAction =
  | { type: 'add_highlight'; highlight: Highlight }
  | { type: 'remove_highlight'; highlight: Highlight }
  | { type: 'update_comment'; id: string; oldComment: string | undefined; newComment: string };

interface AppState {
  // PDF
  pdfFile: PdfFileData | null;
  pdfText: string;
  pageTexts: Map<number, string>;
  numPages: number;
  currentPage: number;
  zoom: number;

  // Annotations
  highlights: Highlight[];
  annotations: Annotation[];
  activeHighlightColor: HighlightColor;
  activeTool: ToolType;

  // Undo/Redo
  undoStack: UndoAction[];
  redoStack: UndoAction[];

  // AI
  conversations: ChatConversation[];
  activeConversation: string | null;
  isStreaming: boolean;
  selectedTextForAI: string;
  selectedPageForAI: number;
  selectedRectsForAI: RelativeRect[];

  // UI
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarTab: 'chat' | 'annotations' | 'settings';
  settingsOpen: boolean;
  thumbnailSidebarOpen: boolean;

  // Settings
  settings: AppSettings;

  // PDF Actions
  setPdfFile: (file: PdfFileData | null) => void;
  setPdfText: (text: string) => void;
  setPageText: (page: number, text: string) => void;
  setNumPages: (n: number) => void;
  setCurrentPage: (p: number) => void;
  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;

  // Annotation Actions
  addHighlight: (h: Highlight) => void;
  removeHighlight: (id: string) => void;
  updateHighlightComment: (id: string, comment: string) => void;
  addAnnotation: (a: Annotation) => void;
  removeAnnotation: (id: string) => void;
  setActiveHighlightColor: (c: HighlightColor) => void;
  setActiveTool: (t: ToolType) => void;

  // Undo/Redo Actions
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // AI Actions
  setSelectedTextForAI: (text: string, page: number, rects?: RelativeRect[]) => void;
  clearSelectedTextForAI: () => void;
  newConversation: () => string;
  addMessage: (convId: string, msg: ChatMessage) => void;
  updateLastAssistantMessage: (convId: string, content: string) => void;
  setActiveConversation: (id: string | null) => void;
  setIsStreaming: (v: boolean) => void;
  deleteConversation: (id: string) => void;

  // UI Actions
  toggleSidebar: () => void;
  setSidebarOpen: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setSidebarTab: (t: 'chat' | 'annotations' | 'settings') => void;
  setSettingsOpen: (v: boolean) => void;
  toggleThumbnailSidebar: () => void;
  setThumbnailSidebarOpen: (v: boolean) => void;

  // Settings Actions
  updateSettings: (s: Partial<AppSettings>) => void;
  setActiveProvider: (p: AIProvider) => void;
  updateProviderConfig: (id: string, config: Partial<ProviderConfig>) => void;
}

const uid = () => Math.random().toString(36).substring(2, 10) + Date.now().toString(36);

export const useStore = create<AppState>((set, get) => ({
  // ─── Initial State ───

  pdfFile: null,
  pdfText: '',
  pageTexts: new Map(),
  numPages: 0,
  currentPage: 1,
  zoom: 1.0,

  highlights: [],
  annotations: [],
  activeHighlightColor: 'yellow',
  activeTool: 'select',
  undoStack: [],
  redoStack: [],

  conversations: [],
  activeConversation: null,
  isStreaming: false,
  selectedTextForAI: '',
  selectedPageForAI: 0,
  selectedRectsForAI: [],

  sidebarOpen: true,
  sidebarWidth: 420,
  sidebarTab: 'chat',
  settingsOpen: false,
  thumbnailSidebarOpen: true,

  settings: {
    providers: { ...DEFAULT_PROVIDERS },
    activeProvider: 'ollama',
    sidebarOpen: true,
    sidebarWidth: 420,
    theme: 'dark',
    sendFullPdfContext: true,
    maxContextPages: 50,
  },

  // ─── PDF ───

  setPdfFile: (file) => set({ pdfFile: file, highlights: [], annotations: [], currentPage: 1, pageTexts: new Map(), undoStack: [], redoStack: [] }),
  setPdfText: (text) => set({ pdfText: text }),
  setPageText: (page, text) =>
    set((s) => {
      const newMap = new Map(s.pageTexts);
      newMap.set(page, text);
      return { pageTexts: newMap };
    }),
  setNumPages: (n) => set({ numPages: n }),
  setCurrentPage: (p) => set({ currentPage: p }),
  setZoom: (z) => set({ zoom: Math.max(0.25, Math.min(5, z)) }),
  zoomIn: () => set((s) => ({ zoom: Math.min(5, s.zoom + 0.15) })),
  zoomOut: () => set((s) => ({ zoom: Math.max(0.25, s.zoom - 0.15) })),
  zoomReset: () => set({ zoom: 1.0 }),

  // ─── Annotations ───

  addHighlight: (h) => set((s) => ({
    highlights: [...s.highlights, h],
    undoStack: [...s.undoStack, { type: 'add_highlight', highlight: h }],
    redoStack: [], // Clear redo stack on new action
  })),
  removeHighlight: (id) => set((s) => {
    const highlight = s.highlights.find((h) => h.id === id);
    if (!highlight) return s;
    return {
      highlights: s.highlights.filter((h) => h.id !== id),
      undoStack: [...s.undoStack, { type: 'remove_highlight', highlight }],
      redoStack: [], // Clear redo stack on new action
    };
  }),
  updateHighlightComment: (id, comment) => set((s) => {
    const highlight = s.highlights.find((h) => h.id === id);
    if (!highlight) return s;
    return {
      highlights: s.highlights.map((h) => (h.id === id ? { ...h, comment } : h)),
      undoStack: [...s.undoStack, { type: 'update_comment', id, oldComment: highlight.comment, newComment: comment }],
      redoStack: [], // Clear redo stack on new action
    };
  }),
  addAnnotation: (a) => set((s) => ({ annotations: [...s.annotations, a] })),
  removeAnnotation: (id) => set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),
  setActiveHighlightColor: (c) => set({ activeHighlightColor: c }),
  setActiveTool: (t) => set({ activeTool: t }),

  // ─── Undo/Redo ───

  undo: () => set((s) => {
    if (s.undoStack.length === 0) return s;

    const action = s.undoStack[s.undoStack.length - 1];
    const newUndoStack = s.undoStack.slice(0, -1);

    switch (action.type) {
      case 'add_highlight':
        // Undo adding = remove the highlight
        return {
          highlights: s.highlights.filter((h) => h.id !== action.highlight.id),
          undoStack: newUndoStack,
          redoStack: [...s.redoStack, action],
        };
      case 'remove_highlight':
        // Undo removing = add the highlight back
        return {
          highlights: [...s.highlights, action.highlight],
          undoStack: newUndoStack,
          redoStack: [...s.redoStack, action],
        };
      case 'update_comment':
        // Undo comment update = restore old comment
        return {
          highlights: s.highlights.map((h) =>
            h.id === action.id ? { ...h, comment: action.oldComment } : h
          ),
          undoStack: newUndoStack,
          redoStack: [...s.redoStack, action],
        };
      default:
        return s;
    }
  }),

  redo: () => set((s) => {
    if (s.redoStack.length === 0) return s;

    const action = s.redoStack[s.redoStack.length - 1];
    const newRedoStack = s.redoStack.slice(0, -1);

    switch (action.type) {
      case 'add_highlight':
        // Redo adding = add the highlight
        return {
          highlights: [...s.highlights, action.highlight],
          undoStack: [...s.undoStack, action],
          redoStack: newRedoStack,
        };
      case 'remove_highlight':
        // Redo removing = remove the highlight
        return {
          highlights: s.highlights.filter((h) => h.id !== action.highlight.id),
          undoStack: [...s.undoStack, action],
          redoStack: newRedoStack,
        };
      case 'update_comment':
        // Redo comment update = apply new comment
        return {
          highlights: s.highlights.map((h) =>
            h.id === action.id ? { ...h, comment: action.newComment } : h
          ),
          undoStack: [...s.undoStack, action],
          redoStack: newRedoStack,
        };
      default:
        return s;
    }
  }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  // ─── AI ───

  setSelectedTextForAI: (text, page, rects = []) => set({ selectedTextForAI: text, selectedPageForAI: page, selectedRectsForAI: rects }),
  clearSelectedTextForAI: () => set({ selectedTextForAI: '', selectedPageForAI: 0, selectedRectsForAI: [] }),
  newConversation: () => {
    const id = uid();
    const conv: ChatConversation = {
      id,
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
    };
    set((s) => ({
      conversations: [...s.conversations, conv],
      activeConversation: id,
    }));
    return id;
  },
  addMessage: (convId, msg) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: [...c.messages, msg],
              title:
                c.messages.length === 0 && msg.role === 'user'
                  ? msg.content.slice(0, 60) + (msg.content.length > 60 ? '…' : '')
                  : c.title,
            }
          : c
      ),
    })),
  updateLastAssistantMessage: (convId, content) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== convId) return c;
        const msgs = [...c.messages];
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'assistant') {
            msgs[i] = { ...msgs[i], content };
            break;
          }
        }
        return { ...c, messages: msgs };
      }),
    })),
  setActiveConversation: (id) => set({ activeConversation: id }),
  setIsStreaming: (v) => set({ isStreaming: v }),
  deleteConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeConversation: s.activeConversation === id ? null : s.activeConversation,
    })),

  // ─── UI ───

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setSidebarWidth: (w) => set({ sidebarWidth: Math.max(50, w) }),
  setSidebarTab: (t) => set({ sidebarTab: t }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  toggleThumbnailSidebar: () => set((s) => ({ thumbnailSidebarOpen: !s.thumbnailSidebarOpen })),
  setThumbnailSidebarOpen: (v) => set({ thumbnailSidebarOpen: v }),

  // ─── Settings ───

  updateSettings: (s) => set((state) => ({ settings: { ...state.settings, ...s } })),
  setActiveProvider: (p) =>
    set((s) => ({ settings: { ...s.settings, activeProvider: p } })),
  updateProviderConfig: (id, config) =>
    set((s) => ({
      settings: {
        ...s.settings,
        providers: {
          ...s.settings.providers,
          [id]: {
            ...((s.settings.providers as Record<string, unknown>)[id] as ProviderConfig),
            ...config,
          },
        },
      },
    })),
}));
