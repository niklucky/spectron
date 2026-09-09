import { trackerImages } from "@spectron/shared";
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
export function MessageMarkdown({ text, renderImage }: { text: string; renderImage?: (image: ReturnType<typeof trackerImages>[number]) => ReactNode }) {
  function renderLine(line: string): ReactNode {
    if (!renderImage) return inline(line);
    const parts: ReactNode[] = [];
    let offset = 0;
    for (const image of trackerImages(line)) {
      const start = line.indexOf(image.markup, offset);
      parts.push(...inline(line.slice(offset, start)));
      parts.push(<Fragment key={start}>{renderImage(image) ?? image.markup}</Fragment>);
      offset = start + image.markup.length;
    }
    parts.push(...inline(line.slice(offset)));
    return parts;
  }
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
        items.push(<li key={i}>{renderLine(lines[i]!.replace(pattern, ""))}</li>);
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
      blocks.push(<div key={i}>{line ? renderLine(line) : <br />}</div>);
      i++;
    }
  }
  return <div className="message-markdown">{blocks}</div>;
}
