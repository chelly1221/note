'use client';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ArrowLeft,
  Bold,
  Check,
  CheckSquare,
  Code2,
  Copy,
  Download,
  Eye,
  Folder,
  Hash,
  Heading2,
  History,
  ImagePlus,
  Italic,
  List,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Quote,
  RotateCcw,
  Star,
  Trash2,
  LoaderCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { notify } from '@/components/notice';
import { createLocalNote, getDb } from '@/lib/database';
import { imageMarkdown, saveImages } from '@/lib/attachments';
import { exportMarkdown } from '@/lib/export';
import {
  apiRequest,
  getServerSyncSnapshot,
  getSyncSnapshot,
  refreshPending,
  subscribeSync,
} from '@/lib/sync';
import {
  MAX_NOTE_LENGTH,
  attachmentIds,
  normalizeTags,
  type EditableNote,
  type LocalNote,
  type NoteDocument,
} from '@/lib/model';
import { registerEditGuard } from '@/lib/edit-session';
import { EditWriter } from '@/lib/edit-writer';

type Editable = EditableNote;
const MarkdownView = lazy(() =>
  import('@/components/markdown-view').then((module) => ({
    default: module.MarkdownView,
  })),
);
type Props = {
  note: LocalNote;
  folders: string[];
  onBack: () => void;
  onSelect: (id: string) => void;
  focus: boolean;
  onFocusChange: (focus: boolean) => void;
};
export function NoteEditor({
  note,
  folders,
  onBack,
  onSelect,
  focus,
  onFocusChange,
}: Props) {
  'use no memo'; // Draft writes use an explicit serialized writer and committed refs.
  const [draft, setDraft] = useState(note);
  const characterCount = useMemo(
    () => Array.from(draft.content).length,
    [draft.content],
  );
  const current = useRef(draft);
  const initiallyEmpty = useRef(!note.title && !note.content);
  const [writer] = useState(() => new EditWriter(note));
  const [mode, setMode] = useState('write');
  const [saving, setSaving] = useState(0);
  const pendingSaves = useRef(0);
  const [saveError, setSaveError] = useState('');
  const saveOperations = useRef(new Set<Promise<void>>());
  const saveErrorRef = useRef('');
  const editSequence = useRef(0);
  const persistedSequence = useRef(0);
  const [properties, setProperties] = useState(false);
  const [tagInput, setTagInput] = useState(note.tags.join(', '));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<NoteDocument[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploadInProgress = useRef(false);
  const sync = useSyncExternalStore(
    subscribeSync,
    getSyncSnapshot,
    getServerSyncSnapshot,
  );
  /* oxlint-disable react/react-compiler -- Apply incoming IndexedDB subscription snapshots only after pending editor writes finish. */
  useEffect(() => {
    if (
      pendingSaves.current === 0 &&
      writer.id === note.id &&
      !saveErrorRef.current
    ) {
      writer.receive(note);
      current.current = note;
      setDraft(note);
      if (!properties) setTagInput(note.tags.join(', '));
    }
  }, [note, writer, properties]);
  /* oxlint-enable react/react-compiler */
  useEffect(() => {
    if (initiallyEmpty.current) titleInput.current?.focus();
  }, []);
  function showProperties() {
    setTagInput(current.current.tags.join(', '));
    setProperties(true);
  }
  useEffect(() => {
    const input = titleInput.current;
    if (!input) return;
    const resize = () => {
      input.style.height = '0px';
      input.style.height = `${input.scrollHeight}px`;
    };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== input.clientWidth) {
        width = input.clientWidth;
        resize();
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [draft.title]);
  useEffect(
    () =>
      registerEditGuard(async () => {
        while (saveOperations.current.size)
          await Promise.allSettled(saveOperations.current);
        if (saveErrorRef.current) {
          notify(
            '자동 저장 오류를 확인하거나 현재 글을 파일로 보관해 주세요.',
            {
              error: true,
            },
          );
          return false;
        }
        return true;
      }),
    [],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saveOperations.current.size || saveError) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveError]);
  async function change(patch: Partial<Editable>) {
    const merged = { ...current.current, ...patch };
    current.current = merged;
    setDraft(merged);
    pendingSaves.current++;
    setSaving(pendingSaves.current);
    const sequence = ++editSequence.current;
    const payload: Editable = {
      title: merged.title,
      content: merged.content,
      folder: merged.folder,
      tags: merged.tags,
      pinned: merged.pinned,
      deletedAt: merged.deletedAt,
    };
    const operation = (async () => {
      try {
        const saved = await writer.write(payload);
        persistedSequence.current = Math.max(
          persistedSequence.current,
          sequence,
        );
        if (sequence === editSequence.current) {
          setSaveError('');
          saveErrorRef.current = '';
          current.current = saved;
          setDraft(saved);
        }
        void refreshPending().catch(() => {});
      } catch (error) {
        if (sequence >= persistedSequence.current) {
          const message =
            error instanceof Error
              ? error.message
              : '기기에 저장하지 못했어요.';
          setSaveError(message);
          saveErrorRef.current = message;
        }
      } finally {
        pendingSaves.current--;
        setSaving(pendingSaves.current);
      }
    })();
    saveOperations.current.add(operation);
    try {
      await operation;
    } finally {
      saveOperations.current.delete(operation);
      if (!pendingSaves.current && writer.id !== note.id)
        requestAnimationFrame(() => {
          if (!pendingSaves.current) {
            onSelect(writer.id);
            notify('동시에 수정된 기록을 사본으로 보존했어요.');
          }
        });
    }
  }
  function insert(before: string, after = '', placeholder = '') {
    if (current.current.deletedAt) return false;
    const input = area.current;
    const start = input?.selectionStart ?? current.current.content.length;
    const end = input?.selectionEnd ?? start;
    const selection = current.current.content.slice(start, end) || placeholder;
    const content =
      current.current.content.slice(0, start) +
      before +
      selection +
      after +
      current.current.content.slice(end);
    if (content.length > MAX_NOTE_LENGTH) {
      notify('노트는 100만 자까지 작성할 수 있어요.', { error: true });
      return false;
    }
    setMode('write');
    void change({ content });
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(
        start + before.length,
        start + before.length + selection.length,
      );
    });
    return true;
  }
  function prefix(value: string) {
    const input = area.current;
    const pos = input?.selectionStart ?? current.current.content.length;
    const start = current.current.content.lastIndexOf('\n', pos - 1) + 1;
    const end = current.current.content.indexOf(
      '\n',
      input?.selectionEnd ?? pos,
    );
    const stop = end === -1 ? current.current.content.length : end;
    const selected = current.current.content.slice(start, stop);
    const content =
      current.current.content.slice(0, start) +
      selected
        .split('\n')
        .map((line) => value + line)
        .join('\n') +
      current.current.content.slice(stop);
    if (content.length > MAX_NOTE_LENGTH) {
      notify('노트는 100만 자까지 작성할 수 있어요.', { error: true });
      return;
    }
    void change({ content });
    setMode('write');
    requestAnimationFrame(() => area.current?.focus());
  }
  async function attach(files: File[]) {
    if (!files.length || uploadInProgress.current || current.current.deletedAt)
      return;
    if (attachmentIds(current.current.content).length + files.length > 100) {
      notify('한 노트에는 이미지를 100개까지 첨부할 수 있어요.', {
        error: true,
      });
      return;
    }
    uploadInProgress.current = true;
    setUploading(true);
    const operation = (async () => {
      try {
        const images = await saveImages(files);
        const markdown = images.map(imageMarkdown);
        if (insert(`\n${markdown.join('\n\n')}\n`))
          notify(`${markdown.length}개의 이미지를 첨부했어요.`);
        else
          await getDb().attachments.bulkDelete(images.map((image) => image.id));
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : '이미지를 첨부하지 못했어요.',
          { error: true },
        );
      } finally {
        uploadInProgress.current = false;
        setUploading(false);
      }
    })();
    saveOperations.current.add(operation);
    try {
      await operation;
    } finally {
      saveOperations.current.delete(operation);
    }
  }
  function keyboard(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      ['b', 'i'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      event.stopPropagation();
      insert(
        event.key.toLowerCase() === 'b' ? '**' : '*',
        event.key.toLowerCase() === 'b' ? '**' : '*',
        '텍스트',
      );
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      insert('  ');
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      const input = event.currentTarget;
      const start = input.selectionStart;
      if (start !== input.selectionEnd) return;
      const line =
        current.current.content.slice(0, start).split('\n').at(-1) || '';
      const match = line.match(/^(\s*)([-*+] |\d+\. )(\[[ xX]\] )?(.*)$/);
      if (match) {
        event.preventDefault();
        if (!match[4].trim()) {
          const lineStart = start - line.length;
          void change({
            content:
              current.current.content.slice(0, lineStart) +
              current.current.content.slice(start),
          });
          requestAnimationFrame(() =>
            area.current?.setSelectionRange(lineStart, lineStart),
          );
        } else {
          const marker = /^\d/.test(match[2])
            ? `${parseInt(match[2]) + 1}. `
            : match[2];
          insert(`\n${match[1]}${marker}${match[3] ? '[ ] ' : ''}`);
        }
      }
    }
  }
  async function trash() {
    const deleted = Boolean(current.current.deletedAt);
    await change({ deletedAt: deleted ? null : new Date().toISOString() });
    if (deleted) notify('노트를 복원했어요.');
    else
      notify('노트를 휴지통으로 옮겼어요.', {
        action: {
          label: '되돌리기',
          run: () => void change({ deletedAt: null }),
        },
      });
  }
  async function duplicate() {
    const copy = await createLocalNote({
      ...current.current,
      id: crypto.randomUUID(),
      revision: 0,
      title: `${current.current.title || '제목 없는 노트'} (사본)`,
      deletedAt: null,
    });
    onSelect(copy.id);
    await refreshPending();
    notify('노트 사본을 만들었어요.');
  }
  async function showHistory() {
    setHistoryOpen(true);
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const result = await apiRequest<{ versions: NoteDocument[] }>(
        `/api/notes/${note.id}/history`,
      );
      setVersions(result.versions);
    } catch (error) {
      setHistoryError(
        error instanceof Error
          ? error.message
          : '변경 이력을 불러오지 못했어요.',
      );
    } finally {
      setHistoryBusy(false);
    }
  }
  const toolbar = [
    { label: '제목', icon: Heading2, action: () => prefix('## ') },
    { label: '굵게', icon: Bold, action: () => insert('**', '**', '텍스트') },
    { label: '기울임', icon: Italic, action: () => insert('*', '*', '텍스트') },
    { label: '목록', icon: List, action: () => prefix('- ') },
    { label: '체크리스트', icon: CheckSquare, action: () => prefix('- [ ] ') },
    { label: '인용', icon: Quote, action: () => prefix('> ') },
    {
      label: '코드 블록',
      icon: Code2,
      action: () => insert('\n```\n', '\n```\n', '코드'),
    },
  ];
  return (
    <>
      <header className="editor-header">
        <Button
          variant="ghost"
          size="icon"
          className="mobile-back"
          aria-label="목록으로"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <button
          className="breadcrumb"
          onClick={showProperties}
          aria-label="노트 폴더와 태그 설정"
        >
          <Folder size={15} />
          <span>{draft.folder}</span>
          <span className="breadcrumb-slash">/</span>
          <span>노트</span>
        </button>
        <div className="editor-actions">
          <span className={`save-state ${saveError ? 'error-text' : ''}`}>
            {saving ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Check size={14} />
            )}{' '}
            {saveError ? '저장 오류' : saving ? '저장 중' : '기기에 저장됨'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={draft.pinned ? '즐겨찾기 해제' : '즐겨찾기 추가'}
            aria-pressed={draft.pinned}
            onClick={() => void change({ pinned: !draft.pinned })}
          >
            <Star className={draft.pinned ? 'is-starred' : ''} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="노트 더보기" />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="note-menu">
              <DropdownMenuItem onClick={showProperties}>
                <Folder />
                폴더와 태그
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void duplicate()}>
                <Copy />
                노트 복제
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void exportMarkdown(current.current).catch((err) =>
                    notify(err.message, { error: true }),
                  )
                }
              >
                <Download />
                {draft.attachments.length
                  ? '마크다운·이미지 내보내기'
                  : '마크다운 내보내기'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void showHistory()}>
                <History />
                변경 이력
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void trash()}
                variant={draft.deletedAt ? 'default' : 'destructive'}
              >
                {draft.deletedAt ? <RotateCcw /> : <Trash2 />}
                {draft.deletedAt ? '노트 복원' : '휴지통으로 이동'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {saveError && (
        <div className="save-error" role="alert">
          <span>{saveError} 화면의 내용은 유지하고 있어요.</span>
          <Button
            variant="outline"
            onClick={() =>
              void change({
                title: current.current.title,
                content: current.current.content,
              })
            }
          >
            다시 시도
          </Button>
          <Button
            variant="ghost"
            onClick={() => void exportMarkdown(current.current)}
          >
            파일로 보관
          </Button>
        </div>
      )}
      {draft.deletedAt && (
        <div className="trash-banner">
          <Trash2 size={16} />
          <span>휴지통에 있는 노트예요.</span>
          <Button variant="ghost" onClick={() => void trash()}>
            복원하기
          </Button>
        </div>
      )}
      {draft.conflictOf && (
        <div className="conflict-banner">
          <Copy size={16} />
          <span>
            다른 기기의 수정 내용과 겹쳐 이 기기의 글을 사본으로 보존했어요.
          </span>
        </div>
      )}
      <div className="editor-modebar">
        <div
          className="format-toolbar"
          role="toolbar"
          aria-label="마크다운 서식"
        >
          {
            // oxlint-disable-next-line react/react-compiler -- Toolbar actions access selection refs only when clicked, never during render.
            toolbar.map((item) => (
              <Button
                key={item.label}
                variant="ghost"
                size="icon"
                title={item.label}
                aria-label={item.label}
                disabled={Boolean(draft.deletedAt)}
                onClick={() => item.action()}
              >
                <item.icon />
              </Button>
            ))
          }
          <span className="toolbar-divider" />
          <Button
            variant="ghost"
            size="icon"
            title="이미지 첨부"
            aria-label="이미지 첨부"
            disabled={uploading || Boolean(draft.deletedAt)}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? <LoaderCircle className="spin" /> : <ImagePlus />}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              if (files.length) void attach(files);
            }}
          />
        </div>
        <div className="mode-controls">
          <Tabs value={mode} onValueChange={(value) => setMode(String(value))}>
            <TabsList className="editor-tabs">
              <TabsTrigger value="write">
                <Pencil size={13} />
                <span>작성</span>
              </TabsTrigger>
              <TabsTrigger value="preview">
                <Eye size={13} />
                <span>미리보기</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="icon"
            className="focus-button"
            aria-label={focus ? '집중 모드 종료' : '집중 모드'}
            onClick={() => onFocusChange(!focus)}
          >
            {focus ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </div>
      <div
        className="editor-scroll"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            if (!draft.deletedAt) void attach(Array.from(e.dataTransfer.files));
          }
        }}
      >
        <div className="editor-document">
          <div className="document-eyebrow">
            <span className="gradient-stroke" />
            나의 기록
          </div>
          <textarea
            ref={titleInput}
            className="title-input"
            rows={1}
            aria-label="노트 제목"
            placeholder="제목 없는 노트"
            value={draft.title}
            maxLength={300}
            readOnly={Boolean(draft.deletedAt)}
            onChange={(e) =>
              void change({ title: e.target.value.replace(/[\r\n]+/g, ' ') })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                setMode('write');
                requestAnimationFrame(() => area.current?.focus());
              }
            }}
          />
          <div className="document-meta">
            <time>
              {new Date(draft.createdAt).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
            <span className="meta-dot">·</span>
            <button
              className="tag-edit-button"
              aria-label="태그 편집"
              onClick={showProperties}
            >
              {draft.tags.length ? (
                draft.tags.map((tag) => (
                  <span className="tag-chip" key={tag}>
                    <Hash size={12} />
                    {tag}
                  </span>
                ))
              ) : (
                <span className="add-tags">
                  <Hash size={13} />
                  태그 추가
                </span>
              )}
            </button>
          </div>
          <div className="editor-rule" />
          {mode === 'preview' ? (
            <Suspense
              fallback={
                <p className="loading-message">
                  <LoaderCircle className="spin" />
                  미리보기를 준비하고 있어요.
                </p>
              }
            >
              <MarkdownView
                content={draft.content}
                onChange={(content) => void change({ content })}
                readOnly={Boolean(draft.deletedAt)}
              />
            </Suspense>
          ) : (
            <textarea
              ref={area}
              aria-label="노트 내용"
              className="note-textarea"
              placeholder="지금 떠오른 생각을 적어보세요…"
              value={draft.content}
              maxLength={MAX_NOTE_LENGTH}
              readOnly={Boolean(draft.deletedAt)}
              spellCheck={false}
              onChange={(e) => void change({ content: e.target.value })}
              onKeyDown={keyboard}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter(
                  (file) => file.type.startsWith('image/'),
                );
                if (files.length) {
                  event.preventDefault();
                  void attach(files);
                }
              }}
            />
          )}
        </div>
      </div>
      <footer className="editor-footer">
        <span>
          <span
            className={`status-dot ${sync.state === 'syncing' ? 'pulse' : ''}`}
          />
          {saveError
            ? '기기 저장 오류'
            : saving
              ? '저장 중'
              : sync.state === 'unconfigured'
                ? '기기에 자동 저장'
                : sync.pending
                  ? '동기화 대기'
                  : sync.state === 'idle'
                    ? 'NAS에 동기화됨'
                    : '기기에 저장 · 연결 대기'}
        </span>
        <span>
          {characterCount.toLocaleString()}자<span className="meta-dot">·</span>
          마크다운
        </span>
      </footer>
      <Dialog open={properties} onOpenChange={setProperties}>
        <DialogContent className="properties-dialog">
          <DialogHeader>
            <DialogTitle>폴더와 태그</DialogTitle>
            <DialogDescription>노트를 찾기 쉽게 정리해요.</DialogDescription>
          </DialogHeader>
          <label className="field-label" htmlFor="note-folder">
            폴더
          </label>
          <Select
            value={draft.folder}
            onValueChange={(value) => {
              if (value) void change({ folder: String(value) });
            }}
          >
            <SelectTrigger
              id="note-folder"
              className="folder-select"
              aria-label="노트 폴더"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {folders.map((folder) => (
                <SelectItem value={folder} key={folder}>
                  {folder}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="field-label" htmlFor="note-tags">
            태그
          </label>
          <input
            id="note-tags"
            className="dialog-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="아이디어, 일상, 작업"
            maxLength={820}
          />
          <p className="settings-hint">
            쉼표로 구분해 최대 20개까지 추가할 수 있어요.
          </p>
          <Button
            onClick={() => {
              void change({ tags: normalizeTags(tagInput) });
              setProperties(false);
            }}
          >
            적용하기
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="history-dialog">
          <DialogHeader>
            <DialogTitle>변경 이력</DialogTitle>
            <DialogDescription>
              NAS에 저장된 최근 50개 버전이에요. 이전 버전은 새 노트로 열 수
              있어요.
            </DialogDescription>
          </DialogHeader>
          {historyBusy ? (
            <p className="loading-message">
              <LoaderCircle className="spin" />
              이력을 불러오는 중
            </p>
          ) : historyError ? (
            <p className="form-error">{historyError}</p>
          ) : versions.length ? (
            <div className="history-list">
              {versions.map((version) => (
                <div key={version.revision}>
                  <div>
                    <strong>{version.title || '제목 없는 노트'}</strong>
                    <span>
                      {new Date(version.updatedAt).toLocaleString('ko-KR')} ·
                      버전 {version.revision}
                    </span>
                    <p>{version.content.slice(0, 120)}</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const copy = await createLocalNote({
                        ...version,
                        id: crypto.randomUUID(),
                        revision: 0,
                        title: `${version.title} (이전 버전)`,
                        deletedAt: null,
                      });
                      onSelect(copy.id);
                      setHistoryOpen(false);
                      await refreshPending();
                    }}
                  >
                    사본으로 열기
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-hint">아직 서버에 저장된 이력이 없어요.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
