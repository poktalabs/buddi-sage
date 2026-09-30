import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/client/markdown";

describe("renderMarkdown", () => {
  it("renders paragraphs, joining soft lines", () => {
    expect(renderMarkdown("One line\nsame paragraph.\n\nNext.")).toBe("<p>One line same paragraph.</p>\n<p>Next.</p>");
  });
  it("renders headings one level below the page title", () => {
    expect(renderMarkdown("# Consent")).toBe("<h2>Consent</h2>");
  });
  it("renders bullet and numbered lists", () => {
    expect(renderMarkdown("- a\n- b\n\n1. c")).toBe("<ul><li>a</li><li>b</li></ul>\n<ol><li>c</li></ol>");
  });
  it("renders bold and italics", () => {
    expect(renderMarkdown("**your own voice** and *only* yours")).toBe("<p><strong>your own voice</strong> and <em>only</em> yours</p>");
  });
  it("escapes HTML", () => {
    expect(renderMarkdown('<img src=x onerror="alert(1)">')).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
  });
  it("drops HTML comments such as the word count", () => {
    expect(renderMarkdown("Read this.\n\n<!-- words: 231 -->")).toBe("<p>Read this.</p>");
  });
});
