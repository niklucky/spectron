import { trackerImages } from "@spectron/shared";
import React, { createContext, useContext, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  url?: string;
  alt?: string;
};

// Tracker's size suffix is not CommonMark. Convert parsed text only, so
// examples inside fenced code and inline code remain literal.
function remarkTrackerImages() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!node.children) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== "text" || !child.value) {
          visit(child);
          return [child];
        }
        const parts: MarkdownNode[] = [];
        let offset = 0;
        for (const image of trackerImages(child.value)) {
          const start = child.value.indexOf(image.markup, offset);
          parts.push({ type: "text", value: child.value.slice(offset, start) });
          parts.push({ type: "image", url: `/ajax/v2/attachments/${image.id}`, alt: image.filename });
          offset = start + image.markup.length;
        }
        parts.push({ type: "text", value: child.value.slice(offset) });
        return parts;
      });
    }
    visit(tree);
  };
}

export type MarkdownMention = { href: string; label: string; title: string };

type MarkdownImage = ReturnType<typeof trackerImages>[number];
type MarkdownOptions = {
  images: MarkdownImage[];
  renderImage?: ((image: MarkdownImage) => ReactNode) | undefined;
  mentions: MarkdownMention[];
};

const MarkdownContext = createContext<MarkdownOptions>({ images: [], mentions: [] });

// Keep the component types stable so a chat update preserves link focus and loaded images.
const components: Components = {
  a: function MarkdownLink({ href, children }) {
    const { mentions } = useContext(MarkdownContext);
    const mention = mentions.find(item => item.href === href);
    return mention
      ? <span className="mention rounded-sm bg-accent-soft px-1.5 py-px font-semibold text-accent-ink" title={mention.title}>@{mention.label}</span>
      : <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  },
  img: function MarkdownAttachment({ src, alt }) {
    const { images, renderImage } = useContext(MarkdownContext);
    const id = typeof src === "string" ? src.match(/^\/ajax\/v2\/attachments\/(\d+)/)?.[1] : undefined;
    const image = id ? images.find(image => image.id === id) : undefined;
    return image ? renderImage?.(image) ?? image.markup : <span>{alt || "Image"}</span>;
  },
};

export function MessageMarkdown({ text, renderImage, mentions = [] }: {
  text: string;
  renderImage?: (image: MarkdownImage) => ReactNode;
  mentions?: MarkdownMention[];
}) {
  const images = trackerImages(text);
  return <div className="prose-chat">
    <MarkdownContext.Provider value={{ images, renderImage, mentions }}>
      <Markdown remarkPlugins={[remarkGfm, remarkTrackerImages]} components={components}>{text}</Markdown>
    </MarkdownContext.Provider>
  </div>;
}
