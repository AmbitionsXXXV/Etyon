import { defineConfig } from "cz-git"
import fg from "fast-glob"

const getPackages = (packagePath) =>
  fg.sync("*", { cwd: packagePath, deep: 2, onlyDirectories: true })

const scopes = [
  ...getPackages("packages"),
  ...getPackages("apps"),
  "docker",
  "docs",
  "project",
  "style",
  "ci",
  "dev",
  "deploy",
  "other",
  "deps"
]

/** @type {import('cz-git').UserConfig} */
export default defineConfig({
  extends: ["@commitlint/config-conventional"],
  parserPreset: "conventional-changelog-conventionalcommits",
  prompt: {
    confirmColorize: true,
    emojiAlign: "center",
    messages: {
      emptyWarning: "can not be empty",
      lowerLimitWarning: "below limit",
      max: "upper %d chars",
      min: "%d chars at least",
      skip: ":skip",
      upperLimitWarning: "over limit"
    },
    questions: {
      body: {
        description: "Provide a longer description of the change"
      },
      breaking: {
        description: "Describe the breaking changes"
      },
      breakingBody: {
        description:
          "A BREAKING CHANGE commit requires a body. Please enter a longer description of the commit itself"
      },
      isBreaking: {
        description: "Are there any breaking changes?"
      },
      isIssueAffected: {
        description: "Does this change affect any open issues?"
      },
      issues: {
        description: 'Add issue references (e.g. "fix #123", "re #123".)'
      },
      issuesBody: {
        description:
          "If issues are closed, the commit requires a body. Please enter a longer description of the commit itself"
      },
      scope: {
        description:
          "What is the scope of this change (e.g. component or file name)"
      },
      subject: {
        description: "Write a short, imperative tense description of the change"
      }
    },
    settings: {},
    types: [
      { emoji: "✨ ", name: "feat:     ✨  A new feature", value: "feat" },
      { emoji: "🐛 ", name: "fix:      🐛  A bug fix", value: "fix" },
      {
        emoji: "📝 ",
        name: "docs:     📝  Documentation only changes",
        value: "docs"
      },
      {
        emoji: "💄 ",
        name: "style:    💄  Changes that do not affect the meaning of the code",
        value: "style"
      },
      {
        emoji: "📦️ ",
        name: "refactor: 📦️   A code change that neither fixes a bug nor adds a feature",
        value: "refactor"
      },
      {
        emoji: "🚀 ",
        name: "perf:     🚀  A code change that improves performance",
        value: "perf"
      },
      {
        emoji: "🚨 ",
        name: "test:     🚨  Adding missing tests or correcting existing tests",
        value: "test"
      },
      {
        emoji: "🛠 ",
        name: "build:    🛠   Changes that affect the build system or external dependencies",
        value: "build"
      },
      {
        emoji: "🎡 ",
        name: "ci:       🎡  Changes to our CI configuration files and scripts",
        value: "ci"
      },
      {
        emoji: "🔨 ",
        name: "chore:    🔨  Other changes that don't modify src or test files",
        value: "chore"
      },
      {
        emoji: ":rewind:",
        name: "revert:   ⏪️  Reverts a previous commit",
        value: "revert"
      },
      {
        emoji: "🌐 ",
        name: "i18n:     🌐  国际化",
        value: "i18n"
      },
      {
        emoji: "🌱 ",
        name: "init:     🌱  项目初始化",
        value: "init"
      }
    ],
    useEmoji: true
  },
  rules: {
    "body-max-line-length": [2, "always", 1000],
    "header-max-length": [2, "always", 1000],
    "scope-enum": [2, "always", scopes],
    "type-enum": [
      2,
      "always",
      [
        "build",
        "chore",
        "ci",
        "docs",
        "feat",
        "fix",
        "perf",
        "refactor",
        "revert",
        "style",
        "test",
        "i18n",
        "init"
      ]
    ]
  }
})
