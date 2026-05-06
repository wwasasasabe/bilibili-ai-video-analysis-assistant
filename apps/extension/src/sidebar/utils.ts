import type { PageContext } from "@app/shared";

export type AttachmentKind = "image" | "word" | "code";

export interface AttachmentItem {
  id: string;
  kind: AttachmentKind;
  name: string;
  previewUrl?: string;
  content?: string;
  base64?: string;
  sizeLabel: string;
}

export interface MindMapNode {
  id: string;
  label: string;
  children: MindMapNode[];
}

export type MindMapLayout = "tree" | "timeline" | "cluster" | "comparison";

export interface MindMapPayload {
  type: MindMapLayout;
  title: string;
  summary?: string;
  nodes: MindMapNode[];
}

export interface MindMapLabelParts {
  title: string;
  detail?: string;
}

const TIMELINE_NODE_PATTERN =
  /^((\d{1,2}:\d{2}(?::\d{2})?\s*[-–~])|step\s*\d+|phase\s*\d+|part\s*\d+|chapter\s*\d+|第[一二三四五六七八九十百0-9]+(步|部分|阶段))/i;

export function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function decodeXmlEntities(text: string) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

export function splitMindMapLabel(label: string): MindMapLabelParts {
  const normalized = label
    .replace(/\s+/g, " ")
    .replace(/\s*([：:])\s*/g, "$1 ")
    .trim();

  const separatorMatch = normalized.match(/^(.{1,24}?)[：:]\s+(.+)$/);

  if (separatorMatch) {
    return {
      title: separatorMatch[1]?.trim() ?? normalized,
      detail: separatorMatch[2]?.trim() || undefined
    };
  }

  return {
    title: normalized
  };
}

export function extractDocxTextFromXml(xml: string) {
  return xml
    .split("</w:p>")
    .map((paragraph) => {
      const matches = [...paragraph.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)];
      return matches.map((match) => decodeXmlEntities(match[1] ?? "")).join("");
    })
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n");
}

export function buildAttachmentPrompt(question: string, attachments: AttachmentItem[]) {
  const baseQuestion = question.trim() || "请结合我上传的内容继续分析。";
  const detailBlocks = attachments.map((attachment) => {
    if (attachment.kind === "word" && attachment.content) {
      return [`[Word 文档] ${attachment.name}`, attachment.content.slice(0, 6000)].join("\n");
    }

    if (attachment.kind === "code" && attachment.content) {
      return [`[代码文件] ${attachment.name}`, attachment.content.slice(0, 6000)].join("\n");
    }

    if (attachment.kind === "image") {
      return `[图片] ${attachment.name}`;
    }

    return `[附件] ${attachment.name}`;
  });

  if (detailBlocks.length === 0) {
    return baseQuestion;
  }

  return [baseQuestion, "请结合以下附件一起分析：", ...detailBlocks].join("\n\n");
}

export function shouldAttachMindMapFrame(context: PageContext) {
  return !context.transcriptText?.trim() && !context.subtitleText?.trim();
}

function normalizeMindMapLine(line: string) {
  const expanded = line.replaceAll("\t", "  ");
  const treeMatch = expanded.match(
    /^((?:[│┃┆┊]\s{0,3}|\s{2,4})*)(?:[├└┌┬┼╰╭])(?:[─═-]+\s*|\s+)(.+)$/
  );

  if (treeMatch) {
    const prefix = treeMatch[1] ?? "";
    const label = (treeMatch[2] ?? "").trim();
    const depth =
      prefix.match(/(?:[│┃┆┊]\s{0,3}|\s{2,4})/g)?.length ?? 0;

    return {
      level: depth + 1,
      label
    };
  }

  const leading = expanded.match(/^\s*/)?.[0].length ?? 0;
  const label = expanded.replace(/^\s*([-*•]|[0-9]+[.)])\s*/, "").trim();
  return {
    level: Math.floor(leading / 2),
    label
  };
}

