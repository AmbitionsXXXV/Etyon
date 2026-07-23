# Release

产品发版只同步两个 package 的版本字段，不引入 Changesets，也不走 `pnpm publish`。

| 包               | 角色                              |
| ---------------- | --------------------------------- |
| `etyon`（根）    | monorepo 产品版本                 |
| `@etyon/desktop` | Electron 桌面端版本，与根版本锁定 |

内部包 `@etyon/{i18n,logger,rpc,ui}` 固定 `0.0.0`，由 `pnpm-workspace.yaml` 的 `versioning.ignore` 排除。

## 配置

[`pnpm-workspace.yaml`](/Users/jiantianjianghui/Web_Project/Etyon/pnpm-workspace.yaml)：

```yaml
versioning:
  fixed:
    - ["etyon", "@etyon/desktop"]
  ignore:
    - "@etyon/i18n"
    - "@etyon/logger"
    - "@etyon/rpc"
    - "@etyon/ui"
```

- `fixed`：两个产品包始终同版本
- `ignore`：内部 workspace 包永不参与 bump / 依赖传播

底层通过 Vite+ 转发到 `packageManager` 锁定的 pnpm：

```bash
vp pm version <patch|minor|major|X.Y.Z> -- -r --filter etyon --filter @etyon/desktop
```

`vp pm version … -r` **不会**自动 commit / tag（recursive 模式设计如此），所以仓库提供统一脚本补齐 changelog 与 git 步骤。

## 命令

预览计划（不改文件、不碰 git）：

```bash
vp run release -- patch -- --dry-run
vp run release -- minor -- --dry-run
vp run release -- 0.2.0 -- --dry-run
```

本地完成 bump + `CHANGELOG.md` + commit + annotated tag（默认不 push）：

```bash
vp run release -- patch
vp run release -- minor
vp run release -- major
vp run release -- 0.2.0
```

跳过 changelog 重写：

```bash
vp run release -- patch -- --skip-changelog
```

完成后直接 push 触发 CI：

```bash
vp run release -- patch -- --push
```

等价于脚本末尾执行：

```bash
git push
git push origin vX.Y.Z
```

## 脚本做了什么

[`script/release.mjs`](/Users/jiantianjianghui/Web_Project/Etyon/script/release.mjs)：

1. 校验根与 `@etyon/desktop` 当前版本一致
2. 要求工作区干净
3. 确认目标 tag 不存在
4. `vp pm version … -r --filter etyon --filter @etyon/desktop`
5. 再次校验两包版本与计划一致
6. `git-cliff --tag vX.Y.Z -o CHANGELOG.md`（可用 `--skip-changelog` 跳过）
7. `git commit`：`chore(release): vX.Y.Z`（`cliff.toml` 会 skip 这类 commit）
8. `git tag -a vX.Y.Z`
9. 可选 `--push`

依赖本机已安装 `git-cliff`（与现有 `vp run changelog` 相同）。

## 与 GitHub Release 的关系

tag push 后由 [`.github/workflows/release.yml`](/Users/jiantianjianghui/Web_Project/Etyon/.github/workflows/release.yml) 打包并创建 GitHub Release。细节见 [packaging.md](./packaging.md)。

本流程**不**使用：

- `@changesets/cli`
- `.changeset/` 意图文件（可选未来再用 `pnpm change`，非必需）
- `pnpm publish` / `vp pm publish`（产品是 Electron 安装包，不是 npm 包）

## Changelog

仓库级 changelog 继续由 **git-cliff + conventional commits** 生成，而不是 package-level changesets 段落。

单独刷新文件：

```bash
vp run changelog
vp run changelog:latest
```
