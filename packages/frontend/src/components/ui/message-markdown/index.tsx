import { Fragment, type ReactNode } from "react";

/** Render a deliberately small Markdown subset as React nodes, never HTML. */
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g)
    .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (
        (part.startsWith("*") && part.endsWith("*")) ||
        (part.startsWith("_") && part.endsWith("_"))
      )
        return <em key={i}>{part.slice(1, -1)}</em>;
      if (part.startsWith("`") && part.endsWith("`"))
        return <code key={i}>{part.slice(1, -1)}</code>;
      return <Fragment key={i}>{part}</Fragment>;
    });
}
export function MessageMarkdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/),
    blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    const kind = /^\s*[-*+] /.test(line)
      ? "ul"
      : /^\s*\d+[.)] /.test(line)
        ? "ol"
        : null;
    if (kind) {
      const items: ReactNode[] = [],
        start = i;
      const pattern = kind === "ul" ? /^\s*[-*+] / : /^\s*\d+[.)] /;
      while (i < lines.length && pattern.test(lines[i]!)) {
        items.push(<li key={i}>{inline(lines[i]!.replace(pattern, ""))}</li>);
        i++;
      }
      blocks.push(
        kind === "ul" ? (
          <ul key={start}>{items}</ul>
        ) : (
          <ol key={start}>{items}</ol>
        ),
      );
    } else {
      blocks.push(<div key={i}>{line ? inline(line) : <br />}</div>);
      i++;
    }
  }
  return <div className="message-markdown">{blocks}</div>;
}