export function parseMindMapText(source: string) {
  const lines = source
    .split(/\r?\n/)
    .map((line) => normalizeMindMapLine(line))
    .filter((line) => line.label.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const root: MindMapNode = {
    id: "root",
    label: "root",
    children: []
  };

  const stack: Array<{ level: number; node: MindMapNode }> = [{ level: -1, node: root }];

  lines.forEach((line, index) => {
    const node: MindMapNode = {
      id: `node-${index}-${line.level}`,
      label: line.label,
      children: []
    };

    while (stack.length > 1 && line.level <= stack[stack.length - 1].level) {
      stack.pop();
    }

    stack[stack.length - 1].node.children.push(node);
    stack.push({ level: line.level, node });
  });

  return root.children;
}

function parseMindMapJsonBlock(source: string) {
  const fenced = source.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim();
  const raw = fenced || source.trim();

  if (!raw.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(raw) as {
      type?: unknown;
      title?: unknown;
      summary?: unknown;
      nodes?: unknown;
    };
  } catch {
    return null;
  }
}

function isMindMapLayout(value: unknown): value is MindMapLayout {
  return (
    value === "tree" ||
    value === "timeline" ||
    value === "cluster" ||
    value === "comparison"
  );
}

function normalizeMindMapNodes(value: unknown, path = "node"): MindMapNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const label =
        "label" in item && typeof item.label === "string" ? item.label.trim() : "";

      if (!label) {
        return null;
      }

      const childSource = "children" in item ? item.children : [];

      return {
        id: `${path}-${index}`,
        label,
        children: normalizeMindMapNodes(childSource, `${path}-${index}`)
      } satisfies MindMapNode;
    })
    .filter((node): node is MindMapNode => Boolean(node));
}

function getMindMapDepth(nodes: MindMapNode[]): number {
  if (nodes.length === 0) {
    return 0;
  }

  return 1 + Math.max(...nodes.map((node) => getMindMapDepth(node.children)));
}

function looksLikeTimelineLayout(nodes: MindMapNode[]): boolean {
  if (nodes.length < 3) {
    return false;
  }

  const timelineMatches = nodes.filter((node) => TIMELINE_NODE_PATTERN.test(node.label)).length;
  return timelineMatches >= Math.ceil(nodes.length / 2);
}

function looksLikeClusterLayout(nodes: MindMapNode[]): boolean {
  if (nodes.length < 3) {
    return false;
  }

  const depth = getMindMapDepth(nodes);
  if (depth > 2) {
    return false;
  }

  return nodes.some((node) => node.children.length > 0);
}

function inferMindMapLayout(
  preferredLayout: MindMapLayout | null,
  nodes: MindMapNode[]
): MindMapLayout {
  if (preferredLayout && preferredLayout !== "tree") {
    return preferredLayout;
  }

  if (looksLikeTimelineLayout(nodes)) {
    return "timeline";
  }

  if (looksLikeClusterLayout(nodes)) {
    return "cluster";
  }

  return preferredLayout ?? "tree";
}

function removeMindMapNodeIds(
  nodes: MindMapNode[]
): Array<{ label: string; children: Array<{ label: string; children: unknown[] }> }> {
  return nodes.map((node) => ({
    label: node.label,
    children: removeMindMapNodeIds(node.children)
  }));
}

export function parseMindMapPayload(source: string): MindMapPayload {
  const parsed = parseMindMapJsonBlock(source);

  if (parsed) {
    const nodes = normalizeMindMapNodes(parsed.nodes);

    if (nodes.length > 0) {
      const preferredLayout = isMindMapLayout(parsed.type) ? parsed.type : null;

      return {
        type: inferMindMapLayout(preferredLayout, nodes),
        title:
          typeof parsed.title === "string" && parsed.title.trim()
            ? parsed.title.trim()
            : nodes[0]?.label ?? "Mind Map",
        summary:
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim()
            : undefined,
        nodes
      };
    }
  }

  const nodes = parseMindMapText(source);

  return {
    type: "tree",
    title: nodes[0]?.label ?? "Mind Map",
    nodes
  };
}

export function formatMindMapSourceForDisplay(source: string) {
  const parsed = parseMindMapJsonBlock(source);

  if (!parsed) {
    return source;
  }

  const payload = parseMindMapPayload(source);
  return JSON.stringify(
    {
      type: payload.type,
      title: payload.title,
      summary: payload.summary,
      nodes: removeMindMapNodeIds(payload.nodes)
    },
    null,
    2
  );
}
