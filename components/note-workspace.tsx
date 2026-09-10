'use client';
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowUpRight,
  ChevronDown,
  Cloud,
  CloudOff,
  FileText,
  Folder,
  FolderPlus,
  Hash,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NoteEditor } from '@/components/note-editor';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { SettingsDialog } from '@/components/settings-dialog';
import { NoticeHost, notify } from '@/components/notice';
import {
  createLocalNote,
  getDb,
  getSetting,
  initializeDatabase,
  setSetting,
  renameLocalFolder,
  deleteLocalFolder,
} from '@/lib/database';
import {
  getServerSyncSnapshot,
  getSyncSnapshot,
  refreshPending,
  startSync,
  subscribeSync,
  syncNow,
} from '@/lib/sync';
import { DEFAULT_FOLDER, type LocalNote } from '@/lib/model';
import { importMarkdown } from '@/lib/export';
import { registerOfflineShell } from '@/lib/pwa';
import { finishEditing } from '@/lib/edit-session';
import { WorkspaceBoundary } from '@/components/workspace-boundary';
import { registerNoteTools } from '@/lib/webmcp';

type Filter = {
  type: 'all' | 'starred' | 'trash' | 'folder' | 'tag';
  value?: string;
};
function matches(note: LocalNote, filter: Filter, query: string) {
  return (
    (filter.type === 'trash' ? Boolean(note.deletedAt) : !note.deletedAt) &&
    (filter.type !== 'starred' || note.pinned) &&
    (filter.type !== 'folder' || note.folder === filter.value) &&
    (filter.type !== 'tag' || note.tags.includes(filter.value!)) &&
    `${note.title} ${note.content} ${note.tags.join(' ')}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  );
}

export default function NoteWorkspace() {
  return (
    <WorkspaceBoundary>
      <SidebarProvider
        className="workspace"
        style={{ '--sidebar-width': '228px' } as React.CSSProperties}
      >
        <WorkspaceContent />
      </SidebarProvider>
    </WorkspaceBoundary>
  );
}
function WorkspaceContent() {
  useEffect(() => {
    void registerOfflineShell();
  }, []);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState('');
  const [activeId, setActiveId] = useState('');
  const [filter, setFilter] = useState<Filter>({ type: 'all' });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('updated');
  const [mobileEditor, setMobileEditor] = useState(false);
  const [focus, setFocus] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [folderDialog, setFolderDialog] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [removingFolder, setRemovingFolder] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const { setOpenMobile, setOpen, openMobile } = useSidebar();
  const notes = useLiveQuery(() => getDb().notes.toArray(), [], []);
  const storedFolders = useLiveQuery(
    () => getSetting<string[]>('folders', []),
    [],
    [],
  );
  const sync = useSyncExternalStore(
    subscribeSync,
    getSyncSnapshot,
    getServerSyncSnapshot,
  );
  const active = notes.find((note) => note.id === activeId);
  const folders = useMemo(
    () => [
      ...new Set([
        DEFAULT_FOLDER,
        ...storedFolders,
        ...notes.filter((note) => !note.deletedAt).map((note) => note.folder),
      ]),
    ],
    [notes, storedFolders],
  );
  const tags = useMemo(
    () =>
      [
        ...new Set(
          notes.filter((note) => !note.deletedAt).flatMap((note) => note.tags),
        ),
      ].sort((a, b) => a.localeCompare(b, 'ko')),
    [notes],
  );
  const visible = useMemo(
    () =>
      notes
        .filter((note) => matches(note, filter, query))
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            (sort === 'title'
              ? a.title.localeCompare(b.title, 'ko')
              : sort === 'created'
                ? b.createdAt.localeCompare(a.createdAt)
                : b.updatedAt.localeCompare(a.updatedAt)),
        ),
    [notes, filter, query, sort],
  );
  const normal = notes.filter((note) => !note.deletedAt);
  const heading =
    filter.type === 'starred'
      ? '즐겨찾기'
      : filter.type === 'trash'
        ? '휴지통'
        : filter.type === 'folder'
          ? filter.value
          : filter.type === 'tag'
            ? `#${filter.value}`
            : '모든 노트';
  async function select(id: string) {
    if (!(await finishEditing())) return;
    setActiveId(id);
    setMobileEditor(true);
    setOpenMobile(false);
    void setSetting('activeId', id);
  }
  async function choose(next: Filter) {
    if (!(await finishEditing())) return;
    setFilter(next);
    setQuery('');
    setMobileEditor(false);
    setOpenMobile(false);
    const first = (await getDb().notes.toArray())
      .filter((note) => matches(note, next, ''))
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.updatedAt.localeCompare(a.updatedAt),
      )[0];
    setActiveId(first?.id || '');
  }
  const create = async () => {
    try {
      if (!(await finishEditing())) return;
      const note = await createLocalNote({
        folder: filter.type === 'folder' ? filter.value : DEFAULT_FOLDER,
        tags: filter.type === 'tag' ? [filter.value!] : [],
      });
      if (filter.type === 'trash' || filter.type === 'starred')
        setFilter({ type: 'all' });
      setQuery('');
      await select(note.id);
      await refreshPending();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : '노트를 만들지 못했어요.',
        { error: true },
      );
    }
  };
  const setFocusMode = (value: boolean) => {
    setFocus(value);
    setOpen(!value);
  };
  const onToolCreated = useEffectEvent(async (id: string) => {
    setFilter({ type: 'all' });
    setQuery('');
    await select(id);
  });
  useEffect(() => {
    if (!ready) return;
    return registerNoteTools((id) => onToolCreated(id));
  }, [ready]);
  async function addFolder(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    if (folders.includes(name) && name !== editingFolder) {
      setFolderError('같은 이름의 폴더가 있어요.');
      return;
    }
    if (folderBusy || !(await finishEditing())) return;
    setFolderBusy(true);
    try {
      if (editingFolder) await renameLocalFolder(editingFolder, name);
      else await setSetting('folders', [...storedFolders, name]);
      setFolderDialog(false);
      setFolderName('');
      await choose({ type: 'folder', value: name });
      await refreshPending();
      notify(editingFolder ? '폴더 이름을 바꿨어요.' : '폴더를 만들었어요.');
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : '폴더를 저장하지 못했어요.',
      );
    } finally {
      setFolderBusy(false);
    }
  }
  async function removeFolder() {
    if (!removingFolder || folderBusy || !(await finishEditing())) return;
    setFolderBusy(true);
    try {
      await deleteLocalFolder(removingFolder);
      if (filter.type === 'folder' && filter.value === removingFolder)
        await choose({ type: 'folder', value: DEFAULT_FOLDER });
      setRemovingFolder(null);
      await refreshPending();
      notify('기록을 기본 노트로 옮기고 폴더를 삭제했어요.');
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : '폴더를 삭제하지 못했어요.',
      );
    } finally {
      setFolderBusy(false);
    }
  }
  async function importFiles(files: File[]) {
    try {
      let last = '';
      for (const file of files.slice(0, 30)) {
        const note = await importMarkdown(
          file,
          filter.type === 'folder' ? filter.value! : DEFAULT_FOLDER,
        );
        last = note.id;
      }
      setQuery('');
      if (filter.type === 'trash') setFilter({ type: 'all' });
      if (last) await select(last);
      await refreshPending();
      notify(`${Math.min(files.length, 30)}개의 노트를 가져왔어요.`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : '파일을 가져오지 못했어요.',
        { error: true },
      );
    }
  }
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        await initializeDatabase();
        if (cancelled) return;
        const stored = await getSetting('activeId', '');
        const initialNotes = (await getDb().notes.toArray())
          .filter((note) => !note.deletedAt)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setActiveId(
          initialNotes.some((note) => note.id === stored)
            ? stored
            : initialNotes[0]?.id || '',
        );
        document.documentElement.style.setProperty(
          '--editor-font-size',
          `${await getSetting('fontSize', 16)}px`,
        );
        setReady(true);
        stop = await startSync();
        if (cancelled) stop();
      } catch (error) {
        setInitError(
          error instanceof Error
            ? error.message
            : '기기 저장소를 열 수 없어요.',
        );
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    const handler = (event: Event) => {
      const { originalId, copyId } = (
        event as CustomEvent<{ originalId: string; copyId: string }>
      ).detail;
      void finishEditing().then((saved) => {
        if (saved) setActiveId((id) => (id === originalId ? copyId : id));
      });
      notify(
        '동시 수정된 글을 사본으로 보존했어요. 두 노트 모두 확인할 수 있습니다.',
      );
    };
    window.addEventListener('note-conflict', handler);
    return () => window.removeEventListener('note-conflict', handler);
  }, []);
  const handleKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.isComposing ||
      event.defaultPrevented ||
      (event.target instanceof Element &&
        event.target.closest(
          '[data-slot="dialog-content"], [data-slot="alert-dialog-content"]',
        ))
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setFocus(false);
      setOpen(true);
      setMobileEditor(false);
      requestAnimationFrame(() => searchInput.current?.focus());
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.altKey &&
      event.key.toLowerCase() === 'n'
    ) {
      event.preventDefault();
      void create();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void syncNow();
    }
    if (event.key === 'Escape' && focus) setFocusMode(false);
  });
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => handleKeyboard(event);
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);
  const handleNativeBack = useEffectEvent(async () => {
    if (!(await finishEditing())) return;
    if (folderBusy) return;
    if (
      !window.dispatchEvent(
        new Event('note-dismiss-overlay', { cancelable: true }),
      )
    )
      return;
    if (removingFolder) setRemovingFolder(null);
    else if (settingsOpen) setSettingsOpen(false);
    else if (folderDialog) setFolderDialog(false);
    else if (openMobile) setOpenMobile(false);
    else if (focus) setFocusMode(false);
    else if (mobileEditor) setMobileEditor(false);
    else await (await import('@capacitor/app')).App.minimizeApp();
  });
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import('@capacitor/app').then(async ({ App }) => {
      if (cancelled) return;
      const handle = await App.addListener(
        'backButton',
        () => void handleNativeBack(),
      );
      cleanup = () => {
        void handle.remove();
      };
      if (cancelled) cleanup();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
  if (initError)
    return (
      <main className="storage-error-page">
        <CloudOff size={36} />
        <h1>기기 저장소를 열지 못했어요.</h1>
        <p>{initError}</p>
        <p>브라우저의 저장소 사용을 허용하고 다시 열어 주세요.</p>
        <Button onClick={() => location.reload()}>다시 시도</Button>
      </main>
    );
  return (
    <>
      <svg width="0" height="0" aria-hidden="true" className="brand-defs">
        <defs>
          <linearGradient id="brand-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a37bf2" />
            <stop offset="43%" stopColor="#ef8bc9" />
            <stop offset="74%" stopColor="#fa897c" />
            <stop offset="100%" stopColor="#f8b16b" />
          </linearGradient>
        </defs>
      </svg>
      <Sidebar className="app-sidebar" collapsible="offcanvas">
        <SidebarHeader className="brand-block">
          <button
            className="brand"
            onClick={() => choose({ type: 'all' })}
            aria-label="노트 홈"
          >
            <span className="brand-mark">
              <Sparkles size={24} stroke="url(#brand-gradient)" />
            </span>
            <span>노트</span>
          </button>
        </SidebarHeader>
        <SidebarContent className="sidebar-main">
          <Button
            className="new-note"
            onClick={() => void create()}
            disabled={!ready}
          >
            <Plus size={18} />새 노트<span className="key-hint">＋</span>
          </Button>
          <nav className="nav-list" aria-label="노트 탐색">
            <Button
              variant="ghost"
              className={`nav-item ${filter.type === 'all' ? 'selected' : ''}`}
              onClick={() => choose({ type: 'all' })}
            >
              <FileText />
              모든 노트<span>{normal.length}</span>
            </Button>
            <Button
              variant="ghost"
              className={`nav-item ${filter.type === 'starred' ? 'selected' : ''}`}
              onClick={() => choose({ type: 'starred' })}
            >
              <Star />
              즐겨찾기<span>{normal.filter((note) => note.pinned).length}</span>
            </Button>
          </nav>
          <div className="nav-section-label">
            <span>내 공간</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="새 폴더"
              title="새 폴더"
              onClick={() => {
                setFolderError('');
                setEditingFolder(null);
                setFolderName('');
                setFolderDialog(true);
              }}
            >
              <Plus size={14} />
            </Button>
          </div>
          <nav aria-label="폴더">
            {folders.map((folder) => (
              <div key={folder} className="folder-row">
                <Button
                  variant="ghost"
                  className={`nav-item ${filter.type === 'folder' && filter.value === folder ? 'selected' : ''}`}
                  onClick={() => choose({ type: 'folder', value: folder })}
                >
                  <Folder />
                  <span className="nav-folder-name">{folder}</span>
                  <span>
                    {normal.filter((note) => note.folder === folder).length}
                  </span>
                </Button>
                {folder !== DEFAULT_FOLDER && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="folder-menu"
                          aria-label={`${folder} 폴더 관리`}
                        />
                      }
                    >
                      <MoreHorizontal size={16} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditingFolder(folder);
                          setFolderName(folder);
                          setFolderError('');
                          setFolderDialog(true);
                        }}
                      >
                        <Pencil />
                        이름 바꾸기
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setFolderError('');
                          setRemovingFolder(folder);
                        }}
                      >
                        <Trash2 />
                        폴더 삭제
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </nav>
          <div className="nav-section-label">태그</div>
          {tags.length ? (
            <nav aria-label="태그">
              {tags.map((tag) => (
                <Button
                  key={tag}
                  variant="ghost"
                  className={`nav-item tag-nav ${filter.type === 'tag' && filter.value === tag ? 'selected' : ''}`}
                  onClick={() => choose({ type: 'tag', value: tag })}
                >
                  <Hash />
                  {tag}
                </Button>
              ))}
            </nav>
          ) : (
            <p className="sidebar-hint">노트에 태그를 달아보세요.</p>
          )}
        </SidebarContent>
        <SidebarFooter className="sidebar-bottom">
          <div>
            <Button
              variant="ghost"
              className="nav-item"
              onClick={() => importInput.current?.click()}
            >
              <Upload />
              파일 가져오기
            </Button>
            <input
              ref={importInput}
              type="file"
              accept=".md,.markdown,.txt,text/plain,text/markdown"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                if (files.length) void importFiles(files);
              }}
            />
            <Button
              variant="ghost"
              className={`nav-item ${filter.type === 'trash' ? 'selected' : ''}`}
              onClick={() => choose({ type: 'trash' })}
            >
              <Trash2 />
              휴지통
              <span>{notes.filter((note) => note.deletedAt).length || ''}</span>
            </Button>
            <Button
              variant="ghost"
              className="nav-item"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 />
              설정
            </Button>
          </div>
          <button
            className="device-card"
            onClick={() => setSettingsOpen(true)}
            aria-label="동기화 설정 열기"
          >
            <span className="device-orb" />
            <span className="device-card-text">
              <strong>나의 작업 공간</strong>
              <span>
                {sync.state === 'unconfigured'
                  ? '기기에만 저장'
                  : sync.state === 'syncing'
                    ? '동기화 중'
                    : sync.nasAvailable
                      ? 'NAS와 연결됨'
                      : '연결 확인 필요'}
              </span>
            </span>
            {sync.state === 'syncing' ? (
              <RefreshCw size={18} className="spin" />
            ) : sync.nasAvailable ? (
              <Cloud size={18} />
            ) : (
              <CloudOff size={18} />
            )}
          </button>
        </SidebarFooter>
      </Sidebar>
      <main
        className={`main-workspace ${mobileEditor ? 'show-editor' : ''} ${focus ? 'focus-mode' : ''}`}
      >
        <section className="note-list" aria-label="노트 목록">
          <div className="list-top">
            <div className="list-title">
              <SidebarTrigger className="mobile-menu" aria-label="메뉴 열기" />
              <h1>{heading}</h1>
              <span className="count-badge">{visible.length}</span>
              <Button
                variant="ghost"
                size="icon"
                className="mobile-new"
                aria-label="새 노트 만들기"
                onClick={() => void create()}
              >
                <Plus />
              </Button>
            </div>
            <span className="list-subtitle">
              {filter.type === 'trash'
                ? '필요한 기록은 다시 꺼내 쓸 수 있어요.'
                : '작은 생각부터, 차곡차곡.'}
            </span>
          </div>
          <label className="search-box">
            <Search size={17} />
            <input
              ref={searchInput}
              aria-label="노트 검색"
              placeholder="노트 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button aria-label="검색 지우기" onClick={() => setQuery('')}>
                <X size={15} />
              </button>
            ) : (
              <kbd>⌘ K</kbd>
            )}
          </label>
          <div className="list-divider">
            <span>{query ? '검색 결과' : `${visible.length}개의 노트`}</span>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button className="sort-button" aria-label="노트 정렬" />
                }
              >
                {sort === 'title'
                  ? '이름순'
                  : sort === 'created'
                    ? '최근 작성순'
                    : '최근 수정순'}
                <ChevronDown size={13} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSort('updated')}>
                  최근 수정순
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSort('created')}>
                  최근 작성순
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSort('title')}>
                  이름순
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="note-items">
            {!ready ? (
              <div className="empty-list">
                <LoaderCircle className="spin" />
                <p>기록을 불러오는 중</p>
              </div>
            ) : (
              visible.map((note) => (
                <button
                  key={note.id}
                  className={`note-card ${note.id === activeId ? 'active' : ''}`}
                  aria-pressed={note.id === activeId}
                  title={note.title || '제목 없는 노트'}
                  onClick={() => select(note.id)}
                >
                  <h2>{note.title || '제목 없는 노트'}</h2>
                </button>
              ))
            )}
            {ready && !visible.length && (
              <div className="empty-list">
                {query ? (
                  <Search size={28} />
                ) : filter.type === 'trash' ? (
                  <Trash2 size={28} />
                ) : (
                  <FileText size={28} />
                )}
                <strong>
                  {query
                    ? '찾는 노트가 없어요.'
                    : filter.type === 'trash'
                      ? '휴지통이 비어 있어요.'
                      : filter.type === 'starred'
                        ? '소중한 기록을 모아보세요.'
                        : '아직 비어 있는 공간이에요.'}
                </strong>
                <p>
                  {query
                    ? '다른 검색어로 찾아보세요.'
                    : filter.type === 'starred'
                      ? '노트의 별을 누르면 여기에 모여요.'
                      : filter.type === 'trash'
                        ? '지운 노트는 이곳에서 복원할 수 있어요.'
                        : '첫 번째 노트를 적어보세요.'}
                </p>
                {query ? (
                  <Button variant="ghost" onClick={() => setQuery('')}>
                    검색 지우기
                  </Button>
                ) : (
                  filter.type !== 'trash' && (
                    <Button variant="ghost" onClick={() => void create()}>
                      새 노트 만들기
                      <ArrowUpRight />
                    </Button>
                  )
                )}
              </div>
            )}
          </div>
          <button className="list-foot" onClick={() => setSettingsOpen(true)}>
            <span
              className={`status-dot ${sync.state === 'syncing' ? 'pulse' : ''}`}
            />
            {sync.state === 'unconfigured'
              ? '이 기기에 저장 중'
              : sync.pending
                ? `${sync.pending}개 변경 내용 전송 대기`
                : sync.state === 'idle'
                  ? '모든 변경 내용 동기화됨'
                  : '기기에 저장 · 서버 연결 대기'}
          </button>
        </section>
        <section className="editor-pane" aria-label="노트 편집기">
          {active ? (
            <NoteEditor
              key={active.id}
              note={active}
              folders={folders}
              onBack={() => setMobileEditor(false)}
              onSelect={select}
              focus={focus}
              onFocusChange={setFocusMode}
            />
          ) : (
            <div className="editor-empty">
              <span className="empty-brand">
                <Sparkles stroke="url(#brand-gradient)" size={36} />
              </span>
              <h2>새로운 생각을 위한 노트</h2>
              <p>
                {filter.type === 'trash'
                  ? '복원할 노트를 선택해 주세요.'
                  : '노트를 선택하거나 첫 문장을 적어보세요.'}
              </p>
              {filter.type !== 'trash' && (
                <Button onClick={() => void create()} disabled={!ready}>
                  <Plus />새 노트
                </Button>
              )}
            </div>
          )}
        </section>
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Dialog
        open={folderDialog}
        onOpenChange={(open) => {
          if (!folderBusy) setFolderDialog(open);
        }}
      >
        <DialogContent className="properties-dialog">
          <DialogHeader>
            <DialogTitle>
              {editingFolder ? '폴더 이름 바꾸기' : '새 폴더'}
            </DialogTitle>
            <DialogDescription>
              {editingFolder
                ? '이 폴더에 담긴 노트도 새 이름으로 정리됩니다.'
                : '어떤 기록을 담을 공간인가요?'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="settings-form"
            onSubmit={(event) => void addFolder(event)}
          >
            <label>
              폴더 이름
              <input
                required
                maxLength={80}
                value={folderName}
                onChange={(e) => {
                  setFolderName(e.target.value);
                  setFolderError('');
                }}
                placeholder="예: 일상, 프로젝트, 아이디어"
              />
            </label>
            {folderError && (
              <p className="form-error" role="alert">
                {folderError}
              </p>
            )}
            <Button type="submit" disabled={folderBusy}>
              {folderBusy ? (
                <LoaderCircle className="spin" />
              ) : editingFolder ? (
                <Pencil />
              ) : (
                <FolderPlus />
              )}
              {editingFolder ? '이름 바꾸기' : '폴더 만들기'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(removingFolder)}
        onOpenChange={(open) => {
          if (!open && !folderBusy) setRemovingFolder(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>폴더를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              ‘{removingFolder}’에 담긴 기록을 기본 노트로 옮기고 폴더를
              삭제합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {folderError && (
            <p className="form-error" role="alert">
              {folderError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={folderBusy}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={folderBusy}
              onClick={() => void removeFolder()}
            >
              {folderBusy ? <LoaderCircle className="spin" /> : <Trash2 />}폴더
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NoticeHost />
    </>
  );
}
