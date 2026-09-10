import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageMarkdown } from "../../../packages/frontend/src/components/ui/message-markdown";

const render = (text: string) => renderToStaticMarkup(<MessageMarkdown text={text} />);

test("renders fenced scripts literally and supports quotes, links and tables", () => {
  const script = '#!/usr/bin/env bash\n  echo "$body" <file>\n# not a heading\n';
  const html = render('Сюда фиксирую скрипт\n\n```bash\n' + script + '```\n\n> quoted\n\n[Link](https://example.com)\n\n| A | B |\n| - | - |\n| 1 | 2 |');
  assert.match(html, /<pre><code class="language-bash">/);
  assert.ok(html.includes(script.replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')));
  assert.match(html, /<blockquote>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<h1>/);
});

test("does not execute HTML or unsafe links or load remote images", () => {
  const html = render('<script>alert(1)</script>\n\n[x](javascript:alert)\n\n![remote](https://example.com/image.png)');
  assert.doesNotMatch(html, /<script|href="javascript:|<img/);
});

test("resolves Tracker images with sizes, but leaves code examples literal", () => {
  const markup = '![image.png](/ajax/v2/attachments/1311?inline=true =613x102)';
  const images: string[] = [];
  const html = renderToStaticMarkup(<MessageMarkdown text={markup + '\n\n```\n' + markup + '\n```'} renderImage={image => {
    images.push(image.id);
    assert.equal(image.width, 613);
    return <img src="/api/files/local" alt={image.filename} />;
  }} />);
  assert.deepEqual(images, ['1311']);
  assert.match(html, /src="\/api\/files\/local"/);
  assert.ok(html.includes(markup));
});

test("renders Markdown around structured mentions", () => {
  const html = renderToStaticMarkup(<MessageMarkdown text={"**Hello** [@Nik](#comment-mention-1)\n\n> reply"} mentions={[{href: '#comment-mention-1', label: 'Nik', title: 'Member'}]} />);
  assert.match(html, /<strong>Hello<\/strong>/);
  assert.match(html, /class="comment-mention" title="Member">@Nik/);
  assert.match(html, /<blockquote>/);
});
