import { describe, expect, it } from "vitest";
import {
  buildAttachmentPrompt,
  extractDocxTextFromXml,
  formatMindMapSourceForDisplay,
  parseMindMapPayload,
  parseMindMapText,
  shouldAttachMindMapFrame,
  splitMindMapLabel,
  type AttachmentItem
} from "../sidebar/utils";

describe("sidebar utils", () => {
  it("extracts readable text from docx xml", () => {
    const xml = [
      "<w:document>",
      "<w:body>",
      "<w:p><w:r><w:t>第一段</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>第二段</w:t></w:r></w:p>",
      "</w:body>",
      "</w:document>"
    ].join("");

    expect(extractDocxTextFromXml(xml)).toBe("第一段\n第二段");
  });

  it("builds a prompt that includes word and code content", () => {
    const attachments: AttachmentItem[] = [
      {
        id: "word-1",
        kind: "word",
        name: "notes.docx",
        content: "这里是文档正文。",
        sizeLabel: "10 KB"
      },
      {
        id: "code-1",
        kind: "code",
        name: "demo.ts",
        content: "console.log('hello');",
        sizeLabel: "2 KB"
      }
    ];

    const prompt = buildAttachmentPrompt("帮我总结", attachments);
    expect(prompt).toContain("帮我总结");
    expect(prompt).toContain("这里是文档正文。");
    expect(prompt).toContain("console.log('hello');");
  });

  it("parses indented mind map text into a tree", () => {
    const nodes = parseMindMapText([
      "- 根节点",
      "  - 子节点一",
      "    - 叶子节点",
      "  - 子节点二"
    ].join("\n"));

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.label).toBe("根节点");
    expect(nodes[0]?.children[0]?.label).toBe("子节点一");
    expect(nodes[0]?.children[0]?.children[0]?.label).toBe("叶子节点");
    expect(nodes[0]?.children[1]?.label).toBe("子节点二");
  });

  it("parses tree-drawing symbols into clean labels and nested levels", () => {
    const nodes = parseMindMapText([
      "3 n阶行列式",
      "├── 定义",
      "│   ├── 基于排列逆序数",
      "│   └── 展开式",
      "└── 基本性质"
    ].join("\n"));

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.label).toBe("3 n阶行列式");
    expect(nodes[0]?.children[0]?.label).toBe("定义");
    expect(nodes[0]?.children[0]?.children[0]?.label).toBe("基于排列逆序数");
    expect(nodes[0]?.children[0]?.children[1]?.label).toBe("展开式");
    expect(nodes[0]?.children[1]?.label).toBe("基本性质");
  });

  it("parses a structured mind map payload with an AI-selected layout", () => {
    const payload = parseMindMapPayload(`\`\`\`json
{
  "type": "timeline",
  "title": "React Hooks 第三集",
  "nodes": [
    {
      "label": "Hooks 规则",
      "children": [
        { "label": "只在顶层调用", "children": [] }
      ]
    }
  ]
}
\`\`\``);

    expect(payload.type).toBe("timeline");
    expect(payload.title).toBe("React Hooks 第三集");
    expect(payload.nodes[0]?.label).toBe("Hooks 规则");
  });

  it("reclassifies shallow parallel sections into a cluster layout", () => {
    const payload = parseMindMapPayload(`\`\`\`json
{
  "type": "tree",
  "title": "1.3 n阶行列式",
  "summary": "n阶行列式的定义、基本性质、计算方法及特殊行列式",
  "nodes": [
    {
      "label": "定义",
      "children": [
        { "label": "利用排列的逆序数定义", "children": [] },
        { "label": "递归定义（按第一行展开）", "children": [] }
      ]
    },
    {
      "label": "基本性质",
      "children": [
        { "label": "转置行列式值不变", "children": [] }
      ]
    },
    {
      "label": "计算方法",
      "children": [
        { "label": "按行（列）展开（降阶法）", "children": [] }
      ]
    },
    {
      "label": "特殊行列式",
      "children": [
        { "label": "范德蒙德行列式", "children": [] }
      ]
    }
  ]
}
\`\`\``);

    expect(payload.type).toBe("cluster");
  });

  it("formats structured mind map json for clean display without internal ids", () => {
    const output = formatMindMapSourceForDisplay(`\`\`\`json
{
  "type": "tree",
  "title": "1.3 n阶行列式",
  "summary": "测试摘要",
  "nodes": [
    {
      "label": "n阶行列式",
      "children": [
        { "label": "定义", "children": [] }
      ]
    }
  ]
}
\`\`\``);

    expect(output).toContain('"type": "tree"');
    expect(output).toContain('"title": "1.3 n阶行列式"');
    expect(output).not.toContain('"id"');
  });

  it("splits a node label into a short title and detail", () => {
    expect(splitMindMapLabel("y的原像：X中满足f(x)=y的x")).toEqual({
      title: "y的原像",
      detail: "X中满足f(x)=y的x"
    });
  });

  it("requests a frame for mind maps when no subtitle or transcript is available", () => {
    expect(
      shouldAttachMindMapFrame({
        videoId: "BV1",
        title: "CET-6 vocabulary lesson",
        description: "",
        uploader: "Teacher",
        currentTime: 260,
        duration: 2591
      })
    ).toBe(true);

    expect(
      shouldAttachMindMapFrame({
        videoId: "BV1",
        title: "CET-6 vocabulary lesson",
        description: "",
        uploader: "Teacher",
        currentTime: 260,
        duration: 2591,
        transcriptText: "[00:00 - 00:10] alleviate"
      })
    ).toBe(false);
  });
});
