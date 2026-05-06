import type { CustomSkill } from "@app/shared";
import { useRef, useState } from "react";

type Locale = "zh" | "en";

interface SkillManagerProps {
  skills: CustomSkill[];
  onInstallSkill: (rawSkill: string) => void;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  locale?: Locale;
}

const copy = {
  zh: {
    title: "Skill 安装",
    description: "你可以粘贴 Skill JSON，也可以先上传 Skill 文件再安装。",
    skillButton: "Skill",
    skillEmpty: "还没有安装 Skill。",
    upload: "上传 Skill 文件",
    install: "安装 Skill",
    enabled: "已开启",
    disabled: "已关闭"
  },
  en: {
    title: "Skill Install",
    description: "Paste Skill JSON or upload a Skill file before installing it.",
    skillButton: "Skill",
    skillEmpty: "No installed skills yet.",
    upload: "Upload Skill File",
    install: "Install Skill",
    enabled: "On",
    disabled: "Off"
  }
} as const;

function readSkillFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

function buildSkillSubtitle(skill: CustomSkill) {
  if (skill.description?.trim()) {
    return skill.description.trim();
  }

  return skill.prompt.trim();
}

export function SkillManager({
  skills,
  onInstallSkill,
  onToggleSkill,
  locale = "zh"
}: SkillManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(`{
  "id": "learning-focus",
  "name": "Learning Focus",
  "version": "1.0.0",
  "prompt": "Highlight practical learning points for viewers.",
  "targets": ["summary"],
  "enabled": true
}`);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [skillDirectoryOpen, setSkillDirectoryOpen] = useState(false);
  const text = copy[locale];

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const content = await readSkillFile(file);
    setDraft(content);
    setUploadedFileName(file.name);
    setSkillDirectoryOpen(true);
    onInstallSkill(content);
    event.target.value = "";
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{text.title}</h2>
        <p>{text.description}</p>
      </div>

      <div className="skill-directory">
        <button
          type="button"
          className="skill-directory-trigger"
          aria-label="Toggle Skill Directory"
          aria-expanded={skillDirectoryOpen}
          onClick={() => setSkillDirectoryOpen((open) => !open)}
        >
          <span>{text.skillButton}</span>
          <span className={skillDirectoryOpen ? "skill-directory-caret open" : "skill-directory-caret"}>
            ▾
          </span>
        </button>

        {skillDirectoryOpen ? (
          skills.length === 0 ? (
            <div className="panel-note">{text.skillEmpty}</div>
          ) : (
            <ul className="skill-list simple-skill-list">
              {skills.map((skill) => (
                <li key={skill.id}>
                  <article className="simple-skill-row">
                    <div className="simple-skill-main text-only">
                      <div className="simple-skill-copy">
                        <strong>{skill.name}</strong>
                        <span>{buildSkillSubtitle(skill)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={skill.enabled ? "switch-button active" : "switch-button"}
                      aria-label={`${skill.name} ${skill.enabled ? text.enabled : text.disabled}`}
                      aria-pressed={skill.enabled}
                      onClick={() => onToggleSkill(skill.id, !skill.enabled)}
                    >
                      <span className="switch-thumb" />
                    </button>
                  </article>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <div className="form-grid">
        <label>
          Skill JSON
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={10} />
        </label>
        <div className="action-row skill-upload-row">
          <button
            type="button"
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
          >
            {text.upload}
          </button>
          {uploadedFileName ? <span className="status-text">{uploadedFileName}</span> : null}
        </div>
        <div className="action-row">
          <button type="button" onClick={() => onInstallSkill(draft)}>
            {text.install}
          </button>
        </div>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept=".json,.skill,.txt,application/json"
          onChange={(event) => void handleFileUpload(event)}
        />
      </div>
    </section>
  );
}
