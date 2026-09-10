'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLiveQuery } from 'dexie-react-hooks';
import { ImageOff, Download } from 'lucide-react';
import { getDb } from '@/lib/database';

interface MarkdownNode {
  type: string;
  checked?: boolean;
  position?: { start: { line: number } };
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
}
function taskLines() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (node.type === 'listItem' && typeof node.checked === 'boolean')
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            'data-task-line': node.position?.start.line,
          },
        };
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
const TaskContext = createContext<number | null>(null);
const MarkdownContext = createContext<{
  toggle: (line: number) => void;
  disabled: boolean;
}>({ toggle: () => {}, disabled: true });

function StoredImage({ id, alt }: { id: string; alt: string }) {
  const attachment = useLiveQuery(() => getDb().attachments.get(id), [id]);
  const [image, setImage] = useState<{ id: string; blob: Blob; url: string }>();
  useEffect(() => {
    if (!attachment?.blob) return;
    const objectUrl = URL.createObjectURL(attachment.blob);
    // oxlint-disable-next-line react/react-compiler -- Object URLs are browser resources allocated after commit and revoked on cleanup.
    setImage({ id, blob: attachment.blob, url: objectUrl });
    return () => URL.revokeObjectURL(objectUrl);
  }, [id, attachment?.blob]);
  const url =
    image?.id === id && image?.blob === attachment?.blob
      ? image?.url
      : undefined;
  if (!url)
    return (
      <span className="image-unavailable">
        <ImageOff size={20} />
        <span>
          {alt || '첨부 이미지'}
          <small>연결 후 이미지를 불러올 수 있어요.</small>
        </span>
      </span>
    );
  return (
    <span className="attached-image">
      {/* oxlint-disable-next-line next/no-img-element -- Private offline blobs must not be sent through an image optimization server. */}
      <img
        src={url}
        alt={alt || attachment?.name || '첨부 이미지'}
        loading="lazy"
      />
      <a
        className="image-download"
        href={url}
        download={attachment?.name || 'image'}
        aria-label="이미지 저장"
      >
        <Download size={16} />
      </a>
      {alt && <span className="image-caption">{alt}</span>}
    </span>
  );
}

function TaskCheckbox({ checked }: { checked?: boolean }) {
  const line = useContext(TaskContext);
  const { toggle, disabled } = useContext(MarkdownContext);
  return (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      disabled={disabled || line === null}
      aria-label="체크리스트 항목"
      onChange={() => {
        if (line !== null) toggle(line);
      }}
    />
  );
}

// Component identities stay stable while a task changes, preserving keyboard focus.
const markdownComponents: Components = {
  li: ({ node, children, ...props }) => (
    <TaskContext.Provider
      value={Number(node?.properties?.['data-task-line']) || null}
    >
      <li {...props}>{children}</li>
    </TaskContext.Provider>
  ),
  input: ({ checked }) => <TaskCheckbox checked={checked} />,
  img: ({ src, alt }) =>
    typeof src === 'string' && /^attachment:[a-f0-9-]{36}$/i.test(src) ? (
      <StoredImage id={src.slice(11)} alt={alt || ''} />
    ) : (
      <span className="image-unavailable">
        <ImageOff size={18} />
        외부 이미지는 자동으로 불러오지 않아요. 이미지를 첨부해 주세요.
      </span>
    ),
  a: ({ href, children }) =>
    href && /^(https?:|mailto:)/i.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
};

export function MarkdownView({
  content,
  onChange,
  readOnly = false,
}: {
  content: string;
  onChange?: (content: string) => void;
  readOnly?: boolean;
}) {
  const toggle = (line: number) => {
    const lines = content.split('\n');
    const value = lines[line - 1];
    if (!value) return;
    lines[line - 1] = value.replace(
      /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/,
      (_all, prefix, checked) => `${prefix}[${checked === ' ' ? 'x' : ' '}]`,
    );
    onChange?.(lines.join('\n'));
  };
  return (
    <MarkdownContext.Provider
      value={{ toggle, disabled: readOnly || !onChange }}
    >
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, taskLines]}
          skipHtml
          urlTransform={(url) =>
            url.startsWith('attachment:') ? url : defaultUrlTransform(url)
          }
          components={markdownComponents}
        >
          {content || '*아직 적은 내용이 없어요.*'}
        </ReactMarkdown>
      </div>
    </MarkdownContext.Provider>
  );
}
