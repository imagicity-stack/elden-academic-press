// Small Markdown (**bold**, *italic*, [links](https://…), lists, ## headings),
// drawn as React elements, so no raw HTML ever reaches the page.
import type { ReactNode } from 'react';

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={`${key}-${i++}`}>{m[2]}</em>);
    else out.push(<a key={`${key}-${i++}`} href={m[4]} {...(m[4].startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{m[3]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  // A "## heading" line always stands alone, even with text on the very next line.
  const blocks = text.trim().replace(/^(##\s+[^\n]*)\n(?!\n)/gm, '$1\n\n').split(/\n{2,}/).filter(Boolean);
  return (
    <div className={'rich' + (className ? ` ${className}` : '')}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) return <ol key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+\.\s+/, ''), `${i}-${j}`)}</li>)}</ol>;
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•]\s+/, ''), `${i}-${j}`)}</li>)}</ul>;
        if (/^##\s+/.test(b)) return <h3 key={i}>{inline(b.replace(/^##\s+/, ''), `${i}`)}</h3>;
        return <p key={i}>{lines.flatMap((l, j) => (j ? [<br key={`br${j}`} />, ...inline(l, `${i}-${j}`)] : inline(l, `${i}-${j}`)))}</p>;
      })}
    </div>
  );
}
