import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent, normalizeMarkdownMath } from "../sidebar/components/MarkdownContent";

describe("normalizeMarkdownMath", () => {
  it("converts latex delimiters into markdown math delimiters", () => {
    expect(normalizeMarkdownMath("Inline \\(x^2+y^2\\)")).toContain("$x^2+y^2$");
    expect(normalizeMarkdownMath("Block:\\n\\[a+b\\]")).toContain("$$\na+b\n$$");
  });
});

describe("MarkdownContent", () => {
  it("renders tables and math expressions", () => {
    render(
      <MarkdownContent
        source={[
          "| 概念 | 表达式 |",
          "| --- | --- |",
          "| 行列式 | \\(\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}\\) |"
        ].join("\n")}
      />
    );

    expect(screen.getByRole("table")).toBeTruthy();
    expect(document.querySelector(".katex")).toBeTruthy();
  });
});
